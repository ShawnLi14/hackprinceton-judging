import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/log';

export async function POST(req: NextRequest) {
  const { access_code, event_id } = await req.json();

  if (!access_code || !event_id) {
    return NextResponse.json({ error: 'Missing access_code or event_id' }, { status: 400 });
  }

  const codeUpper = String(access_code).toUpperCase();

  const { data: judge, error } = await supabase
    .from('judges')
    .select('*, current_room:rooms(*)')
    .eq('event_id', event_id)
    .eq('access_code', codeUpper)
    .single();

  if (error || !judge) {
    await logEvent({
      event_id,
      actor: codeUpper,
      action: 'judge.login_failed',
      message: `Login failed for code ${codeUpper}`,
      details: { reason: 'invalid_code' },
    });
    return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
  }

  if (!judge.is_active) {
    await logEvent({
      event_id,
      actor: codeUpper,
      action: 'judge.login_failed',
      message: `Login refused for ${judge.name || codeUpper} (deactivated)`,
      details: { reason: 'deactivated', judge_id: judge.id },
    });
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

  await logEvent({
    event_id,
    actor: judge.access_code || judge.name || codeUpper,
    action: 'judge.login',
    message: `${judge.name || judge.access_code} logged in${activeSet ? ' (resumed active set)' : ''}`,
    details: {
      judge_id: judge.id,
      resumed_set_id: activeSet?.id || null,
    },
  });

  return NextResponse.json({
    judge,
    active_set: activeSet || null,
  });
}
