import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/organizer/results?event_id=...
//
// Aggregates relative ranks from completed judging sets into a normalized
// score per team using a normalized Borda count.
//
// For a completed set with K present teams (K = total teams in the set minus
// teams marked absent), a team ranked r (1 = best, K = worst) earns:
//
//   norm = (K - r) / (K - 1)    for K >= 2
//   norm = 1.0                  for K == 1  (only one present team)
//
// We then average each team's normalized scores across all of its appearances
// in completed sets and scale the average to a 0-5 display range so existing
// UI affordances continue to read naturally.
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const { data: teams } = await supabase
    .from('teams')
    .select('*, room:rooms(*)')
    .eq('event_id', eventId)
    .eq('is_active', true);

  if (!teams) return NextResponse.json([]);

  // All judging_set_teams from completed sets in this event. We pull is_absent
  // and rank for every row (including absent rows) so we can compute the
  // present-team count K per set.
  const { data: allRows } = await supabase
    .from('judging_set_teams')
    .select(`
      team_id,
      rank,
      is_absent,
      judging_set_id,
      judging_set:judging_sets!inner(event_id, status)
    `)
    .eq('judging_set.event_id', eventId)
    .eq('judging_set.status', 'completed');

  // Bucket rows by judging_set_id to compute K (present teams) per set.
  const setBuckets = new Map<
    string,
    { presentCount: number; rows: { team_id: string; rank: number }[] }
  >();
  for (const row of allRows || []) {
    if (row.is_absent) continue;
    if (typeof row.rank !== 'number') continue;
    let bucket = setBuckets.get(row.judging_set_id);
    if (!bucket) {
      bucket = { presentCount: 0, rows: [] };
      setBuckets.set(row.judging_set_id, bucket);
    }
    bucket.presentCount += 1;
    bucket.rows.push({ team_id: row.team_id, rank: row.rank });
  }

  // Aggregate normalized scores per team.
  const teamAgg: Record<string, { sum: number; count: number }> = {};
  for (const { presentCount, rows } of setBuckets.values()) {
    for (const { team_id, rank } of rows) {
      const norm =
        presentCount <= 1 ? 1 : (presentCount - rank) / (presentCount - 1);
      if (!teamAgg[team_id]) teamAgg[team_id] = { sum: 0, count: 0 };
      teamAgg[team_id].sum += norm;
      teamAgg[team_id].count += 1;
    }
  }

  const results = teams.map(team => {
    const agg = teamAgg[team.id];
    const averageNormalized = agg ? agg.sum / agg.count : null; // 0..1
    const displayScore = averageNormalized === null ? null : averageNormalized * 5; // 0..5
    return {
      id: team.id,
      project_name: team.project_name,
      track: team.track || null,
      team_number: team.team_number,
      room_name: team.room?.name || 'Unknown',
      floor: team.room?.floor || 0,
      times_judged: team.times_judged,
      num_rankings: agg?.count || 0,
      average_normalized_rank: averageNormalized,
      score: displayScore,
    };
  });

  // Sort by track (alphabetical, nulls last), then score desc, then
  // num_rankings desc as a confidence tiebreaker, then project_name alpha.
  results.sort((a, b) => {
    const trackA = a.track || '';
    const trackB = b.track || '';
    if (trackA !== trackB) {
      if (!trackA) return 1;
      if (!trackB) return -1;
      return trackA.localeCompare(trackB);
    }
    if (a.score === null && b.score !== null) return 1;
    if (b.score === null && a.score !== null) return -1;
    if (a.score !== null && b.score !== null && a.score !== b.score) {
      return b.score - a.score;
    }
    if (a.num_rankings !== b.num_rankings) return b.num_rankings - a.num_rankings;
    return (a.project_name || '').localeCompare(b.project_name || '');
  });

  return NextResponse.json(results);
}
