import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, logEvent } from '@/lib/log';

export async function POST(req: NextRequest) {
  const { admin_code, event_id } = await req.json();

  if (!admin_code || !event_id) {
    return NextResponse.json({ error: 'Missing admin_code or event_id' }, { status: 400 });
  }

  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', event_id)
    .eq('admin_code', admin_code)
    .single();

  if (error || !event) {
    await logEvent({
      event_id,
      actor: actorOrganizer(),
      action: 'organizer.login_failed',
      message: 'Invalid admin code',
      details: { reason: 'invalid_admin_code' },
    });
    return NextResponse.json({ error: 'Invalid admin code' }, { status: 401 });
  }

  await logEvent({
    event_id,
    actor: actorOrganizer(),
    action: 'organizer.login',
    message: `Organizer logged in to "${event.name}"`,
  });

  return NextResponse.json({ event });
}
