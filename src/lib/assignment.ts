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

export async function assignNextSet(
  judgeId: string,
  eventId: string
): Promise<JudgingSetWithTeams | null> {
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
