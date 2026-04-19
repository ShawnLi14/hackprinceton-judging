import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/organizer/log?event_id=...&format=json|txt&limit=...&since=...
//
// Returns the event log for an event.
//   format=json  (default) -> array of rows, oldest -> newest
//   format=txt            -> downloadable plain text file, one line per row
//   limit                 -> cap on rows (default 5000, max 50000)
//   since                 -> ISO timestamp; only return rows with ts > since
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('event_id');
  const format = (req.nextUrl.searchParams.get('format') || 'json').toLowerCase();
  const since = req.nextUrl.searchParams.get('since');
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '5000', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 5000, 1), 50000);

  if (!eventId) {
    return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });
  }

  let query = supabase
    .from('event_log')
    .select('id, ts, actor, action, message, details')
    .eq('event_id', eventId)
    .order('ts', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);

  if (since) {
    query = query.gt('ts', since);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = data || [];

  if (format === 'txt') {
    const { data: eventRow } = await supabase
      .from('events')
      .select('name')
      .eq('id', eventId)
      .single();

    const header = [
      `# Judging event log`,
      `# event_id : ${eventId}`,
      `# event    : ${eventRow?.name ?? 'unknown'}`,
      `# rows     : ${rows.length}${rows.length === limit ? ` (capped at ${limit})` : ''}`,
      `# generated: ${new Date().toISOString()}`,
      '',
    ].join('\n');

    const lines = rows.map(r => formatLine(r)).join('\n');

    const slug = (eventRow?.name || 'event')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `judging-${slug}-${stamp}.log`;

    return new NextResponse(header + lines + '\n', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json(rows);
}

interface LogRow {
  id: number;
  ts: string;
  actor: string | null;
  action: string;
  message: string | null;
  details: unknown;
}

function formatLine(r: LogRow): string {
  const parts = [
    r.ts,
    (r.actor || '-').padEnd(14),
    r.action.padEnd(28),
    r.message || '',
  ];
  let line = parts.join('  ');
  if (r.details && Object.keys(r.details as object).length > 0) {
    try {
      line += '  ' + JSON.stringify(r.details);
    } catch {
      // ignore
    }
  }
  return line;
}
