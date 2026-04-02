import { supabase } from './supabase';
import type { JudgingSetWithTeams } from './types';

// ============================================
// Team Assignment Algorithm (Atomic via RPC)
// ============================================
// Uses a PostgreSQL function that runs in a single transaction:
// 1. Selects the best floor (most under-judged unlocked teams)
// 2. Picks teams sorted by need (times_judged ASC) then proximity (room_number)
// 3. Locks them with FOR UPDATE SKIP LOCKED to prevent race conditions
// 4. Creates the judging set and team assignments
// This guarantees no team is ever assigned to two judges simultaneously.

async function releaseInactiveJudgeAssignments(eventId: string): Promise<void> {
  const { data: abandonedSets, error: abandonedSetError } = await supabase
    .from('judging_sets')
    .select('id, judge:judges(is_active)')
    .eq('event_id', eventId)
    .eq('status', 'active');

  if (abandonedSetError) {
    console.error('Failed to inspect active judging sets:', abandonedSetError.message);
    return;
  }

  const abandonedSetIds = (abandonedSets || [])
    .filter(set => (set.judge as { is_active?: boolean } | null)?.is_active === false)
    .map(set => set.id);

  if (abandonedSetIds.length === 0) {
    return;
  }

  const reclaimedAt = new Date().toISOString();

  const { error: lockReleaseError } = await supabase
    .from('team_locks')
    .update({ released_at: reclaimedAt })
    .in('judging_set_id', abandonedSetIds)
    .is('released_at', null);

  if (lockReleaseError) {
    console.error('Failed to release locks for inactive judge sets:', lockReleaseError.message);
  }
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

  const { error: releaseError } = await supabase.rpc('release_expired_locks', {
    p_event_id: eventId,
    p_max_minutes: eventConfig.max_judging_minutes,
  });

  if (releaseError) {
    console.error('Failed to release expired locks:', releaseError.message);
  }
}

export async function assignNextSet(
  judgeId: string,
  eventId: string
): Promise<JudgingSetWithTeams | null> {
  await cleanupStaleAssignments(eventId);

  // Call the atomic RPC function
  const { data: setId, error: rpcError } = await supabase
    .rpc('assign_set_to_judge', {
      p_event_id: eventId,
      p_judge_id: judgeId,
    });

  if (rpcError) {
    console.error('Assignment RPC error:', rpcError.message);
    return null;
  }

  if (!setId) {
    console.error('No set ID returned from assignment');
    return null;
  }

  // Fetch the full set with team details
  const { data: fullSet, error: fetchError } = await supabase
    .from('judging_sets')
    .select(`
      *,
      judging_set_teams(
        *,
        team:teams(*, room:rooms(*))
      )
    `)
    .eq('id', setId)
    .single();

  if (fetchError || !fullSet) {
    console.error('Failed to fetch created set:', fetchError);
    return null;
  }

  return fullSet as JudgingSetWithTeams;
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
  evaluations: { team_id: string; score?: number | null; notes?: string; is_absent?: boolean }[]
): Promise<boolean> {
  const { error } = await supabase
    .rpc('submit_judging_set', {
      p_set_id: judgingSetId,
      p_rankings: evaluations.map(evaluation => ({
        team_id: evaluation.team_id,
        rank: evaluation.score ?? null,
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
