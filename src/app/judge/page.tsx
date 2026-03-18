'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { Judge, JudgingSetWithTeams, JudgingSetTeam, Team, Room } from '@/lib/types';

type SetTeamWithDetails = JudgingSetTeam & { team: Team & { room: Room } };

function JudgePageContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');

  const [judge, setJudge] = useState<Judge | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [activeSet, setActiveSet] = useState<JudgingSetWithTeams | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'login' | 'waiting' | 'judging' | 'ranking' | 'on_break'>('login');

  // Ranking state
  const [rankings, setRankings] = useState<Record<string, { rank: number; notes: string; is_absent: boolean }>>({});

  const login = async () => {
    if (!accessCode.trim() || !eventId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/judges/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode.toUpperCase(), event_id: eventId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      setJudge(data.judge);
      if (data.active_set) {
        setActiveSet(data.active_set);
        setPhase('judging');
        initRankings(data.active_set);
      } else {
        setPhase('waiting');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const initRankings = (set: JudgingSetWithTeams) => {
    const r: Record<string, { rank: number; notes: string; is_absent: boolean }> = {};
    set.judging_set_teams.forEach((st, idx) => {
      r[st.team_id] = { rank: idx + 1, notes: '', is_absent: false };
    });
    setRankings(r);
  };

  const requestSet = async () => {
    if (!judge || !eventId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/judges/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judge_id: judge.id, event_id: eventId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No teams available');
        return;
      }
      setActiveSet(data.set);
      setPhase('judging');
      initRankings(data.set);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const markVisited = async (teamId: string) => {
    if (!activeSet) return;
    await fetch('/api/judges/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judging_set_id: activeSet.id, team_id: teamId }),
    });
    // Update local state
    setActiveSet(prev => {
      if (!prev) return null;
      return {
        ...prev,
        judging_set_teams: prev.judging_set_teams.map(st =>
          st.team_id === teamId ? { ...st, is_visited: true } : st
        ),
      };
    });
  };

  const toggleAbsent = (teamId: string) => {
    setRankings(prev => ({
      ...prev,
      [teamId]: { ...prev[teamId], is_absent: !prev[teamId].is_absent },
    }));
  };

  const moveRank = (teamId: string, direction: 'up' | 'down') => {
    const presentTeams = activeSet?.judging_set_teams
      .filter(st => !rankings[st.team_id]?.is_absent)
      .sort((a, b) => (rankings[a.team_id]?.rank || 0) - (rankings[b.team_id]?.rank || 0)) || [];

    const currentIdx = presentTeams.findIndex(st => st.team_id === teamId);
    if (currentIdx === -1) return;

    const swapIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
    if (swapIdx < 0 || swapIdx >= presentTeams.length) return;

    const currentTeamId = presentTeams[currentIdx].team_id;
    const swapTeamId = presentTeams[swapIdx].team_id;

    setRankings(prev => ({
      ...prev,
      [currentTeamId]: { ...prev[currentTeamId], rank: swapIdx + 1 },
      [swapTeamId]: { ...prev[swapTeamId], rank: currentIdx + 1 },
    }));
  };

  const submitRankings = async () => {
    if (!activeSet) return;
    setLoading(true);
    setError('');

    // Build final rankings - absent teams get rank = null (set_size)
    const setSize = activeSet.judging_set_teams.length;
    const finalRankings = activeSet.judging_set_teams.map(st => ({
      team_id: st.team_id,
      rank: rankings[st.team_id]?.is_absent ? setSize : rankings[st.team_id]?.rank || setSize,
      notes: rankings[st.team_id]?.notes || '',
      is_absent: rankings[st.team_id]?.is_absent || false,
    }));

    try {
      const res = await fetch('/api/judges/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judging_set_id: activeSet.id, rankings: finalRankings }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Submit failed');
        return;
      }
      setActiveSet(null);
      setJudge(prev => prev ? { ...prev, sets_completed: prev.sets_completed + 1 } : prev);
      setPhase('waiting');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const goOnBreak = async () => {
    if (!judge) return;
    await fetch('/api/judges/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judge_id: judge.id, on_break: true }),
    });
    setPhase('on_break');
  };

  const comeBackFromBreak = async () => {
    if (!judge) return;
    await fetch('/api/judges/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judge_id: judge.id, on_break: false }),
    });
    setPhase('waiting');
  };

  if (!eventId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardHeader>
            <CardTitle>No Event Selected</CardTitle>
            <CardDescription>Please go back and select an event first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.href = '/'} className="w-full">
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // LOGIN SCREEN
  if (phase === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <Card className="max-w-sm w-full">
          <CardHeader className="text-center">
            <div className="text-3xl mb-2">⚖️</div>
            <CardTitle>Judge Login</CardTitle>
            <CardDescription>Enter your access code to begin</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="e.g. JUDGE-001"
              value={accessCode}
              onChange={e => setAccessCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && login()}
              className="text-center text-lg font-mono tracking-wider"
              autoFocus
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button onClick={login} disabled={loading || !accessCode.trim()} className="w-full">
              {loading ? 'Logging in...' : 'Start Judging'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // WAITING SCREEN
  if (phase === 'waiting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <Card className="max-w-sm w-full">
          <CardHeader className="text-center">
            <CardTitle>Welcome, {judge?.name}!</CardTitle>
            <CardDescription>
              {judge?.sets_completed || 0} sets completed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button onClick={requestSet} disabled={loading} className="w-full" size="lg">
              {loading ? 'Finding teams...' : 'Get Next Set of Teams'}
            </Button>
            <Button onClick={goOnBreak} variant="outline" className="w-full">
              Take a Break
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // BREAK SCREEN
  if (phase === 'on_break') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
        <Card className="max-w-sm w-full">
          <CardHeader className="text-center">
            <div className="text-4xl mb-2">☕</div>
            <CardTitle>On Break</CardTitle>
            <CardDescription>
              Take your time, {judge?.name}. Tap below when you&apos;re ready to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              {judge?.sets_completed || 0} sets completed so far
            </p>
            <Button onClick={comeBackFromBreak} className="w-full" size="lg">
              Resume Judging
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // JUDGING / RANKING SCREEN
  const setTeams = activeSet?.judging_set_teams
    ?.sort((a, b) => {
      if (phase === 'ranking') {
        const aAbsent = rankings[a.team_id]?.is_absent;
        const bAbsent = rankings[b.team_id]?.is_absent;
        if (aAbsent !== bAbsent) return aAbsent ? 1 : -1;
        return (rankings[a.team_id]?.rank || 0) - (rankings[b.team_id]?.rank || 0);
      }
      return a.visit_order - b.visit_order;
    }) as SetTeamWithDetails[] || [];

  const allVisited = setTeams.every(st => st.is_visited || rankings[st.team_id]?.is_absent);
  const floor = setTeams[0]?.team?.room?.floor;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4 pb-24">
      {/* Header */}
      <div className="max-w-lg mx-auto mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg">{judge?.name}</h2>
            <p className="text-sm text-muted-foreground">Floor {floor}</p>
          </div>
          <div className="text-right">
            <Badge variant={phase === 'ranking' ? 'default' : 'secondary'}>
              {phase === 'ranking' ? 'Ranking' : 'Visiting'}
            </Badge>
            <ElapsedTimer startTime={activeSet?.assigned_at || ''} />
          </div>
        </div>
      </div>

      {/* Team cards */}
      <div className="max-w-lg mx-auto space-y-3">
        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        {setTeams.map((st, idx) => {
          const isAbsent = rankings[st.team_id]?.is_absent;
          const isVisited = st.is_visited;

          return (
            <Card
              key={st.id}
              className={`transition-all ${isAbsent ? 'opacity-50' : ''} ${isVisited ? 'border-green-200 bg-green-50/50' : ''}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {phase === 'ranking' && !isAbsent && (
                        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                          {rankings[st.team_id]?.rank}
                        </span>
                      )}
                      <h3 className="font-semibold truncate">{st.team?.name}</h3>
                    </div>
                    {st.team?.project_name && (
                      <p className="text-sm text-muted-foreground truncate">{st.team.project_name}</p>
                    )}
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        Room {st.team?.room?.name} (#{st.team?.room?.room_number})
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Table {st.team?.table_number}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    {phase === 'judging' && !isAbsent && (
                      <Button
                        size="sm"
                        variant={isVisited ? 'secondary' : 'default'}
                        onClick={() => markVisited(st.team_id)}
                        disabled={isVisited}
                      >
                        {isVisited ? '✓' : 'Visit'}
                      </Button>
                    )}
                    {phase === 'ranking' && !isAbsent && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => moveRank(st.team_id, 'up')}
                          disabled={rankings[st.team_id]?.rank === 1}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => moveRank(st.team_id, 'down')}
                        >
                          ↓
                        </Button>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => toggleAbsent(st.team_id)}
                    >
                      {isAbsent ? 'Present' : 'Absent'}
                    </Button>
                  </div>
                </div>

                {/* Notes (in ranking phase) */}
                {phase === 'ranking' && !isAbsent && (
                  <Textarea
                    placeholder="Optional notes..."
                    className="mt-2 text-sm"
                    rows={2}
                    value={rankings[st.team_id]?.notes || ''}
                    onChange={e => setRankings(prev => ({
                      ...prev,
                      [st.team_id]: { ...prev[st.team_id], notes: e.target.value },
                    }))}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t p-4">
        <div className="max-w-lg mx-auto">
          {phase === 'judging' ? (
            <Button
              onClick={() => setPhase('ranking')}
              className="w-full"
              size="lg"
              disabled={!allVisited}
            >
              {allVisited ? 'Rank Teams' : `Visit all teams first (${setTeams.filter(st => st.is_visited || rankings[st.team_id]?.is_absent).length}/${setTeams.length})`}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={() => setPhase('judging')}
                variant="outline"
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={submitRankings}
                disabled={loading}
                className="flex-1"
                size="lg"
              >
                {loading ? 'Submitting...' : 'Submit Rankings'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ElapsedTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState('0:00');

  useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const mins = Math.floor(diff / 60);
      const secs = diff % 60;
      setElapsed(`${mins}:${secs.toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return <p className="text-sm text-muted-foreground font-mono">{elapsed}</p>;
}

export default function JudgePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-lg text-muted-foreground">Loading...</div>
      </div>
    }>
      <JudgePageContent />
    </Suspense>
  );
}
