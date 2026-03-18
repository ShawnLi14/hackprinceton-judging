-- ============================================
-- HackPrinceton Judging App - Database Schema
-- ============================================

-- Events table: one row per hackathon event
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  set_size INTEGER NOT NULL DEFAULT 5,
  target_judgings_per_team INTEGER NOT NULL DEFAULT 3,
  max_judging_minutes INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'paused', 'completed')),
  admin_code TEXT NOT NULL DEFAULT 'ADMIN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rooms: physical locations where teams are set up
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  room_number INTEGER NOT NULL,  -- closer numbers = closer rooms
  floor INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, room_number)
);

CREATE INDEX idx_rooms_event ON rooms(event_id);

-- Teams: hackathon teams/projects
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  project_name TEXT,
  table_number TEXT NOT NULL,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  times_judged INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_event ON teams(event_id);
CREATE INDEX idx_teams_room ON teams(room_id);
CREATE INDEX idx_teams_times_judged ON teams(event_id, times_judged);

-- Judges: people doing the judging
CREATE TABLE judges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  access_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  current_room_id UUID REFERENCES rooms(id),
  sets_completed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'active', 'on_break')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, access_code)
);

CREATE INDEX idx_judges_event ON judges(event_id);
CREATE INDEX idx_judges_access_code ON judges(access_code);

-- Judging sets: a batch of teams assigned to a judge
CREATE TABLE judging_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_id UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'skipped')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_judging_sets_judge ON judging_sets(judge_id);
CREATE INDEX idx_judging_sets_event_status ON judging_sets(event_id, status);

-- Teams within a judging set
CREATE TABLE judging_set_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judging_set_id UUID NOT NULL REFERENCES judging_sets(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  visit_order INTEGER NOT NULL,
  rank INTEGER,          -- filled when judge submits (1 = best)
  notes TEXT,
  is_visited BOOLEAN NOT NULL DEFAULT false,
  is_absent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(judging_set_id, team_id),
  UNIQUE(judging_set_id, visit_order)
);

CREATE INDEX idx_jst_set ON judging_set_teams(judging_set_id);
CREATE INDEX idx_jst_team ON judging_set_teams(team_id);

-- Team locks: prevent double-judging
CREATE TABLE team_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  judging_set_id UUID NOT NULL REFERENCES judging_sets(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  UNIQUE(team_id, judging_set_id)
);

CREATE INDEX idx_team_locks_team ON team_locks(team_id);
CREATE INDEX idx_team_locks_active ON team_locks(team_id) WHERE released_at IS NULL;

-- Partial unique index: only ONE active (unreleased) lock per team at a time.
-- This is the core constraint that prevents double-judging at the DB level.
CREATE UNIQUE INDEX idx_team_locks_one_active_per_team
  ON team_locks(team_id)
  WHERE released_at IS NULL;

-- ============================================
-- Functions
-- ============================================

-- Helper: get locked team IDs for an event
CREATE OR REPLACE FUNCTION get_locked_team_ids(p_event_id UUID)
RETURNS SETOF UUID AS $$
  SELECT DISTINCT tl.team_id
  FROM team_locks tl
  JOIN teams t ON t.id = tl.team_id
  WHERE t.event_id = p_event_id
    AND tl.released_at IS NULL;
$$ LANGUAGE sql STABLE;

-- Release expired locks (for stale sets where a judge disappeared)
CREATE OR REPLACE FUNCTION release_expired_locks(p_event_id UUID, p_max_minutes INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE team_locks tl
  SET released_at = now()
  FROM judging_sets js
  WHERE tl.judging_set_id = js.id
    AND js.event_id = p_event_id
    AND js.status = 'active'
    AND tl.released_at IS NULL
    AND js.assigned_at < now() - (p_max_minutes || ' minutes')::interval;

  UPDATE judging_sets
  SET status = 'expired', completed_at = now()
  WHERE event_id = p_event_id
    AND status = 'active'
    AND assigned_at < now() - (p_max_minutes || ' minutes')::interval;
END;
$$ LANGUAGE plpgsql;

-- Increment times_judged for a team
CREATE OR REPLACE FUNCTION increment_times_judged(team_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE teams SET times_judged = times_judged + 1 WHERE id = team_id_param;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Atomic team assignment (prevents race conditions)
-- ============================================
-- For each candidate team, tries INSERT INTO team_locks with ON CONFLICT DO NOTHING.
-- The partial unique index guarantees at most ONE active lock per team.
-- GET DIAGNOSTICS ROW_COUNT tells us if the lock was acquired.
CREATE OR REPLACE FUNCTION assign_set_to_judge(
  p_event_id UUID,
  p_judge_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_set_size INTEGER;
  v_target INTEGER;
  v_status TEXT;
  v_judge_floor INTEGER;
  v_best_floor INTEGER;
  v_set_id UUID;
  v_rec RECORD;
  v_order INTEGER := 0;
  v_rowcount INTEGER;
BEGIN
  -- Get event config
  SELECT set_size, target_judgings_per_team, status
  INTO v_set_size, v_target, v_status
  FROM events WHERE id = p_event_id;

  IF v_status != 'active' THEN
    RAISE EXCEPTION 'Event is not active';
  END IF;

  -- Get judge's current floor preference
  SELECT r.floor INTO v_judge_floor
  FROM judges j
  LEFT JOIN rooms r ON r.id = j.current_room_id
  WHERE j.id = p_judge_id;

  -- Pick the best floor: prefer floors with the most under-target unlocked teams,
  -- but fall back to any floor with unlocked teams (even if all are above target).
  -- On ties, prefer judge's current floor.
  SELECT sub.fl INTO v_best_floor
  FROM (
    SELECT r.floor AS fl,
           COUNT(*) AS avail,
           COUNT(*) FILTER (WHERE t.times_judged < v_target) AS under_target
    FROM teams t
    JOIN rooms r ON r.id = t.room_id
    LEFT JOIN team_locks tl ON tl.team_id = t.id AND tl.released_at IS NULL
    WHERE t.event_id = p_event_id
      AND t.is_active = true
      AND tl.id IS NULL
    GROUP BY r.floor
    HAVING COUNT(*) >= 1
  ) sub
  ORDER BY sub.under_target DESC, sub.avail DESC,
           CASE WHEN sub.fl = v_judge_floor THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_best_floor IS NULL THEN
    RAISE EXCEPTION 'No available teams on any floor';
  END IF;

  -- Create the judging set
  INSERT INTO judging_sets (event_id, judge_id, status, assigned_at)
  VALUES (p_event_id, p_judge_id, 'active', now())
  RETURNING id INTO v_set_id;

  -- Iterate candidate teams; try to lock each one.
  -- ON CONFLICT DO NOTHING + GET DIAGNOSTICS ensures no double-locking.
  -- All active teams on the chosen floor are candidates, ordered by
  -- times_judged ASC so under-target teams are prioritized first.
  FOR v_rec IN
    SELECT t.id AS tid
    FROM teams t
    JOIN rooms r ON r.id = t.room_id
    WHERE t.event_id = p_event_id
      AND t.is_active = true
      AND r.floor = v_best_floor
    ORDER BY t.times_judged ASC, r.room_number ASC
  LOOP
    EXIT WHEN v_order >= v_set_size;

    INSERT INTO team_locks (team_id, judging_set_id)
    VALUES (v_rec.tid, v_set_id)
    ON CONFLICT (team_id) WHERE released_at IS NULL
    DO NOTHING;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;

    IF v_rowcount > 0 THEN
      v_order := v_order + 1;
      INSERT INTO judging_set_teams (judging_set_id, team_id, visit_order)
      VALUES (v_set_id, v_rec.tid, v_order);
    END IF;
  END LOOP;

  IF v_order = 0 THEN
    DELETE FROM judging_sets WHERE id = v_set_id;
    RAISE EXCEPTION 'No available teams could be locked';
  END IF;

  -- Update judge status and location
  UPDATE judges
  SET status = 'active',
      current_room_id = (
        SELECT t.room_id FROM teams t
        JOIN judging_set_teams jst ON jst.team_id = t.id
        WHERE jst.judging_set_id = v_set_id
        ORDER BY jst.visit_order LIMIT 1
      )
  WHERE id = p_judge_id;

  RETURN v_set_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Atomic submit (prevents stale fairness data)
-- ============================================
-- Does everything in one transaction:
-- 1. Save rankings  2. Mark set completed  3. Increment times_judged
-- 4. Release locks (LAST)  5. Update judge stats
CREATE OR REPLACE FUNCTION submit_judging_set(
  p_set_id UUID,
  p_rankings JSONB  -- array of {team_id, rank, notes, is_absent}
)
RETURNS BOOLEAN AS $$
DECLARE
  v_judge_id UUID;
  v_event_id UUID;
  v_ranking JSONB;
  v_completed_count INTEGER;
  v_last_room_id UUID;
BEGIN
  SELECT judge_id, event_id INTO v_judge_id, v_event_id
  FROM judging_sets
  WHERE id = p_set_id AND status = 'active';

  IF v_judge_id IS NULL THEN
    RAISE EXCEPTION 'Set % is not active or does not exist', p_set_id;
  END IF;

  -- Save rankings
  FOR v_ranking IN SELECT * FROM jsonb_array_elements(p_rankings)
  LOOP
    UPDATE judging_set_teams
    SET rank = (v_ranking->>'rank')::INTEGER,
        notes = COALESCE(v_ranking->>'notes', NULL),
        is_absent = COALESCE((v_ranking->>'is_absent')::BOOLEAN, false),
        is_visited = true
    WHERE judging_set_id = p_set_id
      AND team_id = (v_ranking->>'team_id')::UUID;
  END LOOP;

  -- Mark set completed
  UPDATE judging_sets
  SET status = 'completed', completed_at = now()
  WHERE id = p_set_id;

  -- Increment times_judged for present teams
  UPDATE teams t
  SET times_judged = times_judged + 1
  FROM judging_set_teams jst
  WHERE jst.judging_set_id = p_set_id
    AND jst.team_id = t.id
    AND jst.is_absent = false;

  -- Release locks LAST (teams only become available after counts are updated)
  UPDATE team_locks
  SET released_at = now()
  WHERE judging_set_id = p_set_id
    AND released_at IS NULL;

  -- Update judge stats
  SELECT COUNT(*) INTO v_completed_count
  FROM judging_sets
  WHERE judge_id = v_judge_id AND status = 'completed';

  SELECT t.room_id INTO v_last_room_id
  FROM judging_set_teams jst
  JOIN teams t ON t.id = jst.team_id
  WHERE jst.judging_set_id = p_set_id
  ORDER BY jst.visit_order DESC
  LIMIT 1;

  UPDATE judges
  SET status = 'idle',
      sets_completed = v_completed_count,
      current_room_id = COALESCE(v_last_room_id, current_room_id)
  WHERE id = v_judge_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Enable realtime for key tables
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE judging_sets;
ALTER PUBLICATION supabase_realtime ADD TABLE judging_set_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE team_locks;
ALTER PUBLICATION supabase_realtime ADD TABLE judges;
ALTER PUBLICATION supabase_realtime ADD TABLE teams;
