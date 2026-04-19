'use client';

import Link from 'next/link';
import { useEffect, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Sentinel "all tracks" filter value. Used as both state value and chip key.
const ALL_TRACKS = '__all__';
const NO_TRACK = '__none__';
// Sentinel "all prizes" filter value. A team has many prizes (vs. one track),
// so the filter matches against array containment.
const ALL_PRIZES = '__all__';

interface TeamResult {
  id: string;
  project_name: string | null;
  track: string | null;
  team_number: string;
  room_name: string;
  floor: number;
  devpost_url: string | null;
  opt_in_prizes: string[];
  times_judged: number;
  num_rankings: number;
  first_place_count: number;
  average_normalized_rank: number | null;
  score: number | null;
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');
  const [results, setResults] = useState<TeamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackFilter, setTrackFilter] = useState<string>(ALL_TRACKS);
  const [prizeFilter, setPrizeFilter] = useState<string>(ALL_PRIZES);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/organizer/results?event_id=${eventId}`)
      .then(r => r.json())
      .then(data => setResults(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [eventId]);

  // Distinct tracks that appear in this event, sorted alphabetically. We
  // surface a "No track" chip only if at least one team has a null/empty
  // track, so the filter UI doesn't lie about what's filterable.
  const trackOptions = useMemo(() => {
    const named = new Set<string>();
    let hasUntracked = false;
    for (const r of results) {
      if (r.track) named.add(r.track);
      else hasUntracked = true;
    }
    const sorted = Array.from(named).sort((a, b) => a.localeCompare(b));
    return { tracks: sorted, hasUntracked };
  }, [results]);

  // Distinct opt-in prize values across all teams, with the count of teams
  // that opted into each prize. A single team can contribute to multiple
  // prizes. Sorted alphabetically.
  const prizeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) {
      const seen = new Set<string>();
      for (const p of r.opt_in_prizes || []) {
        if (!p || seen.has(p)) continue;
        seen.add(p);
        counts.set(p, (counts.get(p) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([prize, count]) => ({ prize, count }));
  }, [results]);

  // Apply the selected track + prize filter and re-sort by score (desc) since
  // the server's ordering is "track asc, score desc" and we no longer group
  // by track in the UI. Tiebreakers mirror the API: 1st-place count, then
  // num_rankings (confidence), then project name.
  const filteredResults = useMemo(() => {
    const filtered = results.filter(r => {
      if (trackFilter === ALL_TRACKS) {
        // pass
      } else if (trackFilter === NO_TRACK) {
        if (r.track) return false;
      } else if (r.track !== trackFilter) {
        return false;
      }
      if (prizeFilter !== ALL_PRIZES) {
        if (!(r.opt_in_prizes || []).includes(prizeFilter)) return false;
      }
      return true;
    });
    return filtered.slice().sort((a, b) => {
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
      if (a.score !== null && b.score !== null && a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.first_place_count !== b.first_place_count) {
        return b.first_place_count - a.first_place_count;
      }
      if (a.num_rankings !== b.num_rankings) return b.num_rankings - a.num_rankings;
      return (a.project_name || '').localeCompare(b.project_name || '');
    });
  }, [results, trackFilter, prizeFilter]);

  const judgedTeams = filteredResults.filter(result => result.score !== null);
  const averageScore = judgedTeams.length
    ? judgedTeams.reduce((sum, result) => sum + (result.score ?? 0), 0) / judgedTeams.length
    : null;
  const bestScore = judgedTeams.length ? Math.max(...judgedTeams.map(result => result.score ?? 0)) : null;

  const trackPart =
    trackFilter === ALL_TRACKS
      ? 'all tracks'
      : trackFilter === NO_TRACK
        ? 'projects with no track'
        : `track "${trackFilter}"`;
  const prizePart = prizeFilter === ALL_PRIZES ? '' : `, prize "${prizeFilter}"`;
  const trackLabel = `${trackPart}${prizePart}`;

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

  const exportCSV = () => {
    // Quote any field that may contain commas/quotes/newlines. Inner quotes
    // are doubled per RFC 4180. Prize names sometimes contain commas.
    const escape = (val: string | number) => {
      const s = String(val);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = 'Rank,Project,Track,Opt-In Prizes,Devpost URL,Relative Score (/5),1st-Place Finishes,Judgings,Room,Floor,Team #\n';
    const rows = filteredResults.map((result, idx) =>
      [
        idx + 1,
        escape(result.project_name || 'Untitled'),
        escape(result.track || ''),
        escape((result.opt_in_prizes || []).join('|')),
        escape(result.devpost_url || ''),
        result.score !== null ? result.score.toFixed(1) : 'N/A',
        result.first_place_count,
        result.num_rankings,
        escape(result.room_name),
        result.floor,
        escape(result.team_number),
      ].join(',')
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const trackSuffix =
      trackFilter === ALL_TRACKS
        ? 'all'
        : trackFilter === NO_TRACK
          ? 'no-track'
          : slugify(trackFilter);
    const prizeSuffix = prizeFilter === ALL_PRIZES ? '' : `--prize-${slugify(prizeFilter)}`;
    a.download = `judging-results-${trackSuffix}${prizeSuffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download the per-(set, team) raw export from the API. The browser
  // streams the file directly via the Content-Disposition header.
  const exportRawSets = (format: 'csv' | 'json') => {
    if (!eventId) return;
    const url = `/api/organizer/results/raw?event_id=${eventId}&format=${format}&include=completed`;
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.click();
  };

  if (!eventId) {
    return <p>No event selected. <Link href="/" className="underline">Go back</Link></p>;
  }

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
  }

  const showTrackColumn = trackFilter === ALL_TRACKS && (trackOptions.tracks.length > 0 || trackOptions.hasUntracked);
  const hasAnyTrackChips = trackOptions.tracks.length > 0 || trackOptions.hasUntracked;
  const hasAnyPrizeChips = prizeOptions.length > 0;
  // Hide the column when filtering to one prize (it would be a constant value).
  const showPrizesColumn = hasAnyPrizeChips && prizeFilter === ALL_PRIZES;
  const totalCount = results.length;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="space-y-1">
              <h1 className="text-base font-semibold text-balance">Judging results</h1>
              <p className="text-sm text-muted-foreground text-pretty">
                Every project, ranked by relative score on a 0 to 5 scale derived from judges&rsquo; rankings — 5 means always ranked first within a set, 0 means always last. Ties are broken by the number of 1st-place finishes. Filter by track or opt-in prize to score a single category.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="rounded-lg bg-muted/50 px-3 py-1">
                {filteredResults.length} {filteredResults.length === 1 ? 'project' : 'projects'}
                {trackFilter !== ALL_TRACKS && ` of ${totalCount}`}
              </span>
              <span className="rounded-lg bg-muted/50 px-3 py-1">
                Average {averageScore !== null ? averageScore.toFixed(1) : 'N/A'} / 5
              </span>
              <span className="rounded-lg bg-muted/50 px-3 py-1">
                Best {bestScore !== null ? bestScore.toFixed(1) : 'N/A'} / 5
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-self-end">
          <Button size="sm" onClick={exportCSV} title={`Export the ${trackLabel} list`}>
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportRawSets('csv')}
            title="One row per (set, team) with rank, presence and computed normalized score — the source data behind the table above."
          >
            Export raw sets (CSV)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => exportRawSets('json')}
            title="Same data as the raw CSV but nested as JSON."
          >
            JSON
          </Button>
        </div>
      </section>

      {hasAnyTrackChips && (
        <section className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Filter by track
          </p>
          <div className="flex flex-wrap gap-2">
            <TrackChip
              active={trackFilter === ALL_TRACKS}
              onClick={() => setTrackFilter(ALL_TRACKS)}
              count={totalCount}
            >
              All tracks
            </TrackChip>
            {trackOptions.tracks.map(track => {
              const count = results.filter(r => r.track === track).length;
              return (
                <TrackChip
                  key={track}
                  active={trackFilter === track}
                  onClick={() => setTrackFilter(track)}
                  count={count}
                >
                  {track}
                </TrackChip>
              );
            })}
            {trackOptions.hasUntracked && (
              <TrackChip
                active={trackFilter === NO_TRACK}
                onClick={() => setTrackFilter(NO_TRACK)}
                count={results.filter(r => !r.track).length}
              >
                No track
              </TrackChip>
            )}
          </div>
        </section>
      )}

      {hasAnyPrizeChips && (
        <section className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Filter by opt-in prize
          </p>
          <div className="flex flex-wrap gap-2">
            <TrackChip
              active={prizeFilter === ALL_PRIZES}
              onClick={() => setPrizeFilter(ALL_PRIZES)}
              count={totalCount}
            >
              All prizes
            </TrackChip>
            {prizeOptions.map(({ prize, count }) => (
              <TrackChip
                key={prize}
                active={prizeFilter === prize}
                onClick={() => setPrizeFilter(prize)}
                count={count}
              >
                {prize}
              </TrackChip>
            ))}
          </div>
        </section>
      )}

      {filteredResults.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">
          No projects match this filter.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-center text-xs font-medium text-muted-foreground">Rank</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Project</TableHead>
              {showTrackColumn && (
                <TableHead className="text-xs font-medium text-muted-foreground">Track</TableHead>
              )}
              {showPrizesColumn && (
                <TableHead className="text-xs font-medium text-muted-foreground">
                  Opt-in prizes
                </TableHead>
              )}
              <TableHead className="text-center text-xs font-medium text-muted-foreground">Relative score</TableHead>
              <TableHead
                className="text-center text-xs font-medium text-muted-foreground"
                title="Number of completed sets in which this team was ranked #1. Used to break ties on relative score."
              >
                1st-place
              </TableHead>
              <TableHead
                className="text-center text-xs font-medium text-muted-foreground"
                title="Number of completed sets in which this team received a (non-absent) rank."
              >
                Judgings
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Room</TableHead>
              <TableHead className="text-center text-xs font-medium text-muted-foreground">Floor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredResults.map((team, idx) => {
              const rank = idx + 1;
              const score = team.score;
              const rankTone =
                rank === 1
                  ? 'bg-yellow-100 text-yellow-900'
                  : rank === 2
                    ? 'bg-slate-100 text-slate-800'
                    : rank === 3
                      ? 'bg-orange-100 text-orange-900'
                      : 'bg-muted/60 text-foreground';
              const scoreTone =
                rank === 1
                  ? 'bg-yellow-100 text-yellow-900'
                  : rank === 2
                    ? 'bg-slate-100 text-slate-800'
                    : rank === 3
                      ? 'bg-orange-100 text-orange-900'
                      : 'bg-sky-100 text-sky-800';

              return (
                <TableRow key={team.id}>
                  <TableCell className="text-center">
                    <span className={`inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-1 text-xs font-medium ${rankTone}`}>
                      {rank}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {team.devpost_url ? (
                      <a
                        href={team.devpost_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-sky-700"
                      >
                        {team.project_name || 'Untitled'}
                      </a>
                    ) : (
                      team.project_name || 'Untitled'
                    )}
                  </TableCell>
                  {showTrackColumn && (
                    <TableCell className="text-sm">
                      {team.track ? (
                        <button
                          type="button"
                          onClick={() => setTrackFilter(team.track as string)}
                          className="cursor-pointer"
                          title={`Filter by ${team.track}`}
                        >
                          <Badge variant="outline" className="hover:bg-muted/60">
                            {team.track}
                          </Badge>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTrackFilter(NO_TRACK)}
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                          title="Filter to projects with no track"
                        >
                          —
                        </button>
                      )}
                    </TableCell>
                  )}
                  {showPrizesColumn && (
                    <TableCell className="text-sm">
                      {team.opt_in_prizes && team.opt_in_prizes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {team.opt_in_prizes.map(prize => (
                            <button
                              key={prize}
                              type="button"
                              onClick={() => setPrizeFilter(prize)}
                              className="cursor-pointer"
                              title={`Filter by ${prize}`}
                            >
                              <Badge
                                variant="secondary"
                                className="bg-violet-100 text-violet-900 hover:bg-violet-200"
                              >
                                {prize}
                              </Badge>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    {score !== null ? (
                      <Badge variant="secondary" className={scoreTone}>
                        {score.toFixed(1)} / 5
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {team.first_place_count > 0 ? (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-900 tabular-nums"
                        title={`Ranked #1 in ${team.first_place_count} of ${team.num_rankings} completed set${team.num_rankings === 1 ? '' : 's'}`}
                      >
                        × {team.first_place_count}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground tabular-nums">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{team.num_rankings}</TableCell>
                  <TableCell className="text-sm">{team.room_name}</TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{team.floor}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function TrackChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-foreground hover:bg-muted/60')
      }
    >
      <span>{children}</span>
      <span className={'tabular-nums text-xs ' + (active ? 'text-background/70' : 'text-muted-foreground')}>
        {count}
      </span>
    </button>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading...</div>}>
      <ResultsContent />
    </Suspense>
  );
}
