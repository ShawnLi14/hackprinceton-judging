import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: list teams for an event (with room info and lock status)
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('teams')
    .select('*, room:rooms(*)')
    .eq('event_id', eventId)
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// POST: create or bulk-create teams
export async function POST(req: NextRequest) {
  const body = await req.json();

  const teams = Array.isArray(body) ? body : [body];

  const { data, error } = await supabase
    .from('teams')
    .insert(teams.map(t => ({
      event_id: t.event_id,
      project_name: t.project_name || null,
      track: t.track || null,
      team_number: t.team_number,
      room_id: t.room_id,
      devpost_url: t.devpost_url || null,
    })))
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// DELETE: delete a team
export async function DELETE(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get('id');
  if (!teamId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
