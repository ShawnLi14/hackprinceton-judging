-- ============================================
-- Concurrent judging + assignment indexes
-- ============================================
-- A team may be in more than one active set. Hackathon judging runs with
-- about as many judges as teams/set_size (150 teams, 30 judges, sets of 5),
-- so an exclusive lock leaves the next judge with nobody to visit until
-- someone submits. max_concurrent_judges caps how many judges can be with
-- the same team at once (default 3).
--
-- assign_set_to_judge is serialized per event with an advisory lock and
-- ranks teams by completed judgings + in-flight assignments, skipping anyone
-- this judge has already finished or is currently visiting.
--
-- Apply this to databases that were created before this change. Fresh
-- installs get the same objects from 001_schema.sql.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS max_concurrent_judges INTEGER NOT NULL DEFAULT 3;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_max_concurrent_judges_check;
ALTER TABLE events
  ADD CONSTRAINT events_max_concurrent_judges_check CHECK (max_concurrent_judges >= 1);

-- The partial unique index is what made simultaneous judging impossible.
DROP INDEX IF EXISTS idx_team_locks_one_active_per_team;

CREATE INDEX IF NOT EXISTS idx_judging_sets_judge_status
  ON judging_sets (judge_id, status);

CREATE INDEX IF NOT EXISTS idx_judging_sets_active_by_judge
  ON judging_sets (judge_id, assigned_at DESC)
  WHERE status = 'active';

-- Release locks left behind on sets that are no longer active, then the
-- original timeout behavior.
CREATE OR REPLACE FUNCTION release_expired_locks(p_event_id UUID, p_max_minutes INTEGER)
RETURNS void AS $$
BEGIN
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

-- Keep this function in sync with src/lib/assignment-policy.ts.
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

  -- sort_key is computed once per row. Calling random() inside ORDER BY can
  -- re-roll during comparisons and scramble nearby rooms.
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
        ORDER BY jst.visit_order
        LIMIT 1
      )
  WHERE id = p_judge_id;

  RETURN v_set_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
