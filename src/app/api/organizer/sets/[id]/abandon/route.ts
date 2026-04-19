import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, describeError, logEvent } from '@/lib/log';

// POST /api/organizer/sets/[id]/abandon
//
// Body (optional): { reason?: string }
//
// Force-abandon an active judging set: releases its team locks, marks the
// set expired, and sets the judge back to idle. Used when a judge has
// gone AWOL and the organizer wants to reclaim the teams immediately
// instead of waiting for the timeout-based release_expired_locks path.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: setId } = await context.params;
  if (!setId) {
    return NextResponse.json({ error: 'Missing set id' }, { status: 400 });
  }

  let reason: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.reason === 'string') reason = body.reason;
  } catch {
    // body is optional; ignore
  }

  // Snapshot the set + judge for the log row before we change anything.
  const { data: setRow, error: setError } = await supabase
    .from('judging_sets')
    .select(`
      id, event_id, judge_id, status, assigned_at,
      judging_set_teams(team_id),
      judge:judges(name, access_code)
    `)
    .eq('id', setId)
    .single();

  if (setError || !setRow) {
    return NextResponse.json({ error: 'Set not found' }, { status: 404 });
  }
  if (setRow.status !== 'active') {
    return NextResponse.json(
      { error: `Cannot abandon a set with status "${setRow.status}". Only active sets can be abandoned.` },
      { status: 400 }
    );
  }

  const teamIds = (setRow.judging_set_teams || []).map(r => r.team_id);
  const judge = setRow.judge as unknown as { name: string; access_code: string } | null;
  const judgeLabel = judge?.access_code || judge?.name || 'unknown judge';
  const elapsedMinutes = setRow.assigned_at
    ? Math.round((Date.now() - new Date(setRow.assigned_at).getTime()) / 60000)
    : null;

  const { error: rpcError } = await supabase.rpc('abandon_judging_set', { p_set_id: setId });

  if (rpcError) {
    await logEvent({
      event_id: setRow.event_id,
      actor: actorOrganizer(),
      action: 'set.abandon_failed',
      message: `Failed to abandon set for ${judgeLabel}`,
      details: { set_id: setId, error: describeError(rpcError) },
    });
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  await logEvent({
    event_id: setRow.event_id,
    actor: actorOrganizer(),
    action: 'set.abandoned_by_organizer',
    message:
      `Organizer reclaimed ${teamIds.length} team(s) from ${judgeLabel}` +
      (elapsedMinutes !== null ? ` after ${elapsedMinutes}m` : '') +
      (reason ? ` — ${reason}` : ''),
    details: {
      set_id: setId,
      judge_id: setRow.judge_id,
      team_ids: teamIds,
      elapsed_minutes: elapsedMinutes,
      reason,
    },
  });

  return NextResponse.json({ success: true });
}
