import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Mark a team as visited within a judging set
export async function POST(req: NextRequest) {
  const { judging_set_id, team_id } = await req.json();

  if (!judging_set_id || !team_id) {
    return NextResponse.json({ error: 'Missing judging_set_id or team_id' }, { status: 400 });
  }

  const { error } = await supabase
    .from('judging_set_teams')
    .update({ is_visited: true })
    .eq('judging_set_id', judging_set_id)
    .eq('team_id', team_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Update judge's current room to this team's room
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

  return NextResponse.json({ success: true });
}
