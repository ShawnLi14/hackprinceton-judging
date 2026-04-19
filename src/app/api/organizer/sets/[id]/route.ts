import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, describeError, logEvent } from '@/lib/log';

// PATCH /api/organizer/sets/[id]
//
// Body: { rankings: [{ team_id, rank, is_absent }] }
//
// Organizer override: edit the rankings of a COMPLETED set. Validates the
// 1..K contiguous-rank rule (mirroring /api/judges/submit), captures the
// before/after state, calls the `edit_completed_set` RPC, and writes a
// `set.edited_by_organizer` row to event_log so the change is auditable.
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: setId } = await context.params;
  if (!setId) {
    return NextResponse.json({ error: 'Missing set id' }, { status: 400 });
  }

  const body = await req.json();
  const rankings = body?.rankings;
  if (!Array.isArray(rankings) || rankings.length === 0) {
    return NextResponse.json({ error: 'Missing rankings array' }, { status: 400 });
  }

  type Eval = { team_id: string; rank: number | null; is_absent: boolean };
  const normalized: Eval[] = [];
  for (const raw of rankings) {
    if (!raw?.team_id) {
      return NextResponse.json({ error: 'Each ranking must include team_id' }, { status: 400 });
    }
    const isAbsent = Boolean(raw.is_absent);
    const rank: number | null = isAbsent
      ? null
      : (typeof raw.rank === 'number' ? raw.rank : Number.parseInt(raw.rank, 10));
    if (!isAbsent && (!Number.isFinite(rank) || !Number.isInteger(rank))) {
      return NextResponse.json(
        { error: 'Each present team must include an integer rank' },
        { status: 400 }
      );
    }
    normalized.push({ team_id: raw.team_id, rank: isAbsent ? null : (rank as number), is_absent: isAbsent });
  }

  const presentRanks = normalized.filter(r => !r.is_absent).map(r => r.rank as number);
  const k = presentRanks.length;
  if (k > 0) {
    const sorted = presentRanks.slice().sort((a, b) => a - b);
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

  // Snapshot the set before the edit so we can log a precise diff.
  const { data: before, error: beforeError } = await supabase
    .from('judging_sets')
    .select(`
      id, event_id, judge_id, status,
      judging_set_teams(team_id, rank, is_absent)
    `)
    .eq('id', setId)
    .single();

  if (beforeError || !before) {
    return NextResponse.json({ error: 'Set not found' }, { status: 404 });
  }
  if (before.status !== 'completed') {
    return NextResponse.json(
      { error: `Cannot edit a set with status "${before.status}". Only completed sets are editable.` },
      { status: 400 }
    );
  }

  // Sanity-check that every payload team belongs to the set.
  const setTeamIds = new Set((before.judging_set_teams || []).map(r => r.team_id));
  for (const r of normalized) {
    if (!setTeamIds.has(r.team_id)) {
      return NextResponse.json(
        { error: `Team ${r.team_id} is not part of this set` },
        { status: 400 }
      );
    }
  }

  // Compute times_judged deltas for the log (RPC applies them too).
  const beforeAbsent = new Map<string, boolean>(
    (before.judging_set_teams || []).map(r => [r.team_id, r.is_absent])
  );
  const timesJudgedDeltas: Record<string, number> = {};
  for (const r of normalized) {
    const wasAbsent = beforeAbsent.get(r.team_id) === true;
    if (wasAbsent && !r.is_absent) timesJudgedDeltas[r.team_id] = 1;
    else if (!wasAbsent && r.is_absent) timesJudgedDeltas[r.team_id] = -1;
  }

  const { error: rpcError } = await supabase.rpc('edit_completed_set', {
    p_set_id: setId,
    p_rankings: normalized,
  });

  if (rpcError) {
    await logEvent({
      event_id: before.event_id,
      actor: actorOrganizer(),
      action: 'set.edit_failed',
      message: 'Failed to edit completed set',
      details: { set_id: setId, error: describeError(rpcError) },
    });
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  await logEvent({
    event_id: before.event_id,
    actor: actorOrganizer(),
    action: 'set.edited_by_organizer',
    message: `Organizer edited set ${setId.slice(0, 8)} (${normalized.filter(r => !r.is_absent).length} present, ${normalized.filter(r => r.is_absent).length} absent)`,
    details: {
      set_id: setId,
      judge_id: before.judge_id,
      before: before.judging_set_teams,
      after: normalized,
      times_judged_deltas: timesJudgedDeltas,
    },
  });

  return NextResponse.json({ success: true });
}
