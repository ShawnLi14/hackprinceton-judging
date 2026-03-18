import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // If completing, release all active locks and expire active sets
  if (action === 'complete') {
    await supabase
      .from('team_locks')
      .update({ released_at: new Date().toISOString() })
      .is('released_at', null);

    await supabase
      .from('judging_sets')
      .update({ status: 'expired', completed_at: new Date().toISOString() })
      .eq('event_id', event_id)
      .eq('status', 'active');
  }

  return NextResponse.json(data);
}
