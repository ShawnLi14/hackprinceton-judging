/**
 * Parallel assignment against a live Postgres.
 *
 * Opens one connection per judge and calls assign_set_to_judge at the same
 * time. The advisory lock has to serialize them: every judge still gets a
 * full set, no team exceeds the cap, and the calls come back in well under
 * a second each.
 *
 * Usage:
 *   sudo -u postgres node test/concurrent-assign.mjs
 *   DATABASE_URL=postgres://... node test/concurrent-assign.mjs
 *
 * Requires the schema in supabase/migrations/001_schema.sql. Uses the `pg`
 * driver when DATABASE_URL is set; otherwise connects through the local
 * socket as the postgres user (peer auth).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const JUDGES = 40;
const TEAMS = 150;
const SET_SIZE = 5;
const CAP = 3;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
}

function tuples(stdout) {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^(INSERT|UPDATE|DELETE)\b/.test(line));
}

async function psql(sql) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql];
  const { stdout } = process.env.DATABASE_URL
    ? await execFileAsync('psql', [process.env.DATABASE_URL, ...args], { maxBuffer: 10 * 1024 * 1024 })
    : await execFileAsync('sudo', ['-u', 'postgres', 'psql', ...args], { maxBuffer: 10 * 1024 * 1024 });
  return tuples(stdout).join('\n');
}

async function main() {
  await psql(`DELETE FROM events WHERE name = 'parallel wave';`);
  const eventId = await psql(`
    INSERT INTO events (name, set_size, target_judgings_per_team, max_judging_minutes, max_concurrent_judges, status)
    VALUES ('parallel wave', ${SET_SIZE}, 3, 20, ${CAP}, 'active')
    RETURNING id;
  `);

  try {
    await psql(`
      INSERT INTO rooms (event_id, name, room_number, floor)
      SELECT '${eventId}', 'Floor ' || f, f * 100, f
      FROM generate_series(1, 3) AS f;
    `);
    await psql(`
      INSERT INTO teams (event_id, project_name, team_number, room_id)
      SELECT '${eventId}', 'Project ' || n, n::text, r.id
      FROM generate_series(1, ${TEAMS}) AS n
      JOIN rooms r ON r.event_id = '${eventId}' AND r.floor = 1 + ((n - 1) % 3);
    `);
    await psql(`
      INSERT INTO judges (event_id, name, access_code)
      SELECT '${eventId}', 'Judge ' || n, 'WAVE-' || lpad(n::text, 3, '0')
      FROM generate_series(1, ${JUDGES}) AS n;
    `);

    const judgeIds = (await psql(`
      SELECT id FROM judges WHERE event_id = '${eventId}' ORDER BY access_code;
    `)).split('\n').filter(Boolean);
    assert(judgeIds.length === JUDGES, `expected ${JUDGES} judges, got ${judgeIds.length}`);

    const started = Date.now();
    const timings = await Promise.all(judgeIds.map(async (judgeId, index) => {
      const t0 = Date.now();
      try {
        const setId = await psql(`SELECT assign_set_to_judge('${eventId}', '${judgeId}');`);
        return { index, setId, ms: Date.now() - t0, error: null };
      } catch (error) {
        return { index, setId: null, ms: Date.now() - t0, error: error.stderr || error.message };
      }
    }));
    const waveMs = Date.now() - started;

    const failures = timings.filter(row => row.error);
    assert(failures.length === 0, `${failures.length} parallel assigns failed: ${failures[0]?.error}`);

    const slow = timings.filter(row => row.ms > 5000);
    const slowest = Math.max(...timings.map(row => row.ms));
    console.log(`parallel assign: ${JUDGES} judges in ${waveMs}ms wall, slowest call ${slowest}ms`);
    assert(slow.length === 0, `${slow.length} assigns took over 5s (slowest ${slowest}ms)`);

    const summary = await psql(`
      SELECT
        (SELECT COUNT(*) FROM judging_sets WHERE event_id = '${eventId}' AND status = 'active') AS active_sets,
        (SELECT COUNT(*) FROM (
          SELECT judging_set_id FROM judging_set_teams jst
          JOIN judging_sets js ON js.id = jst.judging_set_id
          WHERE js.event_id = '${eventId}' AND js.status = 'active'
          GROUP BY judging_set_id
          HAVING COUNT(*) <> ${SET_SIZE}
        ) short) AS short_sets,
        (SELECT COUNT(*) FROM (
          SELECT jst.judging_set_id, jst.team_id
          FROM judging_set_teams jst
          JOIN judging_sets js ON js.id = jst.judging_set_id
          WHERE js.event_id = '${eventId}'
          GROUP BY jst.judging_set_id, jst.team_id
          HAVING COUNT(*) > 1
        ) dup) AS duplicate_rows,
        (SELECT COALESCE(MAX(cnt), 0) FROM (
          SELECT COUNT(*) AS cnt
          FROM team_locks tl
          JOIN teams t ON t.id = tl.team_id
          WHERE t.event_id = '${eventId}' AND tl.released_at IS NULL
          GROUP BY tl.team_id
        ) c) AS peak,
        (SELECT COALESCE(MIN(cnt), 0) FROM (
          SELECT COUNT(*) AS cnt
          FROM team_locks tl
          JOIN teams t ON t.id = tl.team_id
          WHERE t.event_id = '${eventId}' AND tl.released_at IS NULL
          GROUP BY tl.team_id
        ) c) AS floor_count,
        (SELECT COUNT(DISTINCT tl.team_id)
          FROM team_locks tl
          JOIN teams t ON t.id = tl.team_id
          WHERE t.event_id = '${eventId}' AND tl.released_at IS NULL) AS teams_held;
    `);
    const [activeSets, shortSets, duplicateRows, peak, minHeld, teamsHeld] = summary.split('|').map(Number);
    console.log(`active=${activeSets} short=${shortSets} dup=${duplicateRows} peak=${peak} min=${minHeld} teams=${teamsHeld}`);
    assert(activeSets === JUDGES, `active sets ${activeSets}`);
    assert(shortSets === 0, `${shortSets} sets were short of ${SET_SIZE}`);
    assert(duplicateRows === 0, 'a set contained the same team twice');
    assert(peak >= 2 && peak <= CAP, `peak inflight ${peak} outside 2..${CAP}`);
    assert(minHeld >= 1, 'some team was left with nobody during a saturated wave');
    assert(teamsHeld === TEAMS, `only ${teamsHeld} of ${TEAMS} teams were held`);

    // Submit half the sets while the other half is still out, all at once.
    const submitIds = timings.slice(0, 15).map(row => row.setId);
    const submitStarted = Date.now();
    await Promise.all(submitIds.map(async setId => {
      const t0 = Date.now();
      await psql(`
        SELECT submit_judging_set(
          '${setId}',
          (
            SELECT jsonb_agg(jsonb_build_object(
              'team_id', team_id,
              'rank', visit_order,
              'is_absent', false
            ))
            FROM judging_set_teams
            WHERE judging_set_id = '${setId}'
          )
        );
      `);
      return Date.now() - t0;
    }));
    const submitWall = Date.now() - submitStarted;
    console.log(`parallel submit: 15 sets in ${submitWall}ms wall`);
    assert(submitWall < 5000, `submits took ${submitWall}ms`);

    const released = Number(await psql(`
      SELECT COUNT(*) FROM team_locks
      WHERE judging_set_id IN (${submitIds.map(id => `'${id}'`).join(',')})
        AND released_at IS NULL;
    `));
    assert(released === 0, `${released} locks survived submit`);

    console.log('parallel wave passed');
  } finally {
    await psql(`DELETE FROM events WHERE id = '${eventId}';`);
  }
}

main().catch(error => {
  console.error(error.stderr || error.message || error);
  process.exit(1);
});
