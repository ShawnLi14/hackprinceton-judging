'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import type { Event, Judge, Team, Room, JudgingSetWithTeams } from '@/lib/types';

interface JudgeWithSet extends Judge {
  active_set: JudgingSetWithTeams | null;
  current_room?: Room;
}

function DashboardMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="space-y-2">
      <span className={`inline-flex rounded-lg px-2.5 py-1 text-[11px] font-medium ${tone}`} aria-hidden="true">
        {label}
      </span>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');
  const dashboardEventId = eventId;

  const [event, setEvent] = useState<Event | null>(null);
  const [judges, setJudges] = useState<JudgeWithSet[]>([]);
  const [teams, setTeams] = useState<(Team & { room?: Room })[]>([]);
  const [locks, setLocks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<'judges' | 'teams'>('judges');

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!dashboardEventId || loadingRef.current) {
      return;
    }
    loadingRef.current = true;

    try {
      const [eventRes, judgesRes, teamsRes] = await Promise.all([
        fetch(`/api/events?id=${dashboardEventId}`),
        fetch(`/api/organizer/judges?event_id=${dashboardEventId}`),
        fetch(`/api/organizer/teams?event_id=${dashboardEventId}`),
      ]);

      if (!eventRes.ok || !judgesRes.ok || !teamsRes.ok) {
        setEvent(null);
        setJudges([]);
        setTeams([]);
        setLocks({});
        return;
      }

      setEvent(await eventRes.json());
      setJudges(await judgesRes.json());
      setTeams(await teamsRes.json());

      try {
        const { data: activeLocks } = await supabase
          .from('team_locks')
          .select('team_id, judging_set_id, judging_set:judging_sets(judge_id, judge:judges(name))')
          .is('released_at', null);

        const lockMap: Record<string, string> = {};
        for (const lock of activeLocks || []) {
          const judgeName =
            (lock.judging_set as unknown as { judge: { name: string } })?.judge?.name || 'Unknown';
          lockMap[lock.team_id] = judgeName;
        }
        setLocks(lockMap);
      } catch {
        setLocks({});
      }
    } catch {
      setEvent(null);
      setJudges([]);
      setTeams([]);
      setLocks({});
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [dashboardEventId]);

  const debouncedLoadData = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      loadData();
    }, 450);
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      loadData();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!dashboardEventId) return;

    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'judging_sets', filter: `event_id=eq.${dashboardEventId}` },
        () => debouncedLoadData()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judging_set_teams' }, () => debouncedLoadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_locks' }, () => debouncedLoadData())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'judges', filter: `event_id=eq.${dashboardEventId}` },
        () => debouncedLoadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [dashboardEventId, debouncedLoadData]);

  const controlEvent = async (action: string) => {
    if (!dashboardEventId) {
      return;
    }

    await fetch('/api/organizer/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: dashboardEventId, action }),
    });
    loadData();
  };

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading dashboard...</div>;
  }

  if (!dashboardEventId) {
    return <p>No event selected. <Link href="/" className="underline">Go back</Link></p>;
  }

  if (!event) {
    return <p>No event selected. <Link href="/" className="underline">Go back</Link></p>;
  }

  const totalTeams = teams.length;
  const activeJudges = judges.filter(j => j.status === 'active').length;
  const idleJudges = judges.filter(j => j.status === 'idle').length;
  const breakJudges = judges.filter(j => j.status === 'on_break').length;
  const targetJudgings = event.target_judgings_per_team || 3;
  const teamsAtTarget = teams.filter(t => t.times_judged >= targetJudgings).length;
  const totalSetsCompleted = judges.reduce((sum, j) => sum + j.sets_completed, 0);

  const getElapsedMinutes = (assignedAt: string) => (now - new Date(assignedAt).getTime()) / 60000;

  const getElapsedTone = (minutes: number) => {
    const max = event.max_judging_minutes || 20;
    if (minutes < max * 0.5) return 'bg-emerald-100 text-emerald-800';
    if (minutes < max * 0.8) return 'bg-amber-100 text-amber-800';
    return 'bg-rose-100 text-rose-800';
  };

  const formatElapsed = (assignedAt: string) => {
    const mins = getElapsedMinutes(assignedAt);
    const m = Math.floor(mins);
    const s = Math.floor((mins - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const sortedTeams = [...teams].sort((a, b) => a.times_judged - b.times_judged || a.name.localeCompare(b.name));

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge
              variant="secondary"
              className={
                event.status === 'active'
                  ? 'bg-emerald-100 text-emerald-800'
                  : event.status === 'paused'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-stone-100 text-stone-700'
              }
            >
              {event.status}
            </Badge>
            <div className="space-y-2">
              <h1 className="text-base font-semibold tracking-[-0.02em] text-balance">
                {event.name}
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground text-pretty">
                A minimal live view of judging progress, team coverage, and active sets.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {event.status === 'active' && (
              <>
                <Button size="sm" variant="outline" onClick={() => controlEvent('pause')}>
                  Pause event
                </Button>
                <Button size="sm" variant="destructive" onClick={() => controlEvent('complete')}>
                  End judging
                </Button>
              </>
            )}
            {event.status === 'paused' && (
              <Button size="sm" onClick={() => controlEvent('start')}>
                Resume event
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-6">
        <DashboardMetric label="Total teams" value={`${totalTeams}`} tone="bg-sky-100 text-sky-800" />
        <DashboardMetric label="Active judges" value={`${activeJudges}`} tone="bg-emerald-100 text-emerald-800" />
        <DashboardMetric label="Idle judges" value={`${idleJudges}`} tone="bg-violet-100 text-violet-800" />
        <DashboardMetric label="On break" value={`${breakJudges}`} tone="bg-amber-100 text-amber-800" />
        <DashboardMetric label="Sets done" value={`${totalSetsCompleted}`} tone="bg-rose-100 text-rose-800" />
        <DashboardMetric label="At target" value={`${teamsAtTarget}/${totalTeams}`} tone="bg-orange-100 text-orange-800" />
      </section>

      <section className="flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          variant={view === 'judges' ? 'default' : 'ghost'}
          className={view === 'judges' ? 'bg-stone-900 text-white' : 'text-muted-foreground'}
          onClick={() => setView('judges')}
        >
          Judges
        </Button>
        <Button
          size="sm"
          variant={view === 'teams' ? 'default' : 'ghost'}
          className={view === 'teams' ? 'bg-stone-900 text-white' : 'text-muted-foreground'}
          onClick={() => setView('teams')}
        >
          Teams
        </Button>
      </section>

      {view === 'judges' ? (
        <section className="grid gap-x-8 gap-y-8 lg:grid-cols-2 xl:grid-cols-3">
          {judges.map(judge => {
            const hasActiveSet = !!judge.active_set;
            const elapsed = hasActiveSet ? getElapsedMinutes(judge.active_set!.assigned_at) : 0;

            return (
              <article key={judge.id} className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">{judge.name}</h2>
                      <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-stone-600">
                        {judge.access_code}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {judge.sets_completed} sets completed
                      {judge.current_room ? ` · Last room ${judge.current_room.name}` : ''}
                    </p>
                  </div>

                  <Badge
                    variant="secondary"
                    className={
                      judge.status === 'active'
                        ? 'bg-emerald-100 text-emerald-800'
                        : judge.status === 'on_break'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-sky-100 text-sky-800'
                    }
                  >
                    {judge.status === 'active' ? 'Live judging' : judge.status === 'on_break' ? 'On break' : 'Idle'}
                  </Badge>
                </div>

                {hasActiveSet ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Current set</p>
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-medium tabular-nums ${getElapsedTone(elapsed)}`}>
                        {formatElapsed(judge.active_set!.assigned_at)}
                      </span>
                    </div>

                    <ul className="space-y-2">
                      {judge.active_set!.judging_set_teams
                        .slice()
                        .sort((a, b) => a.visit_order - b.visit_order)
                        .map(setTeam => (
                          <li key={setTeam.id} className="flex items-start gap-3">
                            <span className={`mt-0.5 inline-flex rounded-lg px-2 py-1 text-[11px] font-medium ${
                              setTeam.is_visited ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'
                            }`} aria-hidden="true">
                              {setTeam.visit_order}
                            </span>
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium">{setTeam.team?.name || 'Unknown team'}</span>
                                {setTeam.is_visited && (
                                  <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] text-emerald-800">
                                    visited
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {setTeam.team?.room?.name} · #{setTeam.team?.team_number}
                              </p>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {judge.status === 'on_break'
                      ? 'Away from the queue for now.'
                      : 'Ready for the next assignment.'}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      ) : (
        <section className="space-y-4">
          {sortedTeams.map(team => {
            const isLocked = !!locks[team.id];
            const isAtTarget = team.times_judged >= targetJudgings;

            return (
              <article
                key={team.id}
                className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium">{team.name}</h2>
                    <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-[11px] text-stone-600">
                      #{team.team_number}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {team.project_name || 'No project title'} · {team.room?.name || '?'} · Floor {team.room?.floor || '?'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      isLocked
                        ? 'bg-sky-100 text-sky-800'
                        : isAtTarget
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-orange-100 text-orange-800'
                    }`}
                  >
                    {isLocked
                      ? `Live with ${locks[team.id]}`
                      : isAtTarget
                        ? 'At target'
                        : 'Needs more coverage'}
                  </span>
                </div>

                <div className="text-left sm:text-right">
                  <p className="text-sm font-semibold tabular-nums">{team.times_judged}/{targetJudgings}</p>
                  <p className="text-xs text-muted-foreground">judgings</p>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading dashboard...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
