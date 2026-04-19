import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, logEvent } from '@/lib/log';

// GET /api/organizer/results/raw?event_id=...&format=csv|json&include=completed|all
//
// Raw export of every judging set with its per-team rankings — the source
// data behind the aggregated /results endpoint. Useful for auditing,
// re-scoring with a different formula offline, or sanity-checking a
// specific judge's submissions.
//
// Defaults: format=csv, include=completed (since only completed sets carry
// real scores). Pass include=all to also dump active/expired/skipped sets,
// which is handy when investigating issues.
//
// CSV columns (one row per (set, team), including absent rows):
//   set_id, set_status, judge_name, judge_access_code,
//   assigned_at, completed_at, present_count,
//   team_id, team_number, project_name, track, room, floor,
//   visit_order, rank, is_absent, is_visited,
//   normalized_score, score_5
//
// `normalized_score` is the (presentCount - rank) / (presentCount - 1) value
// (1.0 for the only-present-team case, blank for absent rows). `score_5`
// is the same scaled to 0..5 for parity with the dashboard display.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const eventId = params.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  const format = (params.get('format') || 'csv').toLowerCase();
  const include = (params.get('include') || 'completed').toLowerCase();
  const statusFilter = include === 'all' ? null : 'completed';

  let query = supabase
    .from('judging_sets')
    .select(`
      id, event_id, judge_id, status, assigned_at, completed_at, created_at,
      judge:judges(name, access_code),
      judging_set_teams(
        id, team_id, visit_order, rank, notes, is_visited, is_absent,
        team:teams(team_number, project_name, track, devpost_url, room:rooms(name, floor))
      )
    `)
    .eq('event_id', eventId)
    .order('completed_at', { ascending: true, nullsFirst: false });

  if (statusFilter) query = query.eq('status', statusFilter);

  const { data: sets, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = sets || [];

  await logEvent({
    event_id: eventId,
    actor: actorOrganizer(),
    action: 'results.exported_raw',
    message: `Exported ${rows.length} raw set(s) as ${format}`,
    details: { format, include, set_count: rows.length },
  });

  if (format === 'json') {
    return NextResponse.json({ event_id: eventId, include, sets: rows });
  }

  // CSV: one row per (set, team), with computed normalized score.
  const header = [
    'set_id', 'set_status', 'judge_name', 'judge_access_code',
    'assigned_at', 'completed_at', 'present_count',
    'team_id', 'team_number', 'project_name', 'track', 'room', 'floor',
    'visit_order', 'rank', 'is_absent', 'is_visited',
    'normalized_score', 'score_5',
  ];

  const lines: string[] = [header.join(',')];

  for (const set of rows) {
    const judge = set.judge as unknown as { name: string; access_code: string } | null;
    const setTeams = (set.judging_set_teams || []) as Array<{
      id: string;
      team_id: string;
      visit_order: number;
      rank: number | null;
      is_visited: boolean;
      is_absent: boolean;
      team: {
        team_number: string;
        project_name: string | null;
        track: string | null;
        room: { name: string; floor: number } | null;
      } | null;
    }>;

    const presentCount = setTeams.filter(t => !t.is_absent && typeof t.rank === 'number').length;

    for (const st of setTeams) {
      const norm =
        st.is_absent || typeof st.rank !== 'number'
          ? null
          : presentCount <= 1
            ? 1
            : (presentCount - st.rank) / (presentCount - 1);

      lines.push([
        csv(set.id),
        csv(set.status),
        csv(judge?.name ?? ''),
        csv(judge?.access_code ?? ''),
        csv(set.assigned_at ?? ''),
        csv(set.completed_at ?? ''),
        String(presentCount),
        csv(st.team_id),
        csv(st.team?.team_number ?? ''),
        csv(st.team?.project_name ?? ''),
        csv(st.team?.track ?? ''),
        csv(st.team?.room?.name ?? ''),
        st.team?.room?.floor !== undefined ? String(st.team.room.floor) : '',
        String(st.visit_order),
        st.rank !== null ? String(st.rank) : '',
        st.is_absent ? 'true' : 'false',
        st.is_visited ? 'true' : 'false',
        norm !== null ? norm.toFixed(4) : '',
        norm !== null ? (norm * 5).toFixed(2) : '',
      ].join(','));
    }
  }

  const body = lines.join('\n') + '\n';
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="raw-sets-${eventId}.csv"`,
    },
  });
}

// Wraps a value in double quotes and escapes embedded quotes/newlines for
// CSV. Unconditional quoting keeps the output safe regardless of content
// (commas in project names are very common).
function csv(val: string): string {
  const s = String(val ?? '');
  return '"' + s.replace(/"/g, '""') + '"';
}
