import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorFromJudgeId, logEvent } from '@/lib/log';

// Toggle judge break status
export async function POST(req: NextRequest) {
  const { judge_id, on_break } = await req.json();

  if (!judge_id) {
    return NextResponse.json({ error: 'Missing judge_id' }, { status: 400 });
  }

  const { error } = await supabase
    .from('judges')
    .update({ status: on_break ? 'on_break' : 'idle' })
    .eq('id', judge_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let eventId: string | null = null;
  try {
    const { data } = await supabase.from('judges').select('event_id').eq('id', judge_id).single();
    eventId = data?.event_id || null;
  } catch {
    // ignore
  }

  const actor = await actorFromJudgeId(judge_id);
  await logEvent({
    event_id: eventId,
    actor,
    action: on_break ? 'judge.break' : 'judge.resume',
    message: on_break ? `${actor} went on break` : `${actor} resumed`,
    details: { judge_id },
  });

  return NextResponse.json({ success: true });
}
