import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorFromJudgeId, logEvent } from '@/lib/log';

// Toggle a team's "visited" flag within a judging set.
// Body: { judging_set_id, team_id, is_visited?: boolean }
// `is_visited` defaults to true for backward compatibility.
export async function POST(req: NextRequest) {
  const { judging_set_id, team_id, is_visited } = await req.json();

  if (!judging_set_id || !team_id) {
    return NextResponse.json({ error: 'Missing judging_set_id or team_id' }, { status: 400 });
  }

  const visited = is_visited === false ? false : true;

  const { error } = await supabase
    .from('judging_set_teams')
    .update({ is_visited: visited })
    .eq('judging_set_id', judging_set_id)
    .eq('team_id', team_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Resolve event/judge/team labels for the log. Best-effort.
  let eventId: string | null = null;
  let actor = 'anonymous';
  let teamLabel: string | null = null;
  try {
    const { data: set } = await supabase
      .from('judging_sets')
      .select('event_id, judge_id')
      .eq('id', judging_set_id)
      .single();
    if (set) {
      eventId = set.event_id;
      actor = await actorFromJudgeId(set.judge_id);
    }
    const { data: team } = await supabase
      .from('teams')
      .select('team_number, project_name')
      .eq('id', team_id)
      .single();
    if (team) {
      teamLabel = team.project_name || `#${team.team_number}`;
    }
  } catch {
    // ignore
  }

  // Only update the judge's current room when actually marking a team visited.
  if (visited) {
    const { data: setTeam } = await supabase
      .from('judging_set_teams')
      .select('team:teams(room_id)')
      .eq('judging_set_id', judging_set_id)
      .eq('team_id', team_id)
      .single();

    if (setTeam) {
      const { data: set } = await supabase
        .from('judging_sets')
        .select('judge_id')
        .eq('id', judging_set_id)
        .single();

      if (set) {
        await supabase
          .from('judges')
          .update({ current_room_id: (setTeam.team as unknown as { room_id: string }).room_id })
          .eq('id', set.judge_id);
      }
    }
  }

  await logEvent({
    event_id: eventId,
    actor,
    action: visited ? 'team.visited' : 'team.unvisited',
    message: `${actor} marked ${teamLabel || team_id} ${visited ? 'visited' : 'not visited'}`,
    details: { judging_set_id, team_id },
  });

  return NextResponse.json({ success: true });
}
