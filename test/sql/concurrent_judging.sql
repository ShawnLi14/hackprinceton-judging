-- Exercises assign_set_to_judge / submit_judging_set / abandon_judging_set
-- against a database that already has 001_schema.sql applied.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test/sql/concurrent_judging.sql
--
-- Models the production field: 150 teams, sets of 5, and more judges than
-- teams/set_size. Fails the script (non-zero exit) if an invariant breaks.

DO $$
DECLARE
  v_event UUID;
  v_rooms UUID[] := ARRAY[]::UUID[];
  v_judges UUID[] := ARRAY[]::UUID[];
  v_room UUID;
  v_floor INTEGER;
  v_i INTEGER;
  v_judge UUID;
  v_set UUID;
  v_sets UUID[] := ARRAY[]::UUID[];
  v_team_count INTEGER;
  v_set_count INTEGER;
  v_short INTEGER;
  v_peak INTEGER;
  v_overlap INTEGER;
  v_repeat INTEGER;
  v_previous UUID[];
  v_next UUID[];
  v_shared UUID;
  v_other_lock INTEGER;
  v_times INTEGER;
  v_rankings JSONB;
BEGIN
  INSERT INTO events (
    name, set_size, target_judgings_per_team, max_judging_minutes,
    max_concurrent_judges, status
  ) VALUES (
    'sql concurrent judging', 5, 3, 20, 3, 'active'
  ) RETURNING id INTO v_event;

  FOR v_floor IN 1..3 LOOP
    INSERT INTO rooms (event_id, name, room_number, floor)
    VALUES (v_event, 'Floor ' || v_floor, v_floor * 100, v_floor)
    RETURNING id INTO v_room;
    v_rooms := v_rooms || v_room;
  END LOOP;

  FOR v_i IN 1..150 LOOP
    INSERT INTO teams (event_id, project_name, team_number, room_id)
    VALUES (
      v_event,
      'Project ' || v_i,
      v_i::text,
      v_rooms[1 + ((v_i - 1) % 3)]
    );
  END LOOP;

  FOR v_i IN 1..36 LOOP
    INSERT INTO judges (event_id, name, access_code)
    VALUES (v_event, 'Judge ' || v_i, 'JUDGE-' || lpad(v_i::text, 3, '0'))
    RETURNING id INTO v_judge;
    v_judges := v_judges || v_judge;
  END LOOP;

  -- More judges than teams/set_size (30). Every judge must still get 5 teams.
  FOR v_i IN 1..36 LOOP
    v_set := assign_set_to_judge(v_event, v_judges[v_i]);
    v_sets := v_sets || v_set;
  END LOOP;

  SELECT COUNT(*) INTO v_short
  FROM (
    SELECT judging_set_id
    FROM judging_set_teams
    WHERE judging_set_id = ANY (v_sets)
    GROUP BY judging_set_id
    HAVING COUNT(*) <> 5
  ) short_sets;
  IF v_short <> 0 THEN
    RAISE EXCEPTION 'Expected every judge to receive 5 teams, % sets were short', v_short;
  END IF;

  SELECT COALESCE(MAX(cnt), 0) INTO v_peak
  FROM (
    SELECT COUNT(*) AS cnt
    FROM team_locks
    WHERE released_at IS NULL
      AND team_id IN (SELECT id FROM teams WHERE event_id = v_event)
    GROUP BY team_id
  ) counts;
  IF v_peak > 3 THEN
    RAISE EXCEPTION 'Concurrent cap exceeded: % judges on one team', v_peak;
  END IF;
  IF v_peak < 2 THEN
    RAISE EXCEPTION 'Expected overlapping judges, peak inflight was %', v_peak;
  END IF;

  SELECT COUNT(*) INTO v_overlap
  FROM (
    SELECT team_id
    FROM team_locks
    WHERE released_at IS NULL
      AND team_id IN (SELECT id FROM teams WHERE event_id = v_event)
    GROUP BY team_id
    HAVING COUNT(*) >= 2
  ) overlapped;
  IF v_overlap = 0 THEN
    RAISE EXCEPTION 'No team is being judged by two judges';
  END IF;

  -- A second call while the set is active must return that same set.
  IF assign_set_to_judge(v_event, v_judges[1]) <> v_sets[1] THEN
    RAISE EXCEPTION 'Double-click created a second active set';
  END IF;

  SELECT ARRAY(
    SELECT team_id FROM judging_set_teams
    WHERE judging_set_id = v_sets[1]
    ORDER BY visit_order
  ) INTO v_previous;

  SELECT jsonb_agg(jsonb_build_object(
    'team_id', team_id,
    'rank', visit_order,
    'is_absent', false
  )) INTO v_rankings
  FROM judging_set_teams
  WHERE judging_set_id = v_sets[1];

  PERFORM submit_judging_set(v_sets[1], v_rankings);

  SELECT COUNT(*) INTO v_team_count
  FROM team_locks
  WHERE judging_set_id = v_sets[1] AND released_at IS NULL;
  IF v_team_count <> 0 THEN
    RAISE EXCEPTION 'Submit left % locks behind', v_team_count;
  END IF;

  -- Another judge's lock on a shared team must survive this submit.
  SELECT team_id INTO v_shared
  FROM team_locks
  WHERE released_at IS NULL
    AND team_id = ANY (v_previous)
  LIMIT 1;
  IF v_shared IS NULL THEN
    RAISE EXCEPTION 'Expected another judge to still be holding one of the submitted teams';
  END IF;

  SELECT times_judged INTO v_times FROM teams WHERE id = v_previous[1];
  IF v_times <> 1 THEN
    RAISE EXCEPTION 'Submit did not increment times_judged (got %)', v_times;
  END IF;

  v_set := assign_set_to_judge(v_event, v_judges[1]);
  SELECT ARRAY(
    SELECT team_id FROM judging_set_teams WHERE judging_set_id = v_set
  ) INTO v_next;

  SELECT COUNT(*) INTO v_repeat
  FROM unnest(v_previous) prev
  JOIN unnest(v_next) nxt ON nxt = prev;
  IF v_repeat <> 0 THEN
    RAISE EXCEPTION 'Judge was reassigned % team(s) they already ranked', v_repeat;
  END IF;
  IF COALESCE(array_length(v_next, 1), 0) <> 5 THEN
    RAISE EXCEPTION 'Judge could not get a new set while other judges were still out (got %)',
      COALESCE(array_length(v_next, 1), 0);
  END IF;

  -- Abandoning the new set releases only this judge's claim.
  PERFORM abandon_judging_set(v_set);
  SELECT COUNT(*) INTO v_other_lock
  FROM team_locks
  WHERE team_id = v_shared AND released_at IS NULL;
  IF v_other_lock < 1 THEN
    RAISE EXCEPTION 'Abandon released another judge''s lock';
  END IF;

  SELECT COUNT(*) INTO v_set_count
  FROM judging_sets
  WHERE judge_id = v_judges[1] AND status = 'active';
  IF v_set_count <> 0 THEN
    RAISE EXCEPTION 'Abandon left an active set';
  END IF;

  DELETE FROM events WHERE id = v_event;
  RAISE NOTICE 'concurrent judging SQL checks passed (peak inflight %, overlapped teams %)', v_peak, v_overlap;
END $$;
