import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { access_code, event_id } = await req.json();

  if (!access_code || !event_id) {
    return NextResponse.json({ error: 'Missing access_code or event_id' }, { status: 400 });
  }

  const { data: judge, error } = await supabase
    .from('judges')
    .select('*, current_room:rooms(*)')
    .eq('event_id', event_id)
    .eq('access_code', access_code.toUpperCase())
    .single();

  if (error || !judge) {
    return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
  }

  if (!judge.is_active) {
    return NextResponse.json({ error: 'Judge is deactivated' }, { status: 403 });
  }

  // Check for active set
  const { data: activeSet } = await supabase
    .from('judging_sets')
    .select(`
      *,
      judging_set_teams(
        *,
        team:teams(*, room:rooms(*))
      )
    `)
    .eq('judge_id', judge.id)
    .eq('status', 'active')
    .order('assigned_at', { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    judge,
    active_set: activeSet || null,
  });
}
