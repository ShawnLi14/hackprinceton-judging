'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  ClipboardList,
  Coffee,
  KeyRound,
  MapPinned,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { Judge, JudgingSetWithTeams, JudgingSetTeam, Team, Room } from '@/lib/types';

type SetTeamWithDetails = JudgingSetTeam & { team: Team & { room: Room } };
type TeamEvaluation = { score: string; notes: string; is_absent: boolean };

function buildInitialEvaluations(set: JudgingSetWithTeams) {
  return set.judging_set_teams.reduce<Record<string, TeamEvaluation>>((acc, setTeam) => {
    acc[setTeam.team_id] = {
      score: setTeam.rank ? String(setTeam.rank) : '',
      notes: setTeam.notes || '',
      is_absent: setTeam.is_absent || false,
    };
    return acc;
  }, {});
}

function JudgePageContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');

  const [judge, setJudge] = useState<Judge | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [activeSet, setActiveSet] = useState<JudgingSetWithTeams | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'login' | 'waiting' | 'judging' | 'scoring' | 'on_break'>('login');
  const [evaluations, setEvaluations] = useState<Record<string, TeamEvaluation>>({});

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
        setEvaluations(buildInitialEvaluations(data.active_set));
        setPhase('judging');
      } else {
        setPhase('waiting');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
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
      setEvaluations(buildInitialEvaluations(data.set));
      setPhase('judging');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const markVisited = async (teamId: string) => {
    if (!activeSet) return;

    const res = await fetch('/api/judges/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judging_set_id: activeSet.id, team_id: teamId }),
    });

    if (!res.ok) {
      setError('Could not save that visit. Please try again.');
      return;
    }

    setActiveSet(prev => {
      if (!prev) return null;
      return {
        ...prev,
        judging_set_teams: prev.judging_set_teams.map(setTeam =>
          setTeam.team_id === teamId ? { ...setTeam, is_visited: true } : setTeam
        ),
      };
    });
  };

  const toggleAbsent = (teamId: string) => {
    setEvaluations(prev => {
      const current = prev[teamId];
      const nextAbsent = !current?.is_absent;

      return {
        ...prev,
        [teamId]: {
          ...current,
          is_absent: nextAbsent,
          score: nextAbsent ? '' : current?.score || '',
          notes: current?.notes || '',
        },
      };
    });
  };

  const updateScore = (teamId: string, value: string) => {
    const normalized = value.replace(/[^0-9]/g, '').slice(0, 1);
    const nextScore =
      normalized === '' || (Number(normalized) >= 1 && Number(normalized) <= 5) ? normalized : '';

    setEvaluations(prev => ({
      ...prev,
      [teamId]: {
        ...prev[teamId],
        score: nextScore,
        notes: prev[teamId]?.notes || '',
        is_absent: prev[teamId]?.is_absent || false,
      },
    }));
  };

  const submitScores = async () => {
    if (!activeSet) return;
    setLoading(true);
    setError('');

    const submittedEvaluations = activeSet.judging_set_teams.map(setTeam => ({
      team_id: setTeam.team_id,
      score: evaluations[setTeam.team_id]?.is_absent ? null : Number(evaluations[setTeam.team_id]?.score || ''),
      notes: evaluations[setTeam.team_id]?.notes || '',
      is_absent: evaluations[setTeam.team_id]?.is_absent || false,
    }));

    try {
      const res = await fetch('/api/judges/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judging_set_id: activeSet.id, evaluations: submittedEvaluations }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Submit failed');
        return;
      }

      setActiveSet(null);
      setEvaluations({});
      setJudge(prev => (prev ? { ...prev, sets_completed: prev.sets_completed + 1 } : prev));
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

  const setTeams = useMemo(
    () =>
      ((activeSet?.judging_set_teams || [])
        .slice()
        .sort((a, b) => {
          const aAbsent = evaluations[a.team_id]?.is_absent;
          const bAbsent = evaluations[b.team_id]?.is_absent;
          if (aAbsent !== bAbsent) return aAbsent ? 1 : -1;
          return a.visit_order - b.visit_order;
        }) as SetTeamWithDetails[]),
    [activeSet?.judging_set_teams, evaluations]
  );

  const allVisited = setTeams.every(setTeam => setTeam.is_visited || evaluations[setTeam.team_id]?.is_absent);
  const visitedOrAbsentCount = setTeams.filter(
    setTeam => setTeam.is_visited || evaluations[setTeam.team_id]?.is_absent
  ).length;
  const presentTeams = setTeams.filter(setTeam => !evaluations[setTeam.team_id]?.is_absent);
  const scoredTeams = presentTeams.filter(setTeam => {
    const score = Number(evaluations[setTeam.team_id]?.score);
    return Number.isInteger(score) && score >= 1 && score <= 5;
  }).length;
  const missingScores = presentTeams.length - scoredTeams;
  const canSubmitScores = missingScores === 0;
  const floor = setTeams[0]?.team?.room?.floor;

  if (!eventId) {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>No event selected</CardTitle>
            <CardDescription>Please go back and choose an event first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.assign('/')} className="w-full">
              Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-border/60 shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">
                <KeyRound className="size-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="font-pixel text-xs text-muted-foreground">HackPrinceton Judging</p>
                <CardTitle className="text-2xl text-balance">Judge check-in</CardTitle>
              </div>
            </div>
            <CardDescription className="text-pretty">
              Enter your access code, visit each assigned team, then submit a score from 1 to 5 for every present team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="judge-access-code">Access code</Label>
              <Input
                id="judge-access-code"
                placeholder="e.g. JUDGE-001"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && login()}
                className="h-11 text-center font-mono text-base tabular-nums"
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground">
                <ClipboardList className="size-4" aria-hidden="true" />
                <span className="font-medium">How judging works</span>
              </div>
              <p className="mt-2 text-pretty">
                Step 1: mark each visit complete. Step 2: enter a whole-number score out of 5. Add notes only when they help organizers.
              </p>
            </div>

            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

            <Button onClick={login} disabled={loading || !accessCode.trim()} className="h-11 w-full">
              {loading ? 'Logging in...' : 'Start judging'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-border/60 shadow-sm">
          <CardHeader className="space-y-3">
            <p className="font-pixel text-xs text-muted-foreground">Ready for the next set</p>
            <div className="space-y-1">
              <CardTitle className="text-3xl text-balance">{judge?.name}</CardTitle>
              <CardDescription className="text-pretty">
                You&apos;ve completed <span className="font-medium text-foreground tabular-nums">{judge?.sets_completed || 0}</span> sets so far.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button onClick={requestSet} disabled={loading} className="h-11 w-full">
              {loading ? 'Finding teams...' : 'Get next set of teams'}
            </Button>
            <Button onClick={goOnBreak} variant="outline" className="h-11 w-full">
              Take a break
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === 'on_break') {
    return (
      <div className="app-shell flex min-h-dvh items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md border-border/60 shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">
                <Coffee className="size-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="font-pixel text-xs text-muted-foreground">Break mode</p>
                <CardTitle className="text-2xl">Paused</CardTitle>
              </div>
            </div>
            <CardDescription className="text-pretty">
              Take your time, {judge?.name}. Resume when you&apos;re ready for another set.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground tabular-nums">
              {judge?.sets_completed || 0} sets completed
            </p>
            <Button onClick={comeBackFromBreak} className="h-11 w-full">
              Resume judging
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-dvh px-4 py-6 pb-32">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <Card className={`shadow-sm ${phase === 'scoring' ? 'border-sky-200 bg-sky-50/35' : 'border-emerald-200 bg-emerald-50/35'}`}>
          <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="font-pixel text-xs text-muted-foreground">
                {phase === 'scoring' ? 'Step 2: score teams' : 'Step 1: visit teams'}
              </p>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold text-balance">{judge?.name}</h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPinned className="size-4" aria-hidden="true" />
                    Floor {floor}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ElapsedTimer startTime={activeSet?.assigned_at || ''} />
                  </span>
                </div>
              </div>
              <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
                Keep the flow simple: finish the walk, then give each present team a whole-number score from 1 to 5.
              </p>
            </div>

            <Badge
              variant={phase === 'scoring' ? 'default' : 'secondary'}
              className={phase === 'scoring' ? 'w-fit self-start bg-sky-600 text-white' : 'w-fit self-start bg-emerald-100 text-emerald-800'}
            >
              {phase === 'scoring' ? 'Scoring' : 'Visiting'}
            </Badge>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            {error && (
              <Card className="border-destructive/30 bg-destructive/5 shadow-none">
                <CardContent className="p-4">
                  <p className="text-sm text-destructive" role="alert">{error}</p>
                </CardContent>
              </Card>
            )}

            {setTeams.map(setTeam => {
              const evaluation = evaluations[setTeam.team_id];
              const isAbsent = evaluation?.is_absent;
              const isVisited = setTeam.is_visited;

              return (
                <Card
                  key={setTeam.id}
                  className={`shadow-sm ${
                    isAbsent
                      ? 'border-border/60 bg-muted/20'
                      : isVisited
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : phase === 'scoring'
                          ? 'border-sky-200 bg-sky-50/30'
                          : 'border-border/60 bg-card'
                  }`}
                >
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex size-8 items-center justify-center rounded-full border border-border/60 bg-muted text-sm font-medium tabular-nums">
                            {setTeam.visit_order}
                          </span>
                          <h2 className="truncate text-lg font-medium">{setTeam.team?.name}</h2>
                          {isVisited && !isAbsent && <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Visited</Badge>}
                          {isAbsent && <Badge variant="outline">Absent</Badge>}
                        </div>

                        {setTeam.team?.project_name && (
                          <p className="text-sm text-pretty text-muted-foreground">{setTeam.team.project_name}</p>
                        )}

                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline">Room {setTeam.team?.room?.name}</Badge>
                          <Badge variant="outline">Table #{setTeam.team?.team_number}</Badge>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        {phase === 'judging' && !isAbsent && (
                          <Button
                            size="sm"
                            variant={isVisited ? 'secondary' : 'default'}
                            onClick={() => markVisited(setTeam.team_id)}
                            disabled={isVisited}
                          >
                            {isVisited ? 'Visited' : 'Mark visited'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleAbsent(setTeam.team_id)}
                          aria-pressed={isAbsent}
                        >
                          {isAbsent ? 'Mark present' : 'Mark absent'}
                        </Button>
                      </div>
                    </div>

                    {phase === 'scoring' && !isAbsent && (
                      <div className="grid gap-4 sm:grid-cols-[130px_minmax(0,1fr)]">
                        <div className="space-y-2">
                          <Label htmlFor={`score-${setTeam.team_id}`}>Score / 5</Label>
                          <Input
                            id={`score-${setTeam.team_id}`}
                            type="number"
                            min={1}
                            max={5}
                            inputMode="numeric"
                            value={evaluation?.score || ''}
                            onChange={(e) => updateScore(setTeam.team_id, e.target.value)}
                            className="h-11 text-center text-lg tabular-nums"
                            aria-describedby={`score-help-${setTeam.team_id}`}
                          />
                          <p id={`score-help-${setTeam.team_id}`} className="text-xs text-muted-foreground">
                            Whole numbers only.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`notes-${setTeam.team_id}`}>Notes</Label>
                          <Textarea
                            id={`notes-${setTeam.team_id}`}
                            placeholder="Optional notes for organizers"
                            className="min-h-24 text-sm"
                            rows={3}
                            value={evaluation?.notes || ''}
                            onChange={(e) =>
                              setEvaluations(prev => ({
                                ...prev,
                                [setTeam.team_id]: {
                                  ...prev[setTeam.team_id],
                                  notes: e.target.value,
                                  score: prev[setTeam.team_id]?.score || '',
                                  is_absent: prev[setTeam.team_id]?.is_absent || false,
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className={`shadow-sm lg:sticky lg:top-20 lg:self-start ${phase === 'scoring' ? 'border-sky-200 bg-sky-50/35' : 'border-emerald-200 bg-emerald-50/35'}`}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden="true" />
                <CardTitle>Checklist</CardTitle>
              </div>
              <CardDescription>
                {phase === 'judging'
                  ? 'Finish every visit first.'
                  : 'Every present team needs a score before submission.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SummaryRow label="Teams in set" value={`${setTeams.length}`} />
              <SummaryRow label="Visited or absent" value={`${visitedOrAbsentCount}/${setTeams.length}`} />
              <SummaryRow label="Scores entered" value={`${scoredTeams}/${presentTeams.length}`} />
              <div className={`rounded-xl p-3 ${
                phase === 'judging'
                  ? 'bg-emerald-100/70 text-emerald-950'
                  : missingScores > 0
                    ? 'bg-sky-100/70 text-sky-950'
                    : 'bg-sky-600 text-white'
              }`}>
                {phase === 'judging'
                  ? 'Mark visits as you go. If a team is unavailable, mark them absent and continue.'
                  : missingScores > 0
                    ? `${missingScores} present team${missingScores === 1 ? '' : 's'} still need a score.`
                    : 'All scores are in. You can submit this set now.'}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/95 px-4 py-4 backdrop-blur">
        <div
          className="mx-auto flex w-full max-w-4xl flex-col gap-2 sm:flex-row"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0px)' }}
        >
          {phase === 'judging' ? (
            <Button
              onClick={() => setPhase('scoring')}
              className="h-11 w-full sm:flex-1"
              disabled={!allVisited}
            >
              {allVisited ? 'Continue to scoring' : `Visit all teams first (${visitedOrAbsentCount}/${setTeams.length})`}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => setPhase('judging')}
                variant="outline"
                className="h-11 w-full sm:flex-1"
              >
                Back to visits
              </Button>
              <Button
                onClick={submitScores}
                disabled={loading || !canSubmitScores}
                className="h-11 w-full sm:flex-1"
              >
                {loading ? 'Submitting...' : 'Submit scores'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
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

  return <span className="font-mono tabular-nums">{elapsed}</span>;
}

export default function JudgePage() {
  return (
    <Suspense
      fallback={
        <div className="app-shell flex min-h-dvh items-center justify-center px-4 py-10">
          <div className="rounded-full border border-border/60 bg-background px-4 py-2 text-sm text-muted-foreground">
            Loading judge view...
          </div>
        </div>
      }
    >
      <JudgePageContent />
    </Suspense>
  );
}
