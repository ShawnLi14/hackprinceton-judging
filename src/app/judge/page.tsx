'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, MapPinned } from 'lucide-react';
import BlockWordmark from '@/components/BlockWordmark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Judge, JudgingSetTeam, JudgingSetWithTeams, Room, Team } from '@/lib/types';

type SetTeamWithDetails = JudgingSetTeam & { team: Team & { room: Room } };
type TeamEvaluation = { score: string; is_absent: boolean };

function buildInitialEvaluations(set: JudgingSetWithTeams) {
  return set.judging_set_teams.reduce<Record<string, TeamEvaluation>>((acc, setTeam) => {
    acc[setTeam.team_id] = {
      score: setTeam.rank ? String(setTeam.rank) : '',
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
  const statusTone =
    phase === 'scoring'
      ? {
          badge: 'bg-sky-100 text-sky-900',
          label: 'Scoring',
          step: 'Step 2: score teams',
        }
      : {
          badge: 'bg-emerald-100 text-emerald-900',
          label: 'Visiting',
          step: 'Step 1: visit teams',
        };

  if (!eventId) {
    return (
      <CenteredJudgeState
        kicker="Judging"
        title="Choose an event"
        description="Open the judge flow from the event list on the homepage."
      >
        <Button onClick={() => window.location.assign('/')} className="h-10 w-full rounded-lg">
          Go back
        </Button>
      </CenteredJudgeState>
    );
  }

  if (phase === 'login') {
    return (
      <CenteredJudgeState
        kicker="Judge sign in"
        title="Enter your access code"
        description="Use the code your organizer gave you."
      >
        <div className="space-y-2 text-left">
          <Label htmlFor="judge-access-code">Access code</Label>
          <Input
            id="judge-access-code"
            placeholder="JUDGE-001"
            value={accessCode}
            onChange={e => setAccessCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && login()}
            className="h-10 rounded-lg font-mono text-sm tabular-nums"
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          onClick={login}
          disabled={loading || !accessCode.trim()}
          className="h-10 w-full rounded-lg"
        >
          {loading ? 'Logging in...' : 'Start judging'}
        </Button>
      </CenteredJudgeState>
    );
  }

  if (phase === 'waiting') {
    return (
      <CenteredJudgeState
        kicker="Ready"
        title={judge?.name || 'Judge'}
        description={`${judge?.sets_completed || 0} set${judge?.sets_completed === 1 ? '' : 's'} completed.`}
      >
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={requestSet} disabled={loading} className="h-10 w-full rounded-lg">
            {loading ? 'Finding teams...' : 'Get next set'}
          </Button>
          <Button onClick={goOnBreak} variant="outline" className="h-10 w-full rounded-lg">
            Take a break
          </Button>
        </div>
      </CenteredJudgeState>
    );
  }

  if (phase === 'on_break') {
    return (
      <CenteredJudgeState
        kicker="On break"
        title={judge?.name || 'Judge'}
        description="Resume whenever you are ready for another set."
      >
        <p className="text-sm text-muted-foreground tabular-nums">
          {judge?.sets_completed || 0} set{judge?.sets_completed === 1 ? '' : 's'} completed
        </p>
        <Button onClick={comeBackFromBreak} className="h-10 w-full rounded-lg">
          Resume judging
        </Button>
      </CenteredJudgeState>
    );
  }

  return (
    <div className="editorial-shell px-4 py-6 pb-28">
      <main className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-8">
          <header className="space-y-3">
            <p className="editorial-kicker">Judging</p>

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{statusTone.step}</p>
                <h1 className="text-base font-semibold tracking-[-0.02em] text-balance">{judge?.name}</h1>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {floor !== undefined && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPinned className="size-4" aria-hidden="true" />
                      Floor {floor}
                    </span>
                  )}
                  <span className="tabular-nums">
                    <ElapsedTimer startTime={activeSet?.assigned_at || ''} />
                  </span>
                </div>
              </div>

              <Badge className={statusTone.badge}>{statusTone.label}</Badge>
            </div>

            <p className="max-w-2xl text-sm leading-6 text-muted-foreground text-pretty">
              Finish the walk first, then give each present team a whole-number score from 1 to 5.
            </p>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </header>

          <section className="space-y-7">
            {setTeams.map(setTeam => {
              const evaluation = evaluations[setTeam.team_id];
              const isAbsent = evaluation?.is_absent;
              const isVisited = setTeam.is_visited;

              return (
                <article key={setTeam.id} className="space-y-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-muted/70 px-2 text-sm font-medium tabular-nums">
                          {setTeam.visit_order}
                        </span>
                        <h2 className="min-w-0 text-base font-medium tracking-[-0.01em]">{setTeam.team?.project_name || 'Untitled'}</h2>
                        {isVisited && !isAbsent && (
                          <Badge className="bg-emerald-100 text-emerald-900">Visited</Badge>
                        )}
                        {isAbsent && <Badge variant="outline">Absent</Badge>}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">Room {setTeam.team?.room?.name}</Badge>
                        <Badge variant="outline">Team #{setTeam.team?.team_number}</Badge>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {phase === 'judging' && !isAbsent && (
                        <Button
                          size="sm"
                          variant={isVisited ? 'secondary' : 'default'}
                          onClick={() => markVisited(setTeam.team_id)}
                          disabled={isVisited}
                          className="min-w-28 rounded-lg"
                        >
                          {isVisited ? 'Visited' : 'Mark visited'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleAbsent(setTeam.team_id)}
                        aria-pressed={isAbsent}
                        className="min-w-28 rounded-lg"
                      >
                        {isAbsent ? 'Mark present' : 'Mark absent'}
                      </Button>
                    </div>
                  </div>

                  {phase === 'scoring' && !isAbsent && (
                    <div className="max-w-[108px] space-y-2">
                      <div className="space-y-2">
                        <Label htmlFor={`score-${setTeam.team_id}`}>Score / 5</Label>
                        <Input
                          id={`score-${setTeam.team_id}`}
                          type="number"
                          min={1}
                          max={5}
                          inputMode="numeric"
                          value={evaluation?.score || ''}
                          onChange={e => updateScore(setTeam.team_id, e.target.value)}
                          className="h-10 text-center text-sm tabular-nums"
                          aria-describedby={`score-help-${setTeam.team_id}`}
                        />
                        <p id={`score-help-${setTeam.team_id}`} className="text-xs text-muted-foreground">
                          Whole numbers only
                        </p>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">Checklist</p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground text-pretty">
              {phase === 'judging'
                ? 'Mark each team as visited or absent before moving to scoring.'
                : 'Every present team needs a score before this set can be submitted.'}
            </p>
          </div>

          <div className="space-y-2">
            <SummaryRow label="Teams in set" value={`${setTeams.length}`} />
            <SummaryRow label="Visited or absent" value={`${visitedOrAbsentCount}/${setTeams.length}`} />
            <SummaryRow label="Scores entered" value={`${scoredTeams}/${presentTeams.length}`} />
          </div>

          <p className="text-sm leading-6 text-muted-foreground text-pretty">
            {phase === 'judging'
              ? 'If a team is unavailable, mark them absent and continue.'
              : missingScores > 0
                ? `${missingScores} present team${missingScores === 1 ? '' : 's'} still need a score.`
                : 'All scores are in. Submit whenever you are ready.'}
          </p>
        </aside>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/96 px-4 py-4 backdrop-blur">
        <div
          className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0px)' }}
        >
          {phase === 'judging' ? (
            <Button
              onClick={() => setPhase('scoring')}
              className="h-10 w-full rounded-lg sm:flex-1"
              disabled={!allVisited}
            >
              {allVisited ? 'Continue to scoring' : `Visit all teams first (${visitedOrAbsentCount}/${setTeams.length})`}
            </Button>
          ) : (
            <>
              <Button onClick={() => setPhase('judging')} variant="outline" className="h-10 w-full rounded-lg sm:flex-1">
                Back to visits
              </Button>
              <Button
                onClick={submitScores}
                disabled={loading || !canSubmitScores}
                className="h-10 w-full rounded-lg sm:flex-1"
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

function CenteredJudgeState({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="editorial-shell px-4 py-10">
      <main className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-3xl flex-col items-center justify-center gap-8">
        <BlockWordmark text="JUDGING" className="max-w-[360px]" />

        <section className="w-full max-w-sm space-y-5 text-center">
          <div className="space-y-2">
            <p className="editorial-kicker">{kicker}</p>
            <h1 className="text-base font-semibold tracking-[-0.02em] text-balance">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground text-pretty">{description}</p>
          </div>

          <div className="space-y-3">{children}</div>
        </section>
      </main>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
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
          <p className="text-sm text-muted-foreground">Loading judge view...</p>
        </div>
      }
    >
      <JudgePageContent />
    </Suspense>
  );
}
