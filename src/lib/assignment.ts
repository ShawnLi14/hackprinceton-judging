import { isExpectedAssignmentFailure, planAssignment, type PolicyTeam } from './assignment-policy';
import { supabase } from './supabase';
import { actorSystem, describeError, logEvent } from './log';
import type { JudgingSetWithTeams } from './types';

// ============================================
// Team Assignment Algorithm (Atomic via RPC)
// ============================================
// Uses assign_set_to_judge, which runs in one transaction under an
// event-scoped advisory lock:
// 1. Picks the floor with the most under-target teams that still have a
//    free concurrent slot
// 2. Ranks teams by times_judged + judges already with them, then room
// 3. Allows up to events.max_concurrent_judges simultaneous judges per team
// 4. Skips teams this judge has already completed or is currently visiting
// The JS fallback below uses the same ordering (assignment-policy.ts) and
// only runs when the RPC itself is missing or errors unexpectedly. Expected
// outcomes ("event not active", "nobody left") return immediately.

async function releaseInactiveJudgeAssignments(eventId: string): Promise<void> {
  const { data: inactiveJudges, error: inactiveJudgeError } = await supabase
    .from('judges')
    .select('id')
    .eq('event_id', eventId)
    .eq('is_active', false);

  if (inactiveJudgeError) {
    console.error('Failed to inspect inactive judges:', inactiveJudgeError.message);
    return;
  }

  const inactiveJudgeIds = (inactiveJudges || []).map(judge => judge.id);
  if (inactiveJudgeIds.length === 0) {
    return;
  }

  const { data: abandonedSets, error: abandonedSetError } = await supabase
    .from('judging_sets')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'active')
    .in('judge_id', inactiveJudgeIds);

  if (abandonedSetError) {
    console.error('Failed to inspect active judging sets:', abandonedSetError.message);
    return;
  }

  const abandonedSetIds = (abandonedSets || []).map(set => set.id);

  if (abandonedSetIds.length === 0) {
    return;
  }

  const reclaimedAt = new Date().toISOString();

  // Expire the set before releasing locks so a deactivated judge cannot
  // still submit it. Other judges' locks on the same teams stay put.
  const { error: expireError } = await supabase
    .from('judging_sets')
    .update({ status: 'expired', completed_at: reclaimedAt })
    .in('id', abandonedSetIds)
    .eq('status', 'active');

  if (expireError) {
    console.error('Failed to expire inactive judge sets:', expireError.message);
    return;
  }

  const { error: lockReleaseError } = await supabase
    .from('team_locks')
    .update({ released_at: reclaimedAt })
    .in('judging_set_id', abandonedSetIds)
    .is('released_at', null);

  if (lockReleaseError) {
    console.error('Failed to release locks for inactive judge sets:', lockReleaseError.message);
    return;
  }

  await logEvent({
    event_id: eventId,
    actor: actorSystem(),
    action: 'lock.released_inactive_judges',
    message: `Released locks for ${abandonedSetIds.length} set(s) belonging to inactive judges`,
    details: { set_ids: abandonedSetIds, judge_ids: inactiveJudgeIds },
  });
}

async function cleanupStaleAssignments(eventId: string): Promise<void> {
  const { data: eventConfig, error: eventError } = await supabase
    .from('events')
    .select('max_judging_minutes')
    .eq('id', eventId)
    .single();

  if (eventError || !eventConfig) {
    console.error('Failed to load event config for stale assignment cleanup:', eventError?.message);
    return;
  }

  await releaseInactiveJudgeAssignments(eventId);

  // Snapshot active sets before/after so we can log which ones expired.
  const { data: activeBefore } = await supabase
    .from('judging_sets')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'active');
  const beforeIds = new Set((activeBefore || []).map(s => s.id));

  const { error: releaseError } = await supabase.rpc('release_expired_locks', {
    p_event_id: eventId,
    p_max_minutes: eventConfig.max_judging_minutes,
  });

  if (releaseError) {
    console.error('Failed to release expired locks:', releaseError.message);
    await logEvent({
      event_id: eventId,
      actor: actorSystem(),
      action: 'lock.release_expired_failed',
      message: 'release_expired_locks RPC failed',
      details: { error: describeError(releaseError) },
    });
    return;
  }

  const { data: activeAfter } = await supabase
    .from('judging_sets')
    .select('id')
    .eq('event_id', eventId)
    .eq('status', 'active');
  const afterIds = new Set((activeAfter || []).map(s => s.id));
  const expiredIds = [...beforeIds].filter(id => !afterIds.has(id));

  if (expiredIds.length > 0) {
    await logEvent({
      event_id: eventId,
      actor: actorSystem(),
      action: 'set.expired',
      message: `Expired ${expiredIds.length} stale set(s) past ${eventConfig.max_judging_minutes}m timeout`,
      details: { set_ids: expiredIds, max_minutes: eventConfig.max_judging_minutes },
    });
  }
}

async function fetchFullSet(judgingSetId: string): Promise<JudgingSetWithTeams | null> {
  const { data: fullSet, error: fetchError } = await supabase
    .from('judging_sets')
    .select(`
      *,
      judging_set_teams(
        *,
        team:teams(*, room:rooms(*))
      )
    `)
    .eq('id', judgingSetId)
    .single();

  if (fetchError || !fullSet) {
    console.error('Failed to fetch created set:', fetchError);
    return null;
  }

  return fullSet as JudgingSetWithTeams;
}

async function fallbackAssignNextSet(
  judgeId: string,
  eventId: string
): Promise<JudgingSetWithTeams | null> {
  const [{ data: eventConfig, error: eventError }, { data: judge, error: judgeError }] = await Promise.all([
    supabase
      .from('events')
      .select('set_size, target_judgings_per_team, max_concurrent_judges, status')
      .eq('id', eventId)
      .single(),
    supabase
      .from('judges')
      .select('is_active, status, current_room_id')
      .eq('id', judgeId)
      .single(),
  ]);

  if (eventError || !eventConfig) {
    console.error('Fallback assignment could not load event config:', eventError?.message);
    return null;
  }

  if (judgeError || !judge) {
    console.error('Fallback assignment could not load judge:', judgeError?.message);
    return null;
  }

  if (eventConfig.status !== 'active' || judge.is_active === false || judge.status === 'on_break') {
    return null;
  }

  const { data: existingSet } = await supabase
    .from('judging_sets')
    .select('id')
    .eq('judge_id', judgeId)
    .eq('status', 'active')
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSet?.id) {
    return fetchFullSet(existingSet.id);
  }

  let judgeFloor: number | null = null;
  if (judge.current_room_id) {
    const { data: judgeRoom, error: roomError } = await supabase
      .from('rooms')
      .select('floor')
      .eq('id', judge.current_room_id)
      .single();

    if (!roomError && judgeRoom) {
      judgeFloor = judgeRoom.floor;
    }
  }

  const [{ data: teams, error: teamsError }, { data: activeLocks, error: locksError }, { data: priorSets, error: priorError }] = await Promise.all([
    supabase
      .from('teams')
      .select('id, room_id, times_judged, room:rooms(floor, room_number)')
      .eq('event_id', eventId)
      .eq('is_active', true),
    supabase
      .from('team_locks')
      .select('team_id')
      .is('released_at', null),
    supabase
      .from('judging_sets')
      .select('id')
      .eq('judge_id', judgeId)
      .in('status', ['active', 'completed']),
  ]);

  if (teamsError || !teams) {
    console.error('Fallback assignment could not load teams:', teamsError?.message);
    return null;
  }

  if (locksError) {
    console.error('Fallback assignment could not load active locks:', locksError.message);
    return null;
  }

  if (priorError) {
    console.error('Fallback assignment could not load prior sets:', priorError.message);
    return null;
  }

  const priorSetIds = (priorSets || []).map(set => set.id);
  const alreadyJudged = new Set<string>();
  if (priorSetIds.length > 0) {
    const { data: priorRows, error: priorRowsError } = await supabase
      .from('judging_set_teams')
      .select('team_id')
      .in('judging_set_id', priorSetIds);
    if (priorRowsError) {
      console.error('Fallback assignment could not load prior teams:', priorRowsError.message);
      return null;
    }
    for (const row of priorRows || []) alreadyJudged.add(row.team_id);
  }

  const inflight = new Map<string, number>();
  for (const lock of activeLocks || []) {
    inflight.set(lock.team_id, (inflight.get(lock.team_id) || 0) + 1);
  }

  const policyTeams: PolicyTeam[] = (teams as Array<{
    id: string;
    room_id: string;
    times_judged: number;
    room?: { floor: number; room_number: number } | { floor: number; room_number: number }[] | null;
  }>).flatMap(team => {
    const room = Array.isArray(team.room) ? team.room[0] : team.room;
    if (!room) return [];
    return [{
      id: team.id,
      floor: room.floor,
      roomNumber: room.room_number,
      timesJudged: team.times_judged,
      inflight: inflight.get(team.id) || 0,
      alreadyJudgedByThisJudge: alreadyJudged.has(team.id),
    }];
  });

  const plannedIds = planAssignment(policyTeams, {
    setSize: eventConfig.set_size,
    target: eventConfig.target_judgings_per_team,
    maxConcurrent: eventConfig.max_concurrent_judges ?? 3,
    judgeFloor,
  });

  if (plannedIds.length === 0) {
    return null;
  }

  const roomByTeam = new Map(policyTeams.map(team => [team.id, teams.find(row => row.id === team.id)?.room_id]));
  const candidates = plannedIds.map(id => ({ id, room_id: roomByTeam.get(id) || '' }));

  const assignedAt = new Date().toISOString();
  const { data: createdSet, error: setError } = await supabase
    .from('judging_sets')
    .insert({
      event_id: eventId,
      judge_id: judgeId,
      status: 'active',
      assigned_at: assignedAt,
    })
    .select('id')
    .single();

  if (setError || !createdSet) {
    console.error('Fallback assignment could not create judging set:', setError?.message);
    return null;
  }

  const assignedTeams: Array<{ id: string; room_id: string }> = [];

  for (const candidate of candidates) {
    if (assignedTeams.length >= eventConfig.set_size) {
      break;
    }

    const { error: lockError } = await supabase
      .from('team_locks')
      .insert({
        team_id: candidate.id,
        judging_set_id: createdSet.id,
      });

    if (lockError) {
      if (lockError.code === '23505') {
        continue;
      }

      console.error('Fallback assignment could not create team lock:', lockError.message);
      break;
    }

    const visitOrder = assignedTeams.length + 1;
    const { error: setTeamError } = await supabase
      .from('judging_set_teams')
      .insert({
        judging_set_id: createdSet.id,
        team_id: candidate.id,
        visit_order: visitOrder,
      });

    if (setTeamError) {
      console.error('Fallback assignment could not create set team:', setTeamError.message);
      await supabase
        .from('team_locks')
        .update({ released_at: new Date().toISOString() })
        .eq('judging_set_id', createdSet.id)
        .eq('team_id', candidate.id)
        .is('released_at', null);
      break;
    }

    assignedTeams.push({ id: candidate.id, room_id: candidate.room_id });
  }

  if (assignedTeams.length === 0) {
    await supabase.from('judging_sets').delete().eq('id', createdSet.id);
    return null;
  }

  await supabase
    .from('judges')
    .update({
      status: 'active',
      current_room_id: assignedTeams[0].room_id,
    })
    .eq('id', judgeId);

  return fetchFullSet(createdSet.id);
}

export async function assignNextSet(
  judgeId: string,
  eventId: string
): Promise<JudgingSetWithTeams | null> {
  const started = Date.now();
  await cleanupStaleAssignments(eventId);

  // Call the atomic RPC function
  const { data: setId, error: rpcError } = await supabase
    .rpc('assign_set_to_judge', {
      p_event_id: eventId,
      p_judge_id: judgeId,
    });

  if (rpcError) {
    const message = rpcError.message || '';
    // Saturated pools, paused events, and deactivated judges are normal
    // outcomes. The old fallback walked every locked team over HTTP and
    // pinned the database once judges outnumbered teams/set_size.
    if (isExpectedAssignmentFailure(message)) {
      return null;
    }

    console.error('Assignment RPC error:', message);
    await logEvent({
      event_id: eventId,
      actor: actorSystem(),
      action: 'assign.fallback_used',
      message: 'assign_set_to_judge RPC failed; falling back to JS path',
      details: { judge_id: judgeId, error: describeError(rpcError) },
    });
    return fallbackAssignNextSet(judgeId, eventId);
  }

  if (!setId) {
    console.error('No set ID returned from assignment');
    await logEvent({
      event_id: eventId,
      actor: actorSystem(),
      action: 'assign.fallback_used',
      message: 'assign_set_to_judge RPC returned no set; falling back to JS path',
      details: { judge_id: judgeId },
    });
    return fallbackAssignNextSet(judgeId, eventId);
  }

  const set = await fetchFullSet(setId);
  const elapsedMs = Date.now() - started;
  if (elapsedMs > 2000) {
    await logEvent({
      event_id: eventId,
      actor: actorSystem(),
      action: 'assign.slow',
      message: `Assignment took ${elapsedMs}ms`,
      details: { judge_id: judgeId, set_id: setId, elapsed_ms: elapsedMs },
    });
  }
  return set;
}

export async function reclaimActiveAssignmentsForJudge(judgeId: string): Promise<boolean> {
  const { data: activeSets, error: setFetchError } = await supabase
    .from('judging_sets')
    .select('id')
    .eq('judge_id', judgeId)
    .eq('status', 'active');

  if (setFetchError) {
    console.error('Failed to load active judging sets:', setFetchError.message);
    return false;
  }

  const activeSetIds = (activeSets || []).map(set => set.id);
  if (activeSetIds.length === 0) {
    return true;
  }

  const reclaimedAt = new Date().toISOString();

  const { error: expireError } = await supabase
    .from('judging_sets')
    .update({ status: 'expired', completed_at: reclaimedAt })
    .in('id', activeSetIds)
    .eq('status', 'active');

  if (expireError) {
    console.error('Failed to expire reclaimed judging sets:', expireError.message);
    return false;
  }

  const { error: lockReleaseError } = await supabase
    .from('team_locks')
    .update({ released_at: reclaimedAt })
    .in('judging_set_id', activeSetIds)
    .is('released_at', null);

  if (lockReleaseError) {
    console.error('Failed to release team locks for reclaimed sets:', lockReleaseError.message);
    return false;
  }

  return true;
}

// ============================================
// Submit a completed judging set (Atomic via RPC)
// ============================================
// Uses a PostgreSQL function that runs in a single transaction:
// 1. Saves judge scores and notes
// 2. Marks set completed
// 3. Increments times_judged (BEFORE releasing locks!)
// 4. Releases locks (teams only become available after counts are updated)
// 5. Updates judge status
// This prevents the stale-data window where teams could be re-assigned
// before their times_judged was incremented.

export async function submitJudgingSet(
  judgingSetId: string,
  evaluations: {
    team_id: string;
    rank?: number | null;
    /** @deprecated Use `rank`. Retained for callers that still send `score`. */
    score?: number | null;
    notes?: string;
    is_absent?: boolean;
  }[]
): Promise<boolean> {
  const { error } = await supabase
    .rpc('submit_judging_set', {
      p_set_id: judgingSetId,
      p_rankings: evaluations.map(evaluation => ({
        team_id: evaluation.team_id,
        rank: evaluation.rank ?? evaluation.score ?? null,
        notes: evaluation.notes || null,
        is_absent: evaluation.is_absent || false,
      })),
    });

  if (error) {
    console.error('Submit RPC error:', error.message);
    return false;
  }

  return true;
}
