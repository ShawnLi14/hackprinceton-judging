import { NextRequest, NextResponse } from 'next/server';
import { assignNextSet } from '@/lib/assignment';
import { actorFromJudgeId, logEvent } from '@/lib/log';

export async function POST(req: NextRequest) {
  const { judge_id, event_id } = await req.json();

  if (!judge_id || !event_id) {
    return NextResponse.json({ error: 'Missing judge_id or event_id' }, { status: 400 });
  }

  const actor = await actorFromJudgeId(judge_id);
  const set = await assignNextSet(judge_id, event_id);

  if (!set) {
    await logEvent({
      event_id,
      actor,
      action: 'set.assign_failed',
      message: `No teams available to assign to ${actor}`,
      details: { judge_id },
    });
    return NextResponse.json(
      { error: 'No teams available for assignment. All teams may be currently being judged or have reached their target.' },
      { status: 404 }
    );
  }

  const teamIds = (set.judging_set_teams || []).map(t => t.team_id);
  await logEvent({
    event_id,
    actor,
    action: 'set.assigned',
    message: `${actor} assigned set of ${teamIds.length} team(s)`,
    details: {
      judge_id,
      set_id: set.id,
      team_ids: teamIds,
      team_count: teamIds.length,
    },
  });

  return NextResponse.json({ set });
}
