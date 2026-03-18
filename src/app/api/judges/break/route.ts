import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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

  return NextResponse.json({ success: true });
}
