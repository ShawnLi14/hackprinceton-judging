'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Reorder } from 'motion/react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coffee,
  GripVertical,
  MapPinned,
  RotateCcw,
} from 'lucide-react';
import BlockWordmark from '@/components/BlockWordmark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Judge, JudgingSetTeam, JudgingSetWithTeams, Room, Team } from '@/lib/types';

type SetTeamWithDetails = JudgingSetTeam & { team: Team & { room: Room } };
type Phase = 'login' | 'waiting' | 'on_break' | 'visiting' | 'ranking' | 'review';

function JudgePageContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');

  const [judge, setJudge] = useState<Judge | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [activeSet, setActiveSet] = useState<JudgingSetWithTeams | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('login');
  // team_ids of present teams in their current rank order. Initialized when entering ranking.
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  // team_ids that the judge has marked absent (purely client-side until submit).
  const [absentIds, setAbsentIds] = useState<Set<string>>(new Set());

  const teamsById = useMemo(() => {
    const map = new Map<string, SetTeamWithDetails>();
    for (const st of (activeSet?.judging_set_teams || []) as SetTeamWithDetails[]) {
      map.set(st.team_id, st);
    }
    return map;
  }, [activeSet]);

  const setTeams = useMemo<SetTeamWithDetails[]>(
    () =>
      ((activeSet?.judging_set_teams || []) as SetTeamWithDetails[])
        .slice()
        .sort((a, b) => a.visit_order - b.visit_order),
    [activeSet]
  );

  const presentTeamsByVisitOrder = useMemo(
    () => setTeams.filter(st => !absentIds.has(st.team_id)),
    [setTeams, absentIds]
  );

  const visitedOrAbsentCount = setTeams.filter(
    st => st.is_visited || absentIds.has(st.team_id)
  ).length;
  const allHandled = visitedOrAbsentCount === setTeams.length;
  const nextUnhandledId = setTeams.find(
    st => !st.is_visited && !absentIds.has(st.team_id)
  )?.team_id;
  const floor = setTeams[0]?.team?.room?.floor;

  // ============================================
  // API actions
  // ============================================
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
        setAbsentIds(new Set());
        setPhase('visiting');
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
        setError(data.error || 'No teams available right now. Try again in a moment.');
        return;
      }
      setActiveSet(data.set);
      setAbsentIds(new Set());
      setPhase('visiting');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const setVisited = async (teamId: string, value: boolean) => {
    if (!activeSet) return;
    // Optimistic update
    setActiveSet(prev =>
      prev
        ? {
            ...prev,
            judging_set_teams: prev.judging_set_teams.map(st =>
              st.team_id === teamId ? { ...st, is_visited: value } : st
            ),
          }
        : prev
    );
    try {
      const res = await fetch('/api/judges/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judging_set_id: activeSet.id, team_id: teamId, is_visited: value }),
      });
      if (!res.ok) {
        setError('Could not save that change. Please try again.');
        // Revert optimistic update
        setActiveSet(prev =>
          prev
            ? {
                ...prev,
                judging_set_teams: prev.judging_set_teams.map(st =>
                  st.team_id === teamId ? { ...st, is_visited: !value } : st
                ),
              }
            : prev
        );
      }
    } catch {
      setError('Network error');
    }
  };

  const toggleAbsent = (teamId: string) => {
    setAbsentIds(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
        setRankOrder(order => (order.includes(teamId) ? order : [...order, teamId]));
      } else {
        next.add(teamId);
        setRankOrder(order => order.filter(id => id !== teamId));
      }
      return next;
    });
  };

  const enterRanking = () => {
    setRankOrder(presentTeamsByVisitOrder.map(st => st.team_id));
    setPhase('ranking');
  };

  const moveBy = (teamId: string, delta: number) => {
    setRankOrder(prev => {
      const idx = prev.indexOf(teamId);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const resetRankToVisitOrder = () => {
    setRankOrder(presentTeamsByVisitOrder.map(st => st.team_id));
  };

  const submit = async () => {
    if (!activeSet) return;
    setLoading(true);
    setError('');

    const evaluations = setTeams.map(st => {
      if (absentIds.has(st.team_id)) {
        return { team_id: st.team_id, rank: null as number | null, is_absent: true };
      }
      const rank = rankOrder.indexOf(st.team_id) + 1;
      return { team_id: st.team_id, rank, is_absent: false };
    });

    try {
      const res = await fetch('/api/judges/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judging_set_id: activeSet.id, evaluations }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Submit failed');
        return;
      }
      setActiveSet(null);
      setRankOrder([]);
      setAbsentIds(new Set());
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

  // ============================================
  // Centered states (login, waiting, break, no-event)
  // ============================================
  if (!eventId) {
    return (
      <CenteredJudgeState
        kicker="Judging"
        title="Choose an event"
        description="Open the judge flow from the event list on the homepage."
      >
        <Button onClick={() => window.location.assign('/')} className="h-11 w-full rounded-lg">
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
            className="h-11 rounded-lg font-mono text-base tabular-nums"
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
          className="h-11 w-full rounded-lg"
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
          <Button onClick={requestSet} disabled={loading} className="h-11 w-full rounded-lg">
            {loading ? 'Finding teams...' : 'Get next set'}
          </Button>
          <Button onClick={goOnBreak} variant="outline" className="h-11 w-full rounded-lg">
            <Coffee className="size-4" aria-hidden="true" />
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
        <Button onClick={comeBackFromBreak} className="h-11 w-full rounded-lg">
          Resume judging
        </Button>
      </CenteredJudgeState>
    );
  }

  // ============================================
  // Active set: visiting / ranking / review
  // ============================================
  return (
    <div className="editorial-shell px-4 py-6 pb-32">
      <main className="mx-auto w-full max-w-xl space-y-6">
        <ActiveSetHeader
          judgeName={judge?.name}
          phase={phase}
          floor={floor}
          assignedAt={activeSet?.assigned_at || ''}
          visitedOrAbsentCount={visitedOrAbsentCount}
          totalTeams={setTeams.length}
        />

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {phase === 'visiting' && (
          <VisitingPhase
            setTeams={setTeams}
            absentIds={absentIds}
            nextUnhandledId={nextUnhandledId}
            onToggleVisited={(id, value) => setVisited(id, value)}
            onToggleAbsent={toggleAbsent}
          />
        )}

        {phase === 'ranking' && (
          <RankingPhase
            rankOrder={rankOrder}
            absentIds={absentIds}
            teamsById={teamsById}
            setTeams={setTeams}
            onReorder={setRankOrder}
            onMove={moveBy}
            onToggleAbsent={toggleAbsent}
            onResetOrder={resetRankToVisitOrder}
          />
        )}

        {phase === 'review' && (
          <ReviewPhase
            rankOrder={rankOrder}
            absentIds={absentIds}
            teamsById={teamsById}
          />
        )}
      </main>

      <BottomBar
        phase={phase}
        loading={loading}
        allHandled={allHandled}
        visitedOrAbsentCount={visitedOrAbsentCount}
        totalTeams={setTeams.length}
        rankCount={rankOrder.length}
        onContinueToRanking={enterRanking}
        onBackToVisiting={() => setPhase('visiting')}
        onContinueToReview={() => setPhase('review')}
        onBackToRanking={() => setPhase('ranking')}
        onSubmit={submit}
      />
    </div>
  );
}

// ============================================
// Active-set header (shared across visiting / ranking / review)
// ============================================
function ActiveSetHeader({
  judgeName,
  phase,
  floor,
  assignedAt,
  visitedOrAbsentCount,
  totalTeams,
}: {
  judgeName?: string;
  phase: Phase;
  floor?: number;
  assignedAt: string;
  visitedOrAbsentCount: number;
  totalTeams: number;
}) {
  const stepCopy =
    phase === 'visiting'
      ? { label: 'Step 1 of 3', title: 'Visit each team', help: 'Tap each team after you have spoken with them. Mark a team absent if no one is at their table.' }
      : phase === 'ranking'
        ? { label: 'Step 2 of 3', title: 'Rank from best to worst', help: 'Drag, or use the arrows, so the strongest project is at the top. Position is the rank.' }
        : { label: 'Step 3 of 3', title: 'Review and submit', help: 'Double-check the order. Once submitted, this set is locked in.' };

  return (
    <header className="space-y-3">
      <p className="editorial-kicker">{stepCopy.label}</p>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-balance">{stepCopy.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground text-pretty">{stepCopy.help}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {judgeName && <Badge variant="outline">{judgeName}</Badge>}
        {floor !== undefined && (
          <Badge variant="outline" className="gap-1">
            <MapPinned className="size-3.5" aria-hidden="true" />
            Floor {floor}
          </Badge>
        )}
        <Badge variant="outline" className="tabular-nums">
          <ElapsedTimer startTime={assignedAt} />
        </Badge>
        {phase === 'visiting' && (
          <Badge variant="outline" className="tabular-nums">
            {visitedOrAbsentCount}/{totalTeams} done
          </Badge>
        )}
      </div>
    </header>
  );
}

// ============================================
// Visiting phase
// ============================================
function VisitingPhase({
  setTeams,
  absentIds,
  nextUnhandledId,
  onToggleVisited,
  onToggleAbsent,
}: {
  setTeams: SetTeamWithDetails[];
  absentIds: Set<string>;
  nextUnhandledId?: string;
  onToggleVisited: (teamId: string, value: boolean) => void;
  onToggleAbsent: (teamId: string) => void;
}) {
  return (
    <ol className="space-y-3">
      {setTeams.map(st => {
        const isAbsent = absentIds.has(st.team_id);
        const isVisited = st.is_visited;
        const isNext = st.team_id === nextUnhandledId;

        return (
          <li
            key={st.id}
            className={[
              'rounded-xl border p-4 transition-colors',
              isAbsent
                ? 'border-border/40 bg-muted/30'
                : isVisited
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : isNext
                    ? 'border-foreground/40 bg-background ring-1 ring-foreground/15'
                    : 'border-border/60 bg-background',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums">
                    {st.visit_order}
                  </span>
                  <h2 className="min-w-0 text-base font-medium tracking-[-0.01em]">
                    {st.team?.project_name || 'Untitled'}
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Room {st.team?.room?.name} · Table #{st.team?.team_number}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                {isAbsent && <Badge variant="outline">Absent</Badge>}
                {isVisited && !isAbsent && (
                  <Badge className="bg-emerald-100 text-emerald-900">Visited</Badge>
                )}
                {isNext && !isAbsent && !isVisited && <Badge variant="outline">Up next</Badge>}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant={isVisited && !isAbsent ? 'secondary' : 'default'}
                onClick={() => onToggleVisited(st.team_id, !isVisited)}
                disabled={isAbsent}
                className="h-11 rounded-lg"
                aria-pressed={isVisited && !isAbsent}
              >
                {isVisited && !isAbsent ? 'Visited' : 'Mark visited'}
              </Button>
              <Button
                variant="outline"
                onClick={() => onToggleAbsent(st.team_id)}
                aria-pressed={isAbsent}
                className="h-11 rounded-lg"
              >
                {isAbsent ? 'Mark present' : 'Mark absent'}
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ============================================
// Ranking phase
// ============================================
function RankingPhase({
  rankOrder,
  absentIds,
  teamsById,
  setTeams,
  onReorder,
  onMove,
  onToggleAbsent,
  onResetOrder,
}: {
  rankOrder: string[];
  absentIds: Set<string>;
  teamsById: Map<string, SetTeamWithDetails>;
  setTeams: SetTeamWithDetails[];
  onReorder: (next: string[]) => void;
  onMove: (teamId: string, delta: number) => void;
  onToggleAbsent: (teamId: string) => void;
  onResetOrder: () => void;
}) {
  const absentTeams = setTeams.filter(st => absentIds.has(st.team_id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Best at top
        </p>
        <Button variant="ghost" size="sm" onClick={onResetOrder} className="h-8 rounded-md text-xs">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Reset order
        </Button>
      </div>

      <Reorder.Group
        axis="y"
        values={rankOrder}
        onReorder={onReorder}
        as="ol"
        className="space-y-2"
      >
        {rankOrder.map((teamId, idx) => {
          const st = teamsById.get(teamId);
          if (!st) return null;
          return (
            <RankItem
              key={teamId}
              teamId={teamId}
              setTeam={st}
              rank={idx + 1}
              total={rankOrder.length}
              isFirst={idx === 0}
              isLast={idx === rankOrder.length - 1}
              onMoveUp={() => onMove(teamId, -1)}
              onMoveDown={() => onMove(teamId, 1)}
              onMarkAbsent={() => onToggleAbsent(teamId)}
            />
          );
        })}
      </Reorder.Group>

      {absentTeams.length > 0 && (
        <section className="space-y-3 rounded-xl border border-dashed border-border/60 bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Absent ({absentTeams.length})</h3>
            <p className="text-xs text-muted-foreground">Not included in the ranking.</p>
          </div>
          <ul className="space-y-1.5">
            {absentTeams.map(st => (
              <li
                key={st.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {st.team?.project_name || 'Untitled'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Room {st.team?.room?.name} · Table #{st.team?.team_number}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleAbsent(st.team_id)}
                  className="h-8 shrink-0 rounded-md text-xs"
                >
                  Mark present
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RankItem({
  teamId,
  setTeam,
  rank,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onMarkAbsent,
}: {
  teamId: string;
  setTeam: SetTeamWithDetails;
  rank: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMarkAbsent: () => void;
}) {
  // Buttons inside a draggable item must stop pointerdown from bubbling so
  // tapping them doesn't initiate a drag gesture.
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <Reorder.Item
      value={teamId}
      className="touch-none cursor-grab rounded-xl border border-border/60 bg-background select-none active:cursor-grabbing"
      whileDrag={{ scale: 1.02, boxShadow: '0 14px 30px -16px rgba(0,0,0,0.25)', zIndex: 10 }}
    >
      <div className="flex items-stretch gap-1 p-2 sm:p-3">
        <div
          aria-hidden="true"
          className="flex w-9 shrink-0 items-center justify-center text-muted-foreground"
        >
          <GripVertical className="size-5" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex w-8 shrink-0 items-center justify-center">
            <span className="text-base font-semibold leading-none tabular-nums">{rank}</span>
          </div>

          <div className="min-w-0 space-y-0.5">
            <h3 className="text-sm font-medium leading-snug truncate">
              {setTeam.team?.project_name || 'Untitled'}
            </h3>
            <p className="text-xs text-muted-foreground truncate">
              Room {setTeam.team?.room?.name} · Table #{setTeam.team?.team_number}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <Button
            variant="outline"
            size="icon"
            onPointerDown={stopDrag}
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label={`Move ${setTeam.team?.project_name || 'team'} up`}
            className="size-9 rounded-md"
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onPointerDown={stopDrag}
            onClick={onMoveDown}
            disabled={isLast}
            aria-label={`Move ${setTeam.team?.project_name || 'team'} down`}
            className="size-9 rounded-md"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-end border-t border-border/40 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onPointerDown={stopDrag}
          onClick={onMarkAbsent}
          className="h-8 rounded-md text-xs text-muted-foreground"
        >
          Mark absent
        </Button>
      </div>
    </Reorder.Item>
  );
}

// ============================================
// Review phase
// ============================================
function ReviewPhase({
  rankOrder,
  absentIds,
  teamsById,
}: {
  rankOrder: string[];
  absentIds: Set<string>;
  teamsById: Map<string, SetTeamWithDetails>;
}) {
  const absentTeams = [...absentIds]
    .map(id => teamsById.get(id))
    .filter((st): st is SetTeamWithDetails => Boolean(st));

  return (
    <div className="space-y-6">
      <ol className="space-y-2">
        {rankOrder.map((teamId, idx) => {
          const st = teamsById.get(teamId);
          if (!st) return null;
          const rank = idx + 1;
          return (
            <li
              key={teamId}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-background p-3"
            >
              <div className="flex w-8 shrink-0 items-center justify-center">
                <span className="text-base font-semibold tabular-nums">{rank}</span>
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium truncate">
                  {st.team?.project_name || 'Untitled'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  Room {st.team?.room?.name} · Table #{st.team?.team_number}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {absentTeams.length > 0 && (
        <section className="space-y-2 rounded-xl border border-dashed border-border/60 bg-muted/20 p-4">
          <h3 className="text-sm font-medium">Marked absent</h3>
          <ul className="space-y-1">
            {absentTeams.map(st => (
              <li key={st.id} className="text-sm text-muted-foreground">
                {st.team?.project_name || 'Untitled'} · Room {st.team?.room?.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        <CheckCircle2 className="mr-1 inline size-3.5 align-text-bottom" aria-hidden="true" />
        Submitting locks this set in. You can&rsquo;t edit ranks afterwards.
      </p>
    </div>
  );
}

// ============================================
// Sticky bottom bar
// ============================================
function BottomBar({
  phase,
  loading,
  allHandled,
  visitedOrAbsentCount,
  totalTeams,
  rankCount,
  onContinueToRanking,
  onBackToVisiting,
  onContinueToReview,
  onBackToRanking,
  onSubmit,
}: {
  phase: Phase;
  loading: boolean;
  allHandled: boolean;
  visitedOrAbsentCount: number;
  totalTeams: number;
  rankCount: number;
  onContinueToRanking: () => void;
  onBackToVisiting: () => void;
  onContinueToReview: () => void;
  onBackToRanking: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/96 px-4 py-3 backdrop-blur">
      <div
        className="mx-auto flex w-full max-w-xl flex-col gap-2 sm:flex-row"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0px)' }}
      >
        {phase === 'visiting' && (
          <Button
            onClick={onContinueToRanking}
            disabled={!allHandled}
            className="h-11 w-full rounded-lg sm:flex-1"
          >
            {allHandled
              ? 'Continue to ranking'
              : `Visit all teams first (${visitedOrAbsentCount}/${totalTeams})`}
          </Button>
        )}

        {phase === 'ranking' && (
          <>
            <Button
              variant="outline"
              onClick={onBackToVisiting}
              className="h-11 w-full rounded-lg sm:flex-1"
            >
              <ArrowUp className="size-4 rotate-[-45deg]" aria-hidden="true" />
              Back to visits
            </Button>
            <Button
              onClick={onContinueToReview}
              disabled={rankCount === 0}
              className="h-11 w-full rounded-lg sm:flex-[2]"
            >
              {rankCount === 0 ? 'No present teams to rank' : 'Review and submit'}
              <ArrowDown className="size-4 rotate-[-135deg]" aria-hidden="true" />
            </Button>
          </>
        )}

        {phase === 'review' && (
          <>
            <Button
              variant="outline"
              onClick={onBackToRanking}
              className="h-11 w-full rounded-lg sm:flex-1"
            >
              Back to ranking
            </Button>
            <Button
              onClick={onSubmit}
              disabled={loading}
              className="h-11 w-full rounded-lg sm:flex-[2]"
            >
              {loading ? 'Submitting...' : 'Confirm and submit'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================
// Reusable shells
// ============================================
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
