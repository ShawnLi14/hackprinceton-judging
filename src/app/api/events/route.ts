import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
  return NextResponse.json(data);
}

// DELETE: delete an event (cascades to all related data)
export async function DELETE(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('id');
  if (!eventId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabase.from('events').delete().eq('id', eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
