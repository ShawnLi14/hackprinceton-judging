'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import type { Event, Judge, Team, Room, JudgingSetWithTeams } from '@/lib/types';

interface JudgeWithSet extends Judge {
  active_set: JudgingSetWithTeams | null;
  current_room?: Room;
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');

  const [event, setEvent] = useState<Event | null>(null);
  const [judges, setJudges] = useState<JudgeWithSet[]>([]);
  const [teams, setTeams] = useState<(Team & { room?: Room })[]>([]);
  const [locks, setLocks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  // Debounce ref: prevents hundreds of simultaneous reloads from realtime events
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    // Skip if already loading (prevent overlapping fetches)
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [eventRes, judgesRes, teamsRes] = await Promise.all([
        fetch(`/api/events?id=${eventId}`),
        fetch(`/api/organizer/judges?event_id=${eventId}`),
        fetch(`/api/organizer/teams?event_id=${eventId}`),
      ]);

      if (!eventRes.ok || !judgesRes.ok || !teamsRes.ok) {
        console.warn('Dashboard: one or more API responses not ok');
        return;
      }

      setEvent(await eventRes.json());
      setJudges(await judgesRes.json());
      setTeams(await teamsRes.json());

      // Get active locks
      const { data: activeLocks } = await supabase
        .from('team_locks')
        .select('team_id, judging_set_id, judging_set:judging_sets(judge_id, judge:judges(name))')
        .is('released_at', null);

      const lockMap: Record<string, string> = {};
      for (const lock of activeLocks || []) {
        const judgeName = (lock.judging_set as unknown as { judge: { name: string } })?.judge?.name || 'Unknown';
        lockMap[lock.team_id] = judgeName;
      }
      setLocks(lockMap);
    } catch (e) {
      // Silently swallow fetch errors from realtime bursts — the next interval will retry
      console.warn('Dashboard load skipped (burst):', (e as Error).message);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [eventId]);

  // Debounced version for realtime: coalesces rapid-fire events into one reload
  const debouncedLoadData = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      loadData();
    }, 500); // Wait 500ms of quiet before reloading
  }, [loadData]);

  // Initial load
  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Tick the clock every second for timers
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Realtime subscription for live updates (debounced)
  useEffect(() => {
    if (!eventId) return;

    const channel = supabase
      .channel('dashboard-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judging_sets', filter: `event_id=eq.${eventId}` }, () => debouncedLoadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judging_set_teams' }, () => debouncedLoadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_locks' }, () => debouncedLoadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judges', filter: `event_id=eq.${eventId}` }, () => debouncedLoadData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [eventId, debouncedLoadData]);

  const controlEvent = async (action: string) => {
    if (!eventId) return;
    await fetch('/api/organizer/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, action }),
    });
    loadData();
  };

  if (!eventId) {
    return <p>No event selected. <a href="/" className="underline">Go back</a></p>;
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  // Calculate stats
  const totalTeams = teams.length;
  const activeJudges = judges.filter(j => j.status === 'active').length;
  const idleJudges = judges.filter(j => j.status === 'idle').length;
  const breakJudges = judges.filter(j => j.status === 'on_break').length;
  const timesJudged = teams.map(t => t.times_judged);
  const avgJudgings = totalTeams > 0 ? (timesJudged.reduce((a, b) => a + b, 0) / totalTeams).toFixed(1) : '0';
  const minJudgings = totalTeams > 0 ? Math.min(...timesJudged) : 0;
  const maxJudgings = totalTeams > 0 ? Math.max(...timesJudged) : 0;
  const targetJudgings = event?.target_judgings_per_team || 3;
  const teamsAtTarget = teams.filter(t => t.times_judged >= targetJudgings).length;
  const totalSetsCompleted = judges.reduce((sum, j) => sum + j.sets_completed, 0);

  const getElapsedMinutes = (assignedAt: string) => {
    return (now - new Date(assignedAt).getTime()) / 60000;
  };

  const getTimeColor = (minutes: number) => {
    const max = event?.max_judging_minutes || 20;
    if (minutes < max * 0.5) return 'text-green-600';
    if (minutes < max * 0.8) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatElapsed = (assignedAt: string) => {
    const mins = getElapsedMinutes(assignedAt);
    const m = Math.floor(mins);
    const s = Math.floor((mins - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{event?.name} — Live Dashboard</h1>
          <p className="text-sm text-muted-foreground">Auto-refreshing every 10s</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={event?.status === 'active' ? 'default' : 'secondary'} className="text-sm">
            {event?.status}
          </Badge>
          {event?.status === 'active' && (
            <>
              <Button size="sm" variant="outline" onClick={() => controlEvent('pause')}>Pause</Button>
              <Button size="sm" variant="destructive" onClick={() => controlEvent('complete')}>End Judging</Button>
            </>
          )}
          {event?.status === 'paused' && (
            <Button size="sm" onClick={() => controlEvent('start')}>Resume</Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{totalTeams}</p>
            <p className="text-xs text-muted-foreground">Total Teams</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{activeJudges}</p>
            <p className="text-xs text-muted-foreground">Active Judges</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{totalSetsCompleted}</p>
            <p className="text-xs text-muted-foreground">Sets Done</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{avgJudgings}</p>
            <p className="text-xs text-muted-foreground">Avg Judgings</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{minJudgings}–{maxJudgings}</p>
            <p className="text-xs text-muted-foreground">Min–Max</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{teamsAtTarget}/{totalTeams}</p>
            <p className="text-xs text-muted-foreground">At Target ({targetJudgings})</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="judges">
        <TabsList>
          <TabsTrigger value="judges">Judges ({judges.length})</TabsTrigger>
          <TabsTrigger value="teams">Teams ({teams.length})</TabsTrigger>
        </TabsList>

        {/* JUDGES TAB */}
        <TabsContent value="judges" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {judges.map(judge => {
              const hasActiveSet = !!judge.active_set;
              const elapsed = hasActiveSet ? getElapsedMinutes(judge.active_set!.assigned_at) : 0;
              const timeColor = hasActiveSet ? getTimeColor(elapsed) : '';

              return (
                <Card key={judge.id} className={`transition-all ${
                  judge.status === 'on_break' ? 'opacity-60' :
                  hasActiveSet && elapsed > (event?.max_judging_minutes || 20) ? 'border-red-300 bg-red-50/50' :
                  hasActiveSet ? 'border-green-200 bg-green-50/30' : ''
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{judge.name}</h3>
                        <Badge variant="outline" className="text-xs font-mono">{judge.access_code}</Badge>
                      </div>
                      <Badge variant={
                        judge.status === 'active' ? 'default' :
                        judge.status === 'on_break' ? 'secondary' : 'outline'
                      }>
                        {judge.status === 'active' ? 'Judging' :
                         judge.status === 'on_break' ? 'Break' : 'Idle'}
                      </Badge>
                    </div>

                    <div className="text-sm text-muted-foreground mb-2">
                      {judge.sets_completed} sets completed
                      {judge.current_room && ` · Last: ${(judge.current_room as Room).name}`}
                    </div>

                    {hasActiveSet && (
                      <>
                        <Separator className="my-2" />
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">Current set</span>
                          <span className={`text-sm font-mono font-semibold ${timeColor}`}>
                            {formatElapsed(judge.active_set!.assigned_at)}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {judge.active_set!.judging_set_teams
                            ?.sort((a, b) => a.visit_order - b.visit_order)
                            .map(st => (
                            <div key={st.id} className={`flex items-start gap-2 text-xs rounded-md px-2 py-1.5 ${
                              st.is_visited ? 'bg-green-50 dark:bg-green-950/20' : 'bg-muted/40'
                            }`}>
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 mt-0.5 ${
                                st.is_visited ? 'bg-green-500 text-white' : 'bg-muted-foreground/20'
                              }`}>
                                {st.is_visited ? '✓' : st.visit_order}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">
                                  {st.team?.name || 'Unknown'}
                                </div>
                                <div className="text-muted-foreground">
                                  {st.team?.room?.name} · #{st.team?.team_number}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* TEAMS TAB */}
        <TabsContent value="teams" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Team</th>
                      <th className="text-left p-3 font-medium">Project</th>
                      <th className="text-left p-3 font-medium">Room</th>
                      <th className="text-left p-3 font-medium">Team #</th>
                      <th className="text-center p-3 font-medium">Floor</th>
                      <th className="text-center p-3 font-medium">Times Judged</th>
                      <th className="text-left p-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams
                      .sort((a, b) => a.times_judged - b.times_judged)
                      .map(team => {
                        const isLocked = !!locks[team.id];
                        const judgingDeficit = targetJudgings - team.times_judged;

                        return (
                          <tr key={team.id} className={`border-b ${
                            isLocked ? 'bg-blue-50/50' :
                            team.times_judged >= targetJudgings ? 'bg-green-50/30' :
                            judgingDeficit > 1 ? 'bg-orange-50/30' : ''
                          }`}>
                            <td className="p-3 font-medium">{team.name}</td>
                            <td className="p-3 text-muted-foreground">{team.project_name || '—'}</td>
                            <td className="p-3">{team.room?.name || '?'}</td>
                            <td className="p-3">{team.team_number}</td>
                            <td className="p-3 text-center">{team.room?.floor || '?'}</td>
                            <td className="p-3 text-center">
                              <Badge variant={
                                team.times_judged >= targetJudgings ? 'default' :
                                team.times_judged === 0 ? 'destructive' : 'secondary'
                              }>
                                {team.times_judged}/{targetJudgings}
                              </Badge>
                            </td>
                            <td className="p-3">
                              {isLocked ? (
                                <Badge variant="outline" className="text-blue-600">
                                  Being judged by {locks[team.id]}
                                </Badge>
                              ) : team.times_judged >= targetJudgings ? (
                                <Badge variant="outline" className="text-green-600">Done</Badge>
                              ) : (
                                <span className="text-muted-foreground">Waiting</span>
                              )}
                            </td>
                          </tr>
                        );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Loading...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
