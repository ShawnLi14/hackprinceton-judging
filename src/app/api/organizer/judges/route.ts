import { NextRequest, NextResponse } from 'next/server';
import { assignGeneratedJudgeCodes } from '@/lib/judge-codes';
import { reclaimActiveAssignmentsForJudge } from '@/lib/assignment';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, logEvent } from '@/lib/log';

// GET: list judges for an event with their active sets
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const { data: judges, error } = await supabase
    .from('judges')
    .select('*, current_room:rooms(*)')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // For each judge, get their active set with team details
  const judgesWithSets = await Promise.all(
    (judges || []).map(async (judge) => {
      const { data: activeSet } = await supabase
        .from('judging_sets')
        .select(`
          *,
          judging_set_teams(
            *,
            team:teams(*, room:rooms(*))
          )
        `)
        .eq('judge_id', judge.id)
        .eq('status', 'active')
        .order('assigned_at', { ascending: false })
        .limit(1)
        .single();

      return {
        ...judge,
        active_set: activeSet || null,
      };
    })
  );

  return NextResponse.json(judgesWithSets);
}

// POST: create a judge
export async function POST(req: NextRequest) {
  const body = await req.json();
  const judges = Array.isArray(body) ? body : [body];
  const eventId = judges[0]?.event_id;

  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const { data: existingJudges, error: existingError } = await supabase
    .from('judges')
    .select('access_code')
    .eq('event_id', eventId);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }

  const judgesWithCodes = assignGeneratedJudgeCodes(
    judges.map(judge => ({
      event_id: judge.event_id,
      name: judge.name,
      access_code: judge.access_code,
    })),
    (existingJudges || []).map(judge => judge.access_code)
  );

  const { data, error } = await supabase
    .from('judges')
    .insert(judgesWithCodes)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await logEvent({
    event_id: eventId,
    actor: actorOrganizer(),
    action: 'judge.created',
    message: `Created ${data?.length || 0} judge(s)`,
    details: { judges: data?.map(j => ({ id: j.id, name: j.name, access_code: j.access_code })) },
  });

  return NextResponse.json(data);
}

// DELETE: delete/deactivate a judge
export async function DELETE(req: NextRequest) {
  const judgeId = req.nextUrl.searchParams.get('id');
  if (!judgeId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Snapshot judge for logging.
  const { data: judgeBefore } = await supabase
    .from('judges')
    .select('id, name, access_code, event_id')
    .eq('id', judgeId)
    .single();

  const reclaimed = await reclaimActiveAssignmentsForJudge(judgeId);
  if (!reclaimed) {
    return NextResponse.json({ error: 'Failed to reclaim the judge assignments' }, { status: 400 });
  }

  const { error } = await supabase
    .from('judges')
    .update({ is_active: false, status: 'idle', current_room_id: null })
    .eq('id', judgeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await logEvent({
    event_id: judgeBefore?.event_id || null,
    actor: actorOrganizer(),
    action: 'judge.deactivated',
    message: `Deactivated judge ${judgeBefore?.access_code || judgeBefore?.name || judgeId}`,
    details: { judge_id: judgeId, judge: judgeBefore },
  });

  return NextResponse.json({ success: true });
}
