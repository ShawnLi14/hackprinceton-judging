import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: get aggregated results for an event
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  // Get all teams with their rooms
  const { data: teams } = await supabase
    .from('teams')
    .select('*, room:rooms(*)')
    .eq('event_id', eventId)
    .eq('is_active', true);

  if (!teams) return NextResponse.json([]);

  // Get all completed set teams with ranks
  const { data: allRankings } = await supabase
    .from('judging_set_teams')
    .select(`
      team_id,
      rank,
      is_absent,
      judging_set:judging_sets!inner(event_id, status, set_size:id)
    `)
    .eq('judging_set.event_id', eventId)
    .eq('judging_set.status', 'completed')
    .not('rank', 'is', null);

  // Calculate average normalized rank per team
  // Normalize: rank / set_size (so 1st of 5 = 0.2, 5th of 5 = 1.0)
  const teamScores: Record<string, { totalNormalizedRank: number; count: number }> = {};

  // Get event set_size for normalization
  const { data: event } = await supabase
    .from('events')
    .select('set_size')
    .eq('id', eventId)
    .single();

  const setSize = event?.set_size || 5;

  for (const r of allRankings || []) {
    if (r.is_absent || !r.rank) continue;
    if (!teamScores[r.team_id]) {
      teamScores[r.team_id] = { totalNormalizedRank: 0, count: 0 };
    }
    // Lower rank = better, normalize by set size
    teamScores[r.team_id].totalNormalizedRank += r.rank / setSize;
    teamScores[r.team_id].count += 1;
  }

  const results = teams.map(team => {
    const scores = teamScores[team.id];
    const avgNormalizedRank = scores ? scores.totalNormalizedRank / scores.count : null;
    return {
      id: team.id,
      name: team.name,
      project_name: team.project_name,
      table_number: team.table_number,
      room_name: team.room?.name || 'Unknown',
      floor: team.room?.floor || 0,
      times_judged: team.times_judged,
      num_rankings: scores?.count || 0,
      average_normalized_rank: avgNormalizedRank,
      // Lower is better: invert for a "score" where higher = better
      score: avgNormalizedRank !== null ? (1 - avgNormalizedRank) * 100 : null,
    };
  });

  // Sort by score descending (best first)
  results.sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });

  return NextResponse.json(results);
}
