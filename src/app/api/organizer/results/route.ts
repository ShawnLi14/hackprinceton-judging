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

  // The existing `rank` column now stores the submitted 1-5 score.
  const { data: allScores } = await supabase
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

  const teamScores: Record<string, { totalScore: number; count: number }> = {};

  for (const score of allScores || []) {
    if (score.is_absent || !score.rank) continue;
    if (!teamScores[score.team_id]) {
      teamScores[score.team_id] = { totalScore: 0, count: 0 };
    }
    teamScores[score.team_id].totalScore += score.rank;
    teamScores[score.team_id].count += 1;
  }

  const results = teams.map(team => {
    const scores = teamScores[team.id];
    const averageScore = scores ? scores.totalScore / scores.count : null;
    return {
      id: team.id,
      project_name: team.project_name,
      track: team.track || null,
      team_number: team.team_number,
      room_name: team.room?.name || 'Unknown',
      floor: team.room?.floor || 0,
      times_judged: team.times_judged,
      num_rankings: scores?.count || 0,
      average_normalized_rank: averageScore,
      score: averageScore,
    };
  });

  // Sort by track (alphabetical, nulls last) then by score descending
  results.sort((a, b) => {
    const trackA = a.track || '';
    const trackB = b.track || '';
    if (trackA !== trackB) {
      if (!trackA) return 1;
      if (!trackB) return -1;
      return trackA.localeCompare(trackB);
    }
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });

  return NextResponse.json(results);
}
