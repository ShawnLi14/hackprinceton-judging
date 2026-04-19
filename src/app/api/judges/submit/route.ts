import { NextRequest, NextResponse } from 'next/server';
import { submitJudgingSet } from '@/lib/assignment';
import { supabase } from '@/lib/supabase';
import { actorFromJudgeId, logEvent } from '@/lib/log';

// POST /api/judges/submit
// Body: {
//   judging_set_id: string,
//   evaluations: Array<{
//     team_id: string,
//     rank?: number | null,   // 1 = best (required when not absent)
//     score?: number | null,  // legacy alias for rank, accepted for back-compat
//     is_absent?: boolean,
//     notes?: string,
//   }>
// }
//
// Validation rules:
//   - Each evaluation must have a team_id.
//   - Among present teams (is_absent !== true) the rank values must form the
//     contiguous sequence 1..K with no duplicates and no gaps, where K is the
//     number of present teams.
//   - Absent teams must have rank == null.
export async function POST(req: NextRequest) {
  const { judging_set_id, evaluations, rankings } = await req.json();
  const submitted = Array.isArray(evaluations) ? evaluations : rankings;

  if (!judging_set_id || !Array.isArray(submitted)) {
    return NextResponse.json(
      { error: 'Missing judging_set_id or evaluations array' },
      { status: 400 }
    );
  }

  type Eval = {
    team_id: string;
    rank: number | null;
    is_absent: boolean;
    notes?: string;
  };

  const normalized: Eval[] = [];
  for (const raw of submitted) {
    if (!raw?.team_id) {
      return NextResponse.json({ error: 'Each evaluation must include team_id' }, { status: 400 });
    }
    const isAbsent = Boolean(raw.is_absent);
    const rank: number | null = isAbsent ? null : (raw.rank ?? raw.score ?? null);
    normalized.push({
      team_id: raw.team_id,
      rank,
      is_absent: isAbsent,
      notes: raw.notes,
    });
  }

  const presentRanks = normalized
    .filter(e => !e.is_absent)
    .map(e => e.rank);

  if (presentRanks.some(r => !Number.isInteger(r))) {
    return NextResponse.json(
      { error: 'Each present team must include an integer rank' },
      { status: 400 }
    );
  }

  const k = presentRanks.length;
  if (k > 0) {
    const sorted = (presentRanks as number[]).slice().sort((a, b) => a - b);
    for (let i = 0; i < k; i++) {
      if (sorted[i] !== i + 1) {
        return NextResponse.json(
          {
            error: `Ranks for present teams must be the sequence 1..${k} with no duplicates or gaps. Received: ${sorted.join(', ')}.`,
          },
          { status: 400 }
        );
      }
    }
  }

  // Look up judge + event for log attribution. Failure is non-fatal — the
  // submit goes ahead regardless.
  let eventId: string | null = null;
  let actor = 'anonymous';
  try {
    const { data: setRow } = await supabase
      .from('judging_sets')
      .select('event_id, judge_id')
      .eq('id', judging_set_id)
      .single();
    if (setRow) {
      eventId = setRow.event_id;
      actor = await actorFromJudgeId(setRow.judge_id);
    }
  } catch {
    // ignore
  }

  const payload = normalized.map(e => ({
    team_id: e.team_id,
    rank: e.rank,
    notes: e.notes,
    is_absent: e.is_absent,
  }));

  const success = await submitJudgingSet(judging_set_id, payload);

  if (!success) {
    await logEvent({
      event_id: eventId,
      actor,
      action: 'set.submit_failed',
      message: `${actor} failed to submit set`,
      details: { judging_set_id, rankings: payload },
    });
    return NextResponse.json({ error: 'Failed to submit ranks' }, { status: 500 });
  }

  await logEvent({
    event_id: eventId,
    actor,
    action: 'set.submitted',
    message: `${actor} submitted ranks for ${payload.filter(p => !p.is_absent).length} of ${payload.length} team(s)`,
    details: {
      judging_set_id,
      rankings: payload,
      present_count: payload.filter(p => !p.is_absent).length,
      absent_count: payload.filter(p => p.is_absent).length,
    },
  });

  return NextResponse.json({ success: true });
}
