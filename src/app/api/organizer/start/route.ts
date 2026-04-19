import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, describeError, logEvent } from '@/lib/log';

// POST: start or pause the event
export async function POST(req: NextRequest) {
  const { event_id, action } = await req.json();

  if (!event_id || !action) {
    return NextResponse.json({ error: 'Missing event_id or action' }, { status: 400 });
  }

  if (!['start', 'pause', 'complete'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const statusMap: Record<string, string> = {
    start: 'active',
    pause: 'paused',
    complete: 'completed',
  };

  const { data, error } = await supabase
    .from('events')
    .update({ status: statusMap[action] })
    .eq('id', event_id)
    .select()
    .single();

  if (error) {
    await logEvent({
      event_id,
      actor: actorOrganizer(),
      action: `event.${action}_failed`,
      message: `Failed to ${action} event`,
      details: { error: describeError(error) },
    });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let releasedLocks = 0;
  let expiredSets = 0;
  if (action === 'complete') {
    const { data: lockRows } = await supabase
      .from('team_locks')
      .update({ released_at: new Date().toISOString() })
      .is('released_at', null)
      .select('id');
    releasedLocks = lockRows?.length || 0;

    const { data: setRows } = await supabase
      .from('judging_sets')
      .update({ status: 'expired', completed_at: new Date().toISOString() })
      .eq('event_id', event_id)
      .eq('status', 'active')
      .select('id');
    expiredSets = setRows?.length || 0;
  }

  await logEvent({
    event_id,
    actor: actorOrganizer(),
    action: `event.${action}`,
    message: `Organizer ${action === 'start' ? 'started' : action === 'pause' ? 'paused' : 'completed'} event "${data.name}"`,
    details: action === 'complete'
      ? { released_locks: releasedLocks, expired_sets: expiredSets }
      : null,
  });

  return NextResponse.json(data);
}
