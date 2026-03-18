import { NextRequest, NextResponse } from 'next/server';
import { submitJudgingSet } from '@/lib/assignment';

export async function POST(req: NextRequest) {
  const { judging_set_id, rankings } = await req.json();

  if (!judging_set_id || !rankings || !Array.isArray(rankings)) {
    return NextResponse.json({ error: 'Missing judging_set_id or rankings' }, { status: 400 });
  }

  // Validate rankings
  for (const r of rankings) {
    if (!r.team_id || r.rank === undefined) {
      return NextResponse.json({ error: 'Each ranking must have team_id and rank' }, { status: 400 });
    }
  }

  const success = await submitJudgingSet(judging_set_id, rankings);

  if (!success) {
    return NextResponse.json({ error: 'Failed to submit rankings' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
