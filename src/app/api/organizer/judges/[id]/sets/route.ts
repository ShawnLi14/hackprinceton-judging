import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/organizer/judges/[id]/sets
//
// Returns every judging set ever assigned to this judge (active, completed,
// expired, skipped) with full team rows attached, newest-first. Used by the
// JudgeSetsDrawer on /organizer/dashboard.
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: judgeId } = await context.params;

  if (!judgeId) {
    return NextResponse.json({ error: 'Missing judge id' }, { status: 400 });
  }

  const { data: judge, error: judgeError } = await supabase
    .from('judges')
    .select('id, name, access_code, event_id, sets_completed, status')
    .eq('id', judgeId)
    .single();

  if (judgeError || !judge) {
    return NextResponse.json({ error: 'Judge not found' }, { status: 404 });
  }

  const { data: sets, error: setsError } = await supabase
    .from('judging_sets')
    .select(`
      id,
      event_id,
      judge_id,
      status,
      assigned_at,
      completed_at,
      created_at,
      judging_set_teams(
        id,
        team_id,
        visit_order,
        rank,
        notes,
        is_visited,
        is_absent,
        team:teams(*, room:rooms(*))
      )
    `)
    .eq('judge_id', judgeId)
    .order('assigned_at', { ascending: false });

  if (setsError) {
    return NextResponse.json({ error: setsError.message }, { status: 400 });
  }

  return NextResponse.json({ judge, sets: sets || [] });
}
