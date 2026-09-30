// Pure selection rules for the next judging set.
//
// The production assignment runs inside assign_set_to_judge (see
// supabase/migrations/001_schema.sql and 005_concurrent_judging.sql), which
// holds an event-scoped advisory lock so two judges cannot plan from the
// same snapshot. This module is the same ordering, used by the JS fallback
// and by unit tests. If you change one, change the other.

export interface PolicyTeam {
  id: string;
  floor: number;
  roomNumber: number;
  timesJudged: number;
  /** Active locks: judges currently assigned this team and not yet submitted. */
  inflight: number;
  alreadyJudgedByThisJudge: boolean;
}

export interface PolicyOptions {
  setSize: number;
  /** Teams below this completed+inflight load are "under target" for floor choice. */
  target: number;
  /** Max judges who may hold this team at the same time. */
  maxConcurrent: number;
  judgeFloor: number | null;
  /** Injected so tests can freeze the room-order jitter. Defaults to Math.random. */
  random?: () => number;
}

export function loadScore(team: Pick<PolicyTeam, 'timesJudged' | 'inflight'>): number {
  return team.timesJudged + team.inflight;
}

/**
 * Team ids in visit order. Empty when every team is at the concurrent cap
 * or has already been judged by this judge.
 *
 * A team may already be inflight with other judges. Completed judgings and
 * inflight assignments both count toward load, so later judges fill gaps
 * instead of stacking on the same projects.
 */
export function planAssignment(teams: PolicyTeam[], options: PolicyOptions): string[] {
  const maxConcurrent = Math.max(1, options.maxConcurrent);
  const setSize = Math.max(0, options.setSize);
  if (setSize === 0) return [];

  const eligible = teams.filter(
    team => !team.alreadyJudgedByThisJudge && team.inflight < maxConcurrent
  );
  if (eligible.length === 0) return [];

  const byFloor = new Map<number, PolicyTeam[]>();
  for (const team of eligible) {
    const list = byFloor.get(team.floor);
    if (list) list.push(team);
    else byFloor.set(team.floor, [team]);
  }

  const floors = [...byFloor.entries()].map(([floor, list]) => ({
    floor,
    available: list.length,
    // Teams nobody is with yet. Filling these first spreads a wave of judges
    // across floors; overlap starts only after every floor is occupied.
    fresh: list.filter(team => team.timesJudged < options.target && team.inflight === 0).length,
    underTarget: list.filter(team => loadScore(team) < options.target).length,
    teams: list,
  }));

  floors.sort((a, b) => {
    if (b.fresh !== a.fresh) return b.fresh - a.fresh;
    if (b.underTarget !== a.underTarget) return b.underTarget - a.underTarget;
    if (b.available !== a.available) return b.available - a.available;
    if (options.judgeFloor !== null) {
      if (a.floor === options.judgeFloor && b.floor !== options.judgeFloor) return -1;
      if (b.floor === options.judgeFloor && a.floor !== options.judgeFloor) return 1;
    }
    return a.floor - b.floor;
  });

  const chosen = floors[0];
  const random = options.random ?? Math.random;
  const ranked = chosen.teams
    .map(team => ({ team, sortKey: team.roomNumber + random() * 3 }))
    .sort((a, b) => {
      const loadDelta = loadScore(a.team) - loadScore(b.team);
      if (loadDelta !== 0) return loadDelta;
      return a.sortKey - b.sortKey;
    });

  return ranked.slice(0, setSize).map(entry => entry.team.id);
}
