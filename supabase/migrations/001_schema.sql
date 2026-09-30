-- ============================================
-- HackPrinceton Judging App - Database Schema
-- ============================================
-- This file is the canonical full schema for fresh installs. The
-- additive migrations 002_event_log.sql, 003_edit_completed_set.sql,
-- 004_abandon_judging_set.sql, and 005_concurrent_judging.sql are mirrored
-- in this file (search for "Mirror of", and the concurrent-judging objects
-- below) so existing deployments can apply them incrementally while a fresh
-- `supabase db reset` against this file gets everything in one shot.

-- Events table: one row per hackathon event
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  set_size INTEGER NOT NULL DEFAULT 5,
  target_judgings_per_team INTEGER NOT NULL DEFAULT 3,
  max_judging_minutes INTEGER NOT NULL DEFAULT 20,
  -- How many judges may be with the same team at once. 1 restores exclusive
  -- locking. Default 3 covers a field where judges > teams/set_size.
  max_concurrent_judges INTEGER NOT NULL DEFAULT 3,
  CONSTRAINT events_max_concurrent_judges_check CHECK (max_concurrent_judges >= 1),
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
-- Identified by their project (no separate "team name"); display falls back to "Untitled" when project_name is null.
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_name TEXT,
  track TEXT,
  team_number TEXT NOT NULL,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  devpost_url TEXT,           -- optional link to a Devpost (or other) submission
  opt_in_prizes TEXT[] NOT NULL DEFAULT '{}',  -- Devpost "Opt-In Prize" values; empty = no opt-ins
  times_judged INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_event ON teams(event_id);
CREATE INDEX idx_teams_room ON teams(room_id);
CREATE INDEX idx_teams_times_judged ON teams(event_id, times_judged);
CREATE INDEX idx_teams_opt_in_prizes ON teams USING GIN (opt_in_prizes);

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

-- Team locks: one active claim per (team, judging set).
-- Several judges may hold the same team at once, up to events.max_concurrent_judges.
-- UNIQUE(team_id, judging_set_id) only stops one set from locking a team twice.
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

CREATE INDEX idx_judging_sets_judge_status ON judging_sets (judge_id, status);
CREATE INDEX idx_judging_sets_active_by_judge
  ON judging_sets (judge_id, assigned_at DESC)
  WHERE status = 'active';

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
  -- Locks whose set is already finished. Submit and abandon release these
  -- themselves; this covers a crash between the two updates.
  UPDATE team_locks tl
  SET released_at = now()
  FROM judging_sets js
  WHERE tl.judging_set_id = js.id
    AND js.event_id = p_event_id
    AND js.status <> 'active'
    AND tl.released_at IS NULL;

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
-- Atomic team assignment
-- ============================================
-- Several judges may hold the same team, up to events.max_concurrent_judges.
-- Serialized per event so concurrent requests see each other's new locks.
-- Load = times_judged + active locks. A judge never receives a team they
-- already completed or are currently visiting.
-- Keep the ordering in sync with src/lib/assignment-policy.ts.
CREATE OR REPLACE FUNCTION assign_set_to_judge(
  p_event_id UUID,
  p_judge_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_set_size INTEGER;
  v_target INTEGER;
  v_max_concurrent INTEGER;
  v_status TEXT;
  v_judge_floor INTEGER;
  v_judge_active BOOLEAN;
  v_judge_status TEXT;
  v_best_floor INTEGER;
  v_set_id UUID;
  v_existing UUID;
  v_count INTEGER;
BEGIN
  -- One assignment at a time per event. Without this, parallel "get next
  -- set" clicks all snapshot times_judged = 0 and stack onto the same teams.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));

  SELECT set_size, target_judgings_per_team, status, COALESCE(max_concurrent_judges, 3)
  INTO v_set_size, v_target, v_status, v_max_concurrent
  FROM events WHERE id = p_event_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;
  IF v_status != 'active' THEN
    RAISE EXCEPTION 'Event is not active';
  END IF;
  IF v_max_concurrent < 1 THEN
    v_max_concurrent := 1;
  END IF;

  SELECT j.is_active, j.status, r.floor
  INTO v_judge_active, v_judge_status, v_judge_floor
  FROM judges j
  LEFT JOIN rooms r ON r.id = j.current_room_id
  WHERE j.id = p_judge_id;

  IF v_judge_active IS NULL THEN
    RAISE EXCEPTION 'Judge not found';
  END IF;
  IF v_judge_active = false THEN
    RAISE EXCEPTION 'Judge is deactivated';
  END IF;
  IF v_judge_status = 'on_break' THEN
    RAISE EXCEPTION 'Judge is on break';
  END IF;

  -- A double-click must not open a second set. Hand back the one they have.
  SELECT id INTO v_existing
  FROM judging_sets
  WHERE judge_id = p_judge_id AND status = 'active'
  ORDER BY assigned_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Prefer the floor with the most under-target teams that still have room
  -- for another judge. Ties prefer the judge's current floor.
  SELECT sub.fl INTO v_best_floor
  FROM (
    SELECT r.floor AS fl,
           COUNT(*) AS avail,
           COUNT(*) FILTER (
             WHERE t.times_judged < v_target AND COALESCE(lc.cnt, 0) = 0
           ) AS fresh,
           COUNT(*) FILTER (
             WHERE t.times_judged + COALESCE(lc.cnt, 0) < v_target
           ) AS under_target
    FROM teams t
    JOIN rooms r ON r.id = t.room_id
    LEFT JOIN (
      SELECT team_id, COUNT(*)::int AS cnt
      FROM team_locks
      WHERE released_at IS NULL
      GROUP BY team_id
    ) lc ON lc.team_id = t.id
    WHERE t.event_id = p_event_id
      AND t.is_active = true
      AND COALESCE(lc.cnt, 0) < v_max_concurrent
      AND NOT EXISTS (
        SELECT 1
        FROM judging_set_teams jst
        JOIN judging_sets js ON js.id = jst.judging_set_id
        WHERE jst.team_id = t.id
          AND js.judge_id = p_judge_id
          AND js.status IN ('active', 'completed')
      )
    GROUP BY r.floor
    HAVING COUNT(*) >= 1
  ) sub
  ORDER BY sub.fresh DESC, sub.under_target DESC, sub.avail DESC,
           CASE WHEN sub.fl = v_judge_floor THEN 0 ELSE 1 END,
           sub.fl
  LIMIT 1;

  IF v_best_floor IS NULL THEN
    RAISE EXCEPTION 'No available teams on any floor';
  END IF;

  INSERT INTO judging_sets (event_id, judge_id, status, assigned_at)
  VALUES (p_event_id, p_judge_id, 'active', now())
  RETURNING id INTO v_set_id;

  -- Tiebreaker: room_number + small random jitter, computed once per row.
  -- Without the jitter, judges always sweep low-numbered rooms first.
  -- A jitter of ~3 lets neighboring rooms swap while distant rooms stay put.
  WITH load AS (
    SELECT team_id, COUNT(*)::int AS cnt
    FROM team_locks
    WHERE released_at IS NULL
    GROUP BY team_id
  ),
  scored AS (
    SELECT t.id AS team_id,
           (t.times_judged + COALESCE(lc.cnt, 0)) AS load_score,
           (r.room_number::float + random() * 3.0) AS sort_key
    FROM teams t
    JOIN rooms r ON r.id = t.room_id
    LEFT JOIN load lc ON lc.team_id = t.id
    WHERE t.event_id = p_event_id
      AND t.is_active = true
      AND r.floor = v_best_floor
      AND COALESCE(lc.cnt, 0) < v_max_concurrent
      AND NOT EXISTS (
        SELECT 1
        FROM judging_set_teams jst
        JOIN judging_sets js ON js.id = jst.judging_set_id
        WHERE jst.team_id = t.id
          AND js.judge_id = p_judge_id
          AND js.status IN ('active', 'completed')
      )
  ),
  picked AS (
    SELECT team_id,
           ROW_NUMBER() OVER (ORDER BY load_score ASC, sort_key ASC) AS visit_order
    FROM scored
  ),
  chosen AS (
    SELECT team_id, visit_order
    FROM picked
    WHERE visit_order <= v_set_size
  ),
  ins_locks AS (
    INSERT INTO team_locks (team_id, judging_set_id)
    SELECT team_id, v_set_id FROM chosen
    RETURNING team_id
  )
  INSERT INTO judging_set_teams (judging_set_id, team_id, visit_order)
  SELECT v_set_id, c.team_id, c.visit_order
  FROM chosen c
  JOIN ins_locks il ON il.team_id = c.team_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    DELETE FROM judging_sets WHERE id = v_set_id;
    RAISE EXCEPTION 'No available teams could be locked';
  END IF;

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

-- ============================================
-- Mirror of 002_event_log.sql
-- ============================================
-- Append-only log of every consequential action during judging. Written
-- from API route handlers via src/lib/log.ts so we can reconstruct what
-- happened after the fact and tail it live from /organizer/log.

CREATE TABLE IF NOT EXISTS event_log (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id  UUID REFERENCES events(id) ON DELETE CASCADE,
  actor     TEXT,           -- 'JUDGE-007' | 'organizer' | 'system' | 'anonymous'
  action    TEXT NOT NULL,  -- short verb-y string e.g. 'set.submitted'
  message   TEXT,           -- one-line human-readable summary
  details   JSONB           -- raw payload / response / error context
);

CREATE INDEX IF NOT EXISTS event_log_event_ts_idx ON event_log (event_id, ts DESC);
CREATE INDEX IF NOT EXISTS event_log_ts_idx       ON event_log (ts DESC);
CREATE INDEX IF NOT EXISTS event_log_action_idx   ON event_log (action, ts DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE event_log;

-- ============================================
-- Mirror of 003_edit_completed_set.sql
-- ============================================
-- Lets an organizer reorder ranks or flip is_absent for the rows of a
-- completed set, transactionally adjusting `teams.times_judged` so the
-- assignment algorithm and the results endpoint stay consistent.
--
-- The API route (PATCH /api/organizer/sets/[id]) is responsible for
-- validating that the ranks of present teams form the contiguous
-- sequence 1..K with no gaps or duplicates. This RPC enforces only the
-- structural invariants the DB cares about (set is completed, every
-- team in the payload belongs to the set) and the times_judged delta.

CREATE OR REPLACE FUNCTION edit_completed_set(
  p_set_id UUID,
  p_rankings JSONB  -- array of {team_id, rank, is_absent}
)
RETURNS BOOLEAN AS $$
DECLARE
  v_event_id   UUID;
  v_status     TEXT;
  v_ranking    JSONB;
  v_team_id    UUID;
  v_new_absent BOOLEAN;
  v_new_rank   INTEGER;
  v_was_absent BOOLEAN;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status
  FROM judging_sets
  WHERE id = p_set_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Set % does not exist', p_set_id;
  END IF;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'Set % is not completed (status=%)', p_set_id, v_status;
  END IF;

  FOR v_ranking IN SELECT * FROM jsonb_array_elements(p_rankings) LOOP
    v_team_id    := (v_ranking->>'team_id')::UUID;
    v_new_absent := COALESCE((v_ranking->>'is_absent')::BOOLEAN, false);
    v_new_rank   := NULLIF(v_ranking->>'rank', '')::INTEGER;

    SELECT is_absent INTO v_was_absent
    FROM judging_set_teams
    WHERE judging_set_id = p_set_id AND team_id = v_team_id;

    IF v_was_absent IS NULL THEN
      RAISE EXCEPTION 'Team % is not part of set %', v_team_id, p_set_id;
    END IF;

    UPDATE judging_set_teams
    SET rank      = CASE WHEN v_new_absent THEN NULL ELSE v_new_rank END,
        is_absent = v_new_absent
    WHERE judging_set_id = p_set_id AND team_id = v_team_id;

    IF v_was_absent = true AND v_new_absent = false THEN
      UPDATE teams SET times_judged = times_judged + 1 WHERE id = v_team_id;
    ELSIF v_was_absent = false AND v_new_absent = true THEN
      UPDATE teams SET times_judged = GREATEST(times_judged - 1, 0) WHERE id = v_team_id;
    END IF;
  END LOOP;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Mirror of 004_abandon_judging_set.sql
-- ============================================
-- Force-abandon a judge's currently-active set (organizer override for
-- when a judge has gone AWOL). Releases locks, marks the set expired,
-- and sets the judge back to idle. Does NOT touch teams.times_judged
-- (the judge never finished) and does NOT clear judge.current_room_id.

CREATE OR REPLACE FUNCTION abandon_judging_set(p_set_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_status   TEXT;
  v_judge_id UUID;
BEGIN
  SELECT status, judge_id INTO v_status, v_judge_id
  FROM judging_sets
  WHERE id = p_set_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Set % does not exist', p_set_id;
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Set % is not active (status=%)', p_set_id, v_status;
  END IF;

  UPDATE team_locks
  SET released_at = now()
  WHERE judging_set_id = p_set_id
    AND released_at IS NULL;

  UPDATE judging_sets
  SET status = 'expired', completed_at = now()
  WHERE id = p_set_id;

  UPDATE judges
  SET status = 'idle'
  WHERE id = v_judge_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
