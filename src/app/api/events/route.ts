import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, logEvent } from '@/lib/log';

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'hehe1414';

function checkPassword(password: string | undefined) {
  if (password !== SITE_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }
  return null;
}

// GET: list events or get specific event
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('id');

  if (eventId) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// POST: create a new event
export async function POST(req: NextRequest) {
  const body = await req.json();

  const denied = checkPassword(body.password);
  if (denied) return denied;

  const { data, error } = await supabase
    .from('events')
    .insert({
      name: body.name,
      set_size: body.set_size || 5,
      target_judgings_per_team: body.target_judgings_per_team || 3,
      max_judging_minutes: body.max_judging_minutes || 20,
      admin_code: body.admin_code || 'ADMIN',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await logEvent({
    event_id: data.id,
    actor: actorOrganizer(),
    action: 'event.created',
    message: `Event "${data.name}" created`,
    details: {
      set_size: data.set_size,
      target_judgings_per_team: data.target_judgings_per_team,
      max_judging_minutes: data.max_judging_minutes,
    },
  });

  return NextResponse.json(data);
}

// PATCH: update event configuration
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const eventId = body.id;
  if (!eventId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.set_size !== undefined) updates.set_size = body.set_size;
  if (body.target_judgings_per_team !== undefined) updates.target_judgings_per_team = body.target_judgings_per_team;
  if (body.max_judging_minutes !== undefined) updates.max_judging_minutes = body.max_judging_minutes;
  if (body.admin_code !== undefined) updates.admin_code = body.admin_code;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data: before } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single();

  const { data, error } = await supabase
    .from('events')
    .update(updates)
    .eq('id', eventId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Diff fields, redact admin_code value but record that it changed.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(updates)) {
    const fromVal = (before as Record<string, unknown> | null)?.[k];
    const toVal = (data as Record<string, unknown>)[k];
    if (fromVal !== toVal) {
      if (k === 'admin_code') {
        changes[k] = { from: '[redacted]', to: '[redacted]' };
      } else {
        changes[k] = { from: fromVal, to: toVal };
      }
    }
  }

  await logEvent({
    event_id: eventId,
    actor: actorOrganizer(),
    action: 'event.patched',
    message: `Event "${data.name}" updated (${Object.keys(changes).join(', ') || 'no changes'})`,
    details: { changes },
  });

  return NextResponse.json(data);
}

// DELETE: delete an event (cascades to all related data)
export async function DELETE(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('id');
  const password = req.nextUrl.searchParams.get('password');
  if (!eventId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const denied = checkPassword(password || undefined);
  if (denied) return denied;

  const { data: before } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', eventId)
    .single();

  // Log BEFORE delete because cascade will null event_id on the log row
  // (ON DELETE SET NULL), but the message still preserves what happened.
  await logEvent({
    event_id: eventId,
    actor: actorOrganizer(),
    action: 'event.deleted',
    message: `Event "${before?.name || eventId}" deleted (cascades to all related data)`,
    details: { event_id: eventId, name: before?.name },
  });

  const { error } = await supabase.from('events').delete().eq('id', eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
