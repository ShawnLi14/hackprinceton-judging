import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, logEvent } from '@/lib/log';

// GET: list rooms for an event
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('event_id', eventId)
    .order('floor')
    .order('room_number');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// POST: create or bulk-create rooms
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Support both single and bulk creation
  const rooms = Array.isArray(body) ? body : [body];

  const { data, error } = await supabase
    .from('rooms')
    .insert(rooms.map(r => ({
      event_id: r.event_id,
      name: r.name,
      room_number: r.room_number,
      floor: r.floor || 1,
    })))
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await logEvent({
    event_id: rooms[0]?.event_id || null,
    actor: actorOrganizer(),
    action: 'room.created',
    message: `Created ${data?.length || 0} room(s)`,
    details: { count: data?.length || 0 },
  });

  return NextResponse.json(data);
}

// DELETE: delete a room
export async function DELETE(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get('id');
  if (!roomId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { data: before } = await supabase
    .from('rooms')
    .select('id, name, room_number, floor, event_id')
    .eq('id', roomId)
    .single();

  const { error } = await supabase.from('rooms').delete().eq('id', roomId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await logEvent({
    event_id: before?.event_id || null,
    actor: actorOrganizer(),
    action: 'room.deleted',
    message: `Deleted room ${before?.name || roomId}`,
    details: { room_id: roomId, room: before },
  });

  return NextResponse.json({ success: true });
}
