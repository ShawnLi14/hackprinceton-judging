import { NextRequest, NextResponse } from 'next/server';
import { assignNextSet } from '@/lib/assignment';

export async function POST(req: NextRequest) {
  const { judge_id, event_id } = await req.json();

  if (!judge_id || !event_id) {
    return NextResponse.json({ error: 'Missing judge_id or event_id' }, { status: 400 });
  }

  const set = await assignNextSet(judge_id, event_id);

  if (!set) {
    return NextResponse.json(
      { error: 'No teams available for assignment. All teams may be currently being judged or have reached their target.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ set });
}
