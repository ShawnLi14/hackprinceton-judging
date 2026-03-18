import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: list judges for an event with their active sets
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const { data: judges, error } = await supabase
    .from('judges')
    .select('*, current_room:rooms(*)')
    .eq('event_id', eventId)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // For each judge, get their active set with team details
  const judgesWithSets = await Promise.all(
    (judges || []).map(async (judge) => {
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

      return {
        ...judge,
        active_set: activeSet || null,
      };
    })
  );

  return NextResponse.json(judgesWithSets);
}

// POST: create a judge
export async function POST(req: NextRequest) {
  const body = await req.json();

  const judges = Array.isArray(body) ? body : [body];

  const { data, error } = await supabase
    .from('judges')
    .insert(judges.map(j => ({
      event_id: j.event_id,
      name: j.name,
      access_code: j.access_code?.toUpperCase() || `JUDGE-${Math.floor(Math.random() * 900) + 100}`,
    })))
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

// DELETE: delete/deactivate a judge
export async function DELETE(req: NextRequest) {
  const judgeId = req.nextUrl.searchParams.get('id');
  if (!judgeId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabase
    .from('judges')
    .update({ is_active: false })
    .eq('id', judgeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
