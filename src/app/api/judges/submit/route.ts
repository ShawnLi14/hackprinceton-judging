import { NextRequest, NextResponse } from 'next/server';
import { submitJudgingSet } from '@/lib/assignment';

export async function POST(req: NextRequest) {
  const { judging_set_id, evaluations, rankings } = await req.json();
  const submittedEvaluations = Array.isArray(evaluations) ? evaluations : rankings;

  if (!judging_set_id || !submittedEvaluations || !Array.isArray(submittedEvaluations)) {
    return NextResponse.json({ error: 'Missing judging_set_id or evaluations' }, { status: 400 });
  }

  for (const evaluation of submittedEvaluations) {
    const score = evaluation.score ?? evaluation.rank;
    const isAbsent = Boolean(evaluation.is_absent);

    if (!evaluation.team_id) {
      return NextResponse.json({ error: 'Each evaluation must include team_id' }, { status: 400 });
    }

    if (!isAbsent && (!Number.isInteger(score) || score < 1 || score > 5)) {
      return NextResponse.json(
        { error: 'Each present team must include an integer score from 1 to 5' },
        { status: 400 }
      );
    }
  }

  const success = await submitJudgingSet(
    judging_set_id,
    submittedEvaluations.map(evaluation => ({
      team_id: evaluation.team_id,
      score: evaluation.is_absent ? null : evaluation.score ?? evaluation.rank,
      notes: evaluation.notes,
      is_absent: evaluation.is_absent,
    }))
  );

  if (!success) {
    return NextResponse.json({ error: 'Failed to submit scores' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
