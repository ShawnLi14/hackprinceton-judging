'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';

type SetStatus = 'active' | 'completed' | 'expired' | 'skipped';

interface SetTeam {
  id: string;
  team_id: string;
  visit_order: number;
  rank: number | null;
  notes: string | null;
  is_visited: boolean;
  is_absent: boolean;
  team: {
    id: string;
    project_name: string | null;
    team_number: string;
    track: string | null;
    room?: { name: string; floor: number } | null;
  } | null;
}

interface SetRow {
  id: string;
  event_id: string;
  judge_id: string;
  status: SetStatus;
  assigned_at: string;
  completed_at: string | null;
  judging_set_teams: SetTeam[];
}

interface ApiResponse {
  judge: { id: string; name: string; access_code: string };
  sets: SetRow[];
}

interface Props {
  judgeId: string;
  onClose: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusTone(status: SetStatus): string {
  switch (status) {
    case 'active':    return 'bg-emerald-100 text-emerald-800';
    case 'completed': return 'bg-sky-100 text-sky-800';
    case 'expired':   return 'bg-amber-100 text-amber-800';
    case 'skipped':   return 'bg-stone-100 text-stone-700';
  }
}

export default function JudgeSetsDrawer({ judgeId, onClose }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/organizer/judges/${judgeId}/sets`, { cache: 'no-store' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [judgeId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Live: when this judge's set rows change anywhere (judge submits, organizer
  // edit elsewhere, etc) refetch so the drawer stays in sync.
  useEffect(() => {
    const channel = supabase
      .channel(`judge-sets-${judgeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'judging_sets', filter: `judge_id=eq.${judgeId}` },
        () => refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'judging_set_teams' },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [judgeId, refresh]);

  // ESC to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Judge sets">
      <button
        type="button"
        aria-label="Close drawer"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-background/95 p-5 backdrop-blur">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Judge sets</p>
            <h2 className="text-base font-semibold">
              {loading ? 'Loading…' : data?.judge.name || 'Unknown judge'}
            </h2>
            {data?.judge.access_code && (
              <span className="inline-flex rounded-lg bg-stone-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-stone-600">
                {data.judge.access_code}
              </span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </header>

        <div className="space-y-4 p-5">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {error}
            </div>
          )}

          {loading && !data && <p className="text-sm text-muted-foreground">Loading…</p>}

          {data?.sets.length === 0 && (
            <p className="text-sm text-muted-foreground">This judge hasn&rsquo;t been assigned any sets yet.</p>
          )}

          {data?.sets.map(set => (
            <SetCard key={set.id} set={set} onEdited={refresh} />
          ))}
        </div>
      </aside>
    </div>
  );
}

// ============================================================
// Set card (read-only header + collapsible body, edit for completed)
// ============================================================

function SetCard({ set, onEdited }: { set: SetRow; onEdited: () => void }) {
  const [open, setOpen] = useState(set.status === 'completed' || set.status === 'active');
  const [editing, setEditing] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [abandonError, setAbandonError] = useState<string | null>(null);

  const teams = set.judging_set_teams || [];
  const present = teams.filter(t => !t.is_absent).length;
  const absent  = teams.filter(t => t.is_absent).length;

  const elapsedMin = set.assigned_at
    ? Math.floor((Date.now() - new Date(set.assigned_at).getTime()) / 60000)
    : 0;

  const reclaim = async () => {
    const ok = window.confirm(
      `Reclaim teams from this active set?\n\n` +
      `It will be marked expired (${elapsedMin}m elapsed) and the teams will return to the pool. ` +
      `Use this when the judge has gone AWOL.`
    );
    if (!ok) return;
    setAbandoning(true);
    setAbandonError(null);
    try {
      const res = await fetch(`/api/organizer/sets/${set.id}/abandon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'organizer reclaimed via drawer' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onEdited();
    } catch (e) {
      setAbandonError(e instanceof Error ? e.message : 'Reclaim failed');
    } finally {
      setAbandoning(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className={statusTone(set.status)}>{set.status}</Badge>
          <span className="text-sm font-medium">
            {teams.length} team{teams.length === 1 ? '' : 's'}
            {set.status === 'completed' && ` · ${present} ranked${absent ? `, ${absent} absent` : ''}`}
          </span>
          <span className="text-xs text-muted-foreground">
            assigned {formatDateTime(set.assigned_at)}
            {set.completed_at && ` · completed ${formatDateTime(set.completed_at)}`}
          </span>
        </div>
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t px-4 py-3">
          {set.status !== 'completed' && (
            <p className="mb-3 text-sm text-muted-foreground">
              {set.status === 'active'
                ? `Judge hasn\u2019t submitted this set yet — read-only. ${elapsedMin}m elapsed.`
                : set.status === 'expired'
                  ? 'This set timed out and was released back to the pool.'
                  : 'This set was skipped — no rankings recorded.'}
            </p>
          )}

          {abandonError && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {abandonError}
            </div>
          )}

          {editing ? (
            <SetEditor
              setId={set.id}
              initial={teams}
              onCancel={() => setEditing(false)}
              onSaved={() => { setEditing(false); onEdited(); }}
            />
          ) : (
            <SetReadView
              teams={teams}
              showRanks={set.status === 'completed'}
            />
          )}

          {set.status === 'completed' && !editing && (
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit ranks
              </Button>
            </div>
          )}

          {set.status === 'active' && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={reclaim}
                disabled={abandoning}
                className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                title="Mark this set expired and release the teams back into the pool"
              >
                {abandoning ? 'Reclaiming…' : 'Reclaim teams'}
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ============================================================
// Read view
// ============================================================

function SetReadView({ teams, showRanks }: { teams: SetTeam[]; showRanks: boolean }) {
  const ordered = useMemo(() => {
    return teams.slice().sort((a, b) => {
      // Completed: present first by rank, then absent. Else: visit_order.
      if (showRanks) {
        if (a.is_absent !== b.is_absent) return a.is_absent ? 1 : -1;
        if (!a.is_absent && !b.is_absent) {
          return (a.rank ?? 99) - (b.rank ?? 99);
        }
      }
      return a.visit_order - b.visit_order;
    });
  }, [teams, showRanks]);

  return (
    <ul className="space-y-2">
      {ordered.map(t => (
        <li key={t.id} className="flex items-start gap-3 text-sm">
          <span className="mt-0.5 inline-flex w-8 shrink-0 justify-center rounded-md bg-muted/60 px-2 py-1 text-xs font-medium tabular-nums">
            {t.is_absent ? '—' : (showRanks ? (t.rank ?? '?') : t.visit_order)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.team?.project_name || 'Untitled'}</span>
              {t.is_absent && (
                <Badge variant="secondary" className="bg-stone-100 text-stone-700">absent</Badge>
              )}
              {t.is_visited && !t.is_absent && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">visited</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t.team?.room?.name || '?'} · #{t.team?.team_number}
            </p>
            {t.notes && (
              <p className="mt-1 whitespace-pre-wrap text-xs italic text-muted-foreground">
                &ldquo;{t.notes}&rdquo;
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// Editor: arrows + absent toggle
// ============================================================

interface DraftRow {
  team_id: string;
  team: SetTeam['team'];
  is_absent: boolean;
  // present teams are ordered by their position in `present`; their rank is
  // (index + 1). Absent teams live in `absent` and have rank = null.
}

function SetEditor({
  setId,
  initial,
  onCancel,
  onSaved,
}: {
  setId: string;
  initial: SetTeam[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Initialize: present teams ordered by their saved rank, then absent teams.
  const [present, setPresent] = useState<DraftRow[]>(() =>
    initial
      .filter(t => !t.is_absent)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map(t => ({ team_id: t.team_id, team: t.team, is_absent: false }))
  );
  const [absent, setAbsent] = useState<DraftRow[]>(() =>
    initial
      .filter(t => t.is_absent)
      .map(t => ({ team_id: t.team_id, team: t.team, is_absent: true }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = (idx: number, dir: -1 | 1) => {
    setPresent(prev => {
      const next = prev.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const setRowAbsent = (teamId: string, makeAbsent: boolean) => {
    if (makeAbsent) {
      const row = present.find(r => r.team_id === teamId);
      if (!row) return;
      setPresent(prev => prev.filter(r => r.team_id !== teamId));
      setAbsent(prev => [...prev, { ...row, is_absent: true }]);
    } else {
      const row = absent.find(r => r.team_id === teamId);
      if (!row) return;
      setAbsent(prev => prev.filter(r => r.team_id !== teamId));
      setPresent(prev => [...prev, { ...row, is_absent: false }]);
    }
  };

  const dirty = useMemo(() => {
    const initialPresent = initial
      .filter(t => !t.is_absent)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map(t => t.team_id);
    const initialAbsent = new Set(initial.filter(t => t.is_absent).map(t => t.team_id));

    const currentPresent = present.map(r => r.team_id);
    if (currentPresent.length !== initialPresent.length) return true;
    for (let i = 0; i < currentPresent.length; i++) {
      if (currentPresent[i] !== initialPresent[i]) return true;
    }
    if (absent.length !== initialAbsent.size) return true;
    for (const r of absent) {
      if (!initialAbsent.has(r.team_id)) return true;
    }
    return false;
  }, [present, absent, initial]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const rankings = [
        ...present.map((r, i) => ({ team_id: r.team_id, rank: i + 1, is_absent: false })),
        ...absent.map(r => ({ team_id: r.team_id, rank: null, is_absent: true })),
      ];
      const res = await fetch(`/api/organizer/sets/${setId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rankings }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const oneRanked = present.length === 1 && absent.length > 0;

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}

      {oneRanked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Only one team is ranked; that team will receive an automatic top score from this set.
        </div>
      )}

      <ol className="space-y-2">
        {present.map((row, idx) => (
          <li key={row.team_id} className="flex items-center gap-2 rounded-lg border bg-background px-2 py-2">
            <span className="inline-flex w-8 shrink-0 justify-center rounded-md bg-sky-100 px-2 py-1 text-xs font-semibold tabular-nums text-sky-900">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.team?.project_name || 'Untitled'}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.team?.room?.name || '?'} · #{row.team?.team_number}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Move up"
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
              >
                ↑
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Move down"
                disabled={idx === present.length - 1}
                onClick={() => move(idx, 1)}
              >
                ↓
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setRowAbsent(row.team_id, true)}
              >
                Mark absent
              </Button>
            </div>
          </li>
        ))}
      </ol>

      {absent.length > 0 && (
        <>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Absent</p>
          <ul className="space-y-2">
            {absent.map(row => (
              <li
                key={row.team_id}
                className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-2 py-2"
              >
                <span className="inline-flex w-8 shrink-0 justify-center rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">—</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.team?.project_name || 'Untitled'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.team?.room?.name || '?'} · #{row.team?.team_number}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setRowAbsent(row.team_id, false)}
                >
                  Mark present
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
