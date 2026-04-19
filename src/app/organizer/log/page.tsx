'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';

interface LogRow {
  id: number;
  ts: string;
  actor: string | null;
  action: string;
  message: string | null;
  details: unknown;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return iso;
  }
}

function actionTone(action: string): string {
  if (action.endsWith('_failed')) return 'bg-red-100 text-red-900';
  if (action.startsWith('set.submitted')) return 'bg-emerald-100 text-emerald-900';
  if (action.startsWith('set.assigned')) return 'bg-sky-100 text-sky-900';
  if (action.startsWith('set.expired') || action.startsWith('lock.')) return 'bg-amber-100 text-amber-900';
  if (action.startsWith('event.')) return 'bg-violet-100 text-violet-900';
  if (action.startsWith('judge.login')) return 'bg-slate-100 text-slate-800';
  if (action.startsWith('team.') || action.startsWith('room.')) return 'bg-stone-100 text-stone-800';
  if (action.startsWith('import.')) return 'bg-indigo-100 text-indigo-900';
  return 'bg-muted/60 text-foreground';
}

function LogContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');

  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const lastIdRef = useRef<number>(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const r = await fetch(`/api/organizer/log?event_id=${eventId}&limit=5000`, { cache: 'no-store' });
    if (!r.ok) return;
    const data: LogRow[] = await r.json();
    setRows(data);
    lastIdRef.current = data.length ? data[data.length - 1].id : 0;
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: subscribe to inserts for this event_id and append.
  useEffect(() => {
    if (!eventId) return;

    const channel = supabase
      .channel(`event-log-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'event_log', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const newRow = payload.new as LogRow;
          if (!newRow || typeof newRow.id !== 'number') return;
          setRows(prev => {
            // Dedupe in case the same row appears via realtime AND a refetch.
            if (prev.some(p => p.id === newRow.id)) return prev;
            const next = [...prev, newRow];
            // Cap in-memory list so the tab doesn't OOM during a marathon.
            return next.length > 8000 ? next.slice(next.length - 8000) : next;
          });
          lastIdRef.current = Math.max(lastIdRef.current, newRow.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  // Auto-scroll to bottom when new rows arrive and follow mode is on.
  useEffect(() => {
    if (!follow || !scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [rows, follow]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      const hay = `${r.actor ?? ''} ${r.action} ${r.message ?? ''} ${JSON.stringify(r.details ?? '')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filter]);

  const toggleDetails = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!eventId) {
    return <p>No event selected. <Link href="/" className="underline">Go back</Link></p>;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-base font-semibold">Event log</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Live, append-only record of everything happening during judging. Useful for reconstructing what went wrong if something does.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Filter (actor, action, message, json)…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-9 w-64 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={follow}
              onChange={e => setFollow(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Follow
          </label>
          <Button variant="outline" size="sm" onClick={refresh}>Refresh</Button>
          <a
            href={`/api/organizer/log?event_id=${eventId}&format=txt`}
            download
            className={buttonVariants({ size: 'sm' })}
          >
            Download .log
          </a>
        </div>
      </section>

      <section className="flex flex-wrap gap-2 text-sm text-muted-foreground">
        <span className="rounded-lg bg-muted/50 px-3 py-1">{rows.length} rows</span>
        {filter && <span className="rounded-lg bg-muted/50 px-3 py-1">{filtered.length} matched</span>}
        {loading && <span className="rounded-lg bg-muted/50 px-3 py-1">loading…</span>}
      </section>

      <div
        ref={scrollerRef}
        className="h-[calc(100vh-22rem)] min-h-[24rem] overflow-y-auto rounded-lg border bg-card"
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {loading ? 'Loading…' : 'No log entries yet. Activity will appear here as it happens.'}
          </div>
        ) : (
          <ul className="divide-y font-mono text-xs">
            {filtered.map(r => {
              const isOpen = expanded.has(r.id);
              const hasDetails = r.details && Object.keys(r.details as object).length > 0;
              return (
                <li key={r.id} className="px-3 py-1.5 hover:bg-muted/30">
                  <button
                    type="button"
                    onClick={() => hasDetails && toggleDetails(r.id)}
                    className={`flex w-full items-baseline gap-3 text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(r.ts)}</span>
                    <span className="shrink-0 truncate text-foreground/80" style={{ width: '7rem' }}>{r.actor || '-'}</span>
                    <Badge variant="secondary" className={`shrink-0 ${actionTone(r.action)}`}>{r.action}</Badge>
                    <span className="grow truncate text-foreground">{r.message}</span>
                    {hasDetails && (
                      <span className="shrink-0 text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
                    )}
                  </button>
                  {hasDetails && isOpen && (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
                      {JSON.stringify(r.details, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function LogPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading...</div>}>
      <LogContent />
    </Suspense>
  );
}
