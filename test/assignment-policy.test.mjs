/**
 * Assignment policy tests.
 *
 * These cover the realistic HackPrinceton field without a database:
 *   ~150 teams, ~30 judges, sets of 5, up to 3 judges with one team.
 *
 * The SQL function assign_set_to_judge is serialized per event and applies
 * the same ordering as src/lib/assignment-policy.ts. Running the planners
 * one after another (updating inflight between them) is the behavior the
 * advisory lock produces. test/run-simulation.js is the HTTP-level check
 * once Supabase is up; this file is the one that runs in CI without it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExpectedAssignmentFailure, planAssignment } from '../src/lib/assignment-policy.ts';

const ZERO = () => 0;

function makeTeams({ count, floors, perRoom = 8 }) {
  const teams = [];
  for (let i = 0; i < count; i++) {
    const floor = floors[i % floors.length];
    const roomNumber = Math.floor(i / floors.length) + 1;
    teams.push({
      id: `t${i + 1}`,
      floor,
      roomNumber,
      timesJudged: 0,
      inflight: 0,
      alreadyJudgedByThisJudge: false,
    });
  }
  // perRoom is unused for layout; roomNumber still spreads teams so the
  // proximity jitter has something to sort. Kept so callers can document
  // density without changing the assertions that don't care about rooms.
  void perRoom;
  return teams;
}

function snapshot(teams, judgeSeen, inflight) {
  return teams.map(team => ({
    ...team,
    inflight: inflight.get(team.id) || 0,
    alreadyJudgedByThisJudge: judgeSeen.has(team.id),
  }));
}

/**
 * Assign `judgeCount` judges one at a time, the way the advisory lock does.
 * Returns the sets and mutates inflight.
 */
function assignWave(teams, judgeCount, inflight, seenByJudge, options) {
  const sets = [];
  for (let judge = 0; judge < judgeCount; judge++) {
    const seen = seenByJudge.get(judge) || new Set();
    const ids = planAssignment(snapshot(teams, seen, inflight), {
      setSize: options.setSize,
      target: options.target,
      maxConcurrent: options.maxConcurrent,
      judgeFloor: options.judgeFloor ?? null,
      random: ZERO,
    });
    sets.push(ids);
    for (const id of ids) inflight.set(id, (inflight.get(id) || 0) + 1);
  }
  return sets;
}

function maxInflight(inflight) {
  let max = 0;
  for (const n of inflight.values()) max = Math.max(max, n);
  return max;
}

test('a judge gets nobody when every team is at the concurrent cap', () => {
  const teams = makeTeams({ count: 10, floors: [1] }).map(team => ({ ...team, inflight: 3 }));
  const ids = planAssignment(teams, {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
    judgeFloor: 1,
    random: ZERO,
  });
  assert.deepEqual(ids, []);
});

test('maxConcurrent 1 keeps a team with a single judge', () => {
  const teams = makeTeams({ count: 10, floors: [1] });
  const inflight = new Map();
  const seen = new Map();
  const sets = assignWave(teams, 3, inflight, seen, {
    setSize: 5,
    target: 3,
    maxConcurrent: 1,
  });
  assert.equal(sets[0].length, 5);
  assert.equal(sets[1].length, 5);
  assert.deepEqual(sets[2], []);
  const all = sets.flat();
  assert.equal(new Set(all).size, all.length);
  assert.equal(maxInflight(inflight), 1);
});

test('a judge is not handed a team they already finished', () => {
  const teams = makeTeams({ count: 8, floors: [1] }).map(team => ({
    ...team,
    alreadyJudgedByThisJudge: true,
    inflight: 0,
  }));
  const ids = planAssignment(teams, {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
    judgeFloor: null,
    random: ZERO,
  });
  assert.deepEqual(ids, []);
});

test('prefers the judge floor when under-target counts tie', () => {
  const teams = [
    ...makeTeams({ count: 4, floors: [1] }).map((team, i) => ({ ...team, id: `a${i}`, floor: 1 })),
    ...makeTeams({ count: 4, floors: [2] }).map((team, i) => ({ ...team, id: `b${i}`, floor: 2 })),
  ];
  const ids = planAssignment(teams, {
    setSize: 4,
    target: 3,
    maxConcurrent: 3,
    judgeFloor: 2,
    random: ZERO,
  });
  assert.ok(ids.every(id => id.startsWith('b')));
});

test('leaves a full floor and uses the next one', () => {
  const teams = [
    ...[0, 1, 2].map(i => ({
      id: `full${i}`,
      floor: 1,
      roomNumber: i,
      timesJudged: 0,
      inflight: 3,
      alreadyJudgedByThisJudge: false,
    })),
    ...[0, 1, 2, 3].map(i => ({
      id: `open${i}`,
      floor: 2,
      roomNumber: i,
      timesJudged: 0,
      inflight: 0,
      alreadyJudgedByThisJudge: false,
    })),
  ];
  const ids = planAssignment(teams, {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
    judgeFloor: 1,
    random: ZERO,
  });
  assert.deepEqual(ids, ['open0', 'open1', 'open2', 'open3']);
});

test('returns a short set when the floor has fewer eligible teams than the set size', () => {
  const teams = makeTeams({ count: 2, floors: [1] });
  const ids = planAssignment(teams, {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
    judgeFloor: 1,
    random: ZERO,
  });
  assert.equal(ids.length, 2);
});

test('the first wave spreads across floors before anyone overlaps', () => {
  const teams = makeTeams({ count: 30, floors: [1, 2, 3] });
  const inflight = new Map();
  const sets = assignWave(teams, 6, inflight, new Map(), {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
  });
  assert.ok(sets.every(set => set.length === 5));
  assert.equal(maxInflight(inflight), 1);
  assert.equal([...inflight.values()].filter(n => n === 1).length, 30);
});

test('production shape: 36 judges and 150 teams all get a full set at once', () => {
  // 150 / 5 = 30. Thirty-six judges cannot all hold a set of 5 unless some
  // teams are judged by two people at the same time.
  const teams = makeTeams({ count: 150, floors: [1, 2, 3] });
  const inflight = new Map();
  const seen = new Map();
  const sets = assignWave(teams, 36, inflight, seen, {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
  });

  assert.equal(sets.length, 36);
  for (const set of sets) {
    assert.equal(set.length, 5, 'every judge should receive a full set');
    assert.equal(new Set(set).size, 5, 'a set should not contain the same team twice');
  }

  const peak = maxInflight(inflight);
  assert.ok(peak >= 2, `expected overlap, peak inflight was ${peak}`);
  assert.ok(peak <= 3, `cap exceeded, peak inflight was ${peak}`);

  // Same inputs with an exclusive cap: judges past the 30th sit idle.
  const exclusive = new Map();
  const exclusiveSets = assignWave(teams, 36, exclusive, new Map(), {
    setSize: 5,
    target: 3,
    maxConcurrent: 1,
  });
  const seated = exclusiveSets.filter(set => set.length === 5).length;
  assert.equal(seated, 30);
  assert.deepEqual(exclusiveSets[30], []);
});

test('a judge who finishes can get another set while everyone else is still out', () => {
  // The failure from the last event: 30 judges hold all 150 teams. One
  // submits. Under exclusive locks they cannot be given anyone new, because
  // the five teams they just released are exactly the ones they already
  // ranked, and every other team is locked.
  const teams = makeTeams({ count: 150, floors: [1, 2, 3] });
  const inflight = new Map();
  const seenByJudge = new Map();
  const sets = assignWave(teams, 30, inflight, seenByJudge, {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
  });
  assert.ok(sets.every(set => set.length === 5));
  assert.equal(maxInflight(inflight), 1);
  assert.equal([...inflight.values()].filter(n => n > 0).length, 150);

  const finished = 0;
  const previous = new Set(sets[finished]);
  for (const id of previous) {
    inflight.set(id, (inflight.get(id) || 0) - 1);
    const team = teams.find(row => row.id === id);
    team.timesJudged += 1;
  }
  seenByJudge.set(finished, previous);

  const blocked = planAssignment(snapshot(teams, previous, inflight), {
    setSize: 5,
    target: 3,
    maxConcurrent: 1,
    judgeFloor: null,
    random: ZERO,
  });
  assert.deepEqual(blocked, [], 'exclusive locking leaves this judge with nobody');

  const next = planAssignment(snapshot(teams, previous, inflight), {
    setSize: 5,
    target: 3,
    maxConcurrent: 3,
    judgeFloor: null,
    random: ZERO,
  });
  assert.equal(next.length, 5);
  for (const id of next) assert.equal(previous.has(id), false);
});

test('three full rounds of 30 judges cover 150 teams evenly', () => {
  const teams = makeTeams({ count: 150, floors: [1, 2, 3] });
  const seenByJudge = new Map();

  for (let round = 0; round < 3; round++) {
    const inflight = new Map();
    const sets = assignWave(teams, 30, inflight, seenByJudge, {
      setSize: 5,
      target: 3,
      maxConcurrent: 3,
    });
    assert.ok(sets.every(set => set.length === 5), `round ${round} had a short set`);
    for (let judge = 0; judge < sets.length; judge++) {
      const seen = seenByJudge.get(judge) || new Set();
      for (const id of sets[judge]) {
        assert.equal(seen.has(id), false, `judge ${judge} saw ${id} twice`);
        seen.add(id);
        const team = teams.find(row => row.id === id);
        team.timesJudged += 1;
      }
      seenByJudge.set(judge, seen);
    }
  }

  const counts = teams.map(team => team.timesJudged);
  assert.equal(Math.min(...counts), 3);
  assert.equal(Math.max(...counts), 3);
});

test('lower completed-plus-inflight teams are chosen before busier ones', () => {
  const teams = [
    { id: 'busy', floor: 1, roomNumber: 1, timesJudged: 2, inflight: 0, alreadyJudgedByThisJudge: false },
    { id: 'live', floor: 1, roomNumber: 2, timesJudged: 0, inflight: 1, alreadyJudgedByThisJudge: false },
    { id: 'fresh', floor: 1, roomNumber: 9, timesJudged: 0, inflight: 0, alreadyJudgedByThisJudge: false },
  ];
  const ids = planAssignment(teams, {
    setSize: 2,
    target: 3,
    maxConcurrent: 3,
    judgeFloor: 1,
    random: ZERO,
  });
  // fresh load 0, live load 1, busy load 2. Room number must not jump the queue.
  assert.deepEqual(ids, ['fresh', 'live']);
});

test('a missing assignment function is not treated as an empty pool', () => {
  assert.equal(
    isExpectedAssignmentFailure(
      'Could not find the function public.assign_set_to_judge(p_event_id, p_judge_id) in the schema cache'
    ),
    false
  );
  assert.equal(isExpectedAssignmentFailure('No available teams on any floor'), true);
  assert.equal(isExpectedAssignmentFailure('No available teams could be locked'), true);
  assert.equal(isExpectedAssignmentFailure('Event is not active'), true);
  assert.equal(isExpectedAssignmentFailure('Judge is on break'), true);
  assert.equal(isExpectedAssignmentFailure('Judge is deactivated'), true);
});

test('planning a 150-team field stays well under a frame', () => {
  const teams = makeTeams({ count: 150, floors: [1, 2, 3, 4, 5, 6] });
  const started = Date.now();
  for (let i = 0; i < 400; i++) {
    planAssignment(teams, {
      setSize: 5,
      target: 3,
      maxConcurrent: 3,
      judgeFloor: (i % 6) + 1,
      random: ZERO,
    });
  }
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `400 plans took ${elapsed}ms`);
});
