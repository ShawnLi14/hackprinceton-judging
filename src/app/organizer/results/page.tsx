'use client';

import Link from 'next/link';
import { useEffect, Suspense, useState } from 'react';
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

interface TeamResult {
  id: string;
  project_name: string | null;
  track: string | null;
  team_number: string;
  room_name: string;
  floor: number;
  devpost_url: string | null;
  times_judged: number;
  num_rankings: number;
  average_normalized_rank: number | null;
  score: number | null;
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');
  const [results, setResults] = useState<TeamResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/organizer/results?event_id=${eventId}`)
      .then(r => r.json())
      .then(data => setResults(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [eventId]);

  const judgedTeams = results.filter(result => result.score !== null);
  const averageScore = judgedTeams.length
    ? judgedTeams.reduce((sum, result) => sum + (result.score ?? 0), 0) / judgedTeams.length
    : null;
  const bestScore = judgedTeams.length ? Math.max(...judgedTeams.map(result => result.score ?? 0)) : null;

  const exportCSV = () => {
    const header = 'Rank,Project,Track,Devpost URL,Relative Score (/5),Times Judged,Rank Entries,Room,Floor,Team #\n';
    const rows = results.map((result, idx) =>
      `${idx + 1},"${result.project_name || 'Untitled'}","${result.track || ''}","${result.devpost_url || ''}",${result.score !== null ? result.score.toFixed(1) : 'N/A'},${result.times_judged},${result.num_rankings},"${result.room_name}",${result.floor},${result.team_number}`
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'judging-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!eventId) {
    return <p>No event selected. <Link href="/" className="underline">Go back</Link></p>;
  }

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
  }

  const hasTracks = results.some(r => r.track);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="space-y-1">
              <h1 className="text-base font-semibold text-balance">Judging results</h1>
              <p className="text-sm text-muted-foreground text-pretty">
                Teams are sorted by {hasTracks ? 'track, then by ' : ''}relative score on a 0 to 5 scale derived from judges&rsquo; rankings — 5 means always ranked first within a set, 0 means always last.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="rounded-lg bg-muted/50 px-3 py-1">{results.length} teams</span>
              <span className="rounded-lg bg-muted/50 px-3 py-1">
                Average {averageScore !== null ? averageScore.toFixed(1) : 'N/A'} / 5
              </span>
              <span className="rounded-lg bg-muted/50 px-3 py-1">
                Best {bestScore !== null ? bestScore.toFixed(1) : 'N/A'} / 5
              </span>
            </div>
          </div>
        </div>

        <div className="sm:justify-self-end">
          <Button size="sm" onClick={exportCSV}>Export CSV</Button>
        </div>
      </section>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16 text-center text-xs font-medium text-muted-foreground">Rank</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Project</TableHead>
            {hasTracks && <TableHead className="text-xs font-medium text-muted-foreground">Track</TableHead>}
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Relative score</TableHead>
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Judgings</TableHead>
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Ranks</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Room</TableHead>
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Floor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(() => {
            let lastTrack: string | null | undefined;
            let rankInTrack = 0;
            return results.map((team) => {
              const score = team.score;
              const showTrackHeader = hasTracks && team.track !== lastTrack;
              if (showTrackHeader) rankInTrack = 0;
              lastTrack = team.track;
              rankInTrack++;
              const colSpan = hasTracks ? 8 : 7;

              return (
                <>{showTrackHeader && (
                  <TableRow key={`track-${team.track || 'none'}`} className="bg-muted/60 border-t-2">
                    <TableCell colSpan={colSpan} className="py-2 font-semibold text-sm">
                      {team.track || 'No Track'}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow key={team.id}>
                  <TableCell className="text-center">
                    <span className={`inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-1 text-xs font-medium ${
                      rankInTrack === 1
                        ? 'bg-yellow-100 text-yellow-900'
                        : rankInTrack === 2
                          ? 'bg-slate-100 text-slate-800'
                          : rankInTrack === 3
                            ? 'bg-orange-100 text-orange-900'
                            : 'bg-muted/60 text-foreground'
                    }`}>
                      {rankInTrack}
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
                  {hasTracks && (
                    <TableCell className="text-sm">
                      {team.track ? <Badge variant="outline">{team.track}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    {score !== null ? (
                      <Badge
                        variant="secondary"
                        className={
                          rankInTrack === 1
                            ? 'bg-yellow-100 text-yellow-900'
                            : rankInTrack === 2
                              ? 'bg-slate-100 text-slate-800'
                              : rankInTrack === 3
                                ? 'bg-orange-100 text-orange-900'
                                : 'bg-sky-100 text-sky-800'
                        }
                      >
                        {score.toFixed(1)} / 5
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{team.times_judged}</TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{team.num_rankings}</TableCell>
                  <TableCell className="text-sm">{team.room_name}</TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{team.floor}</TableCell>
                </TableRow></>
              );
            });
          })()}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading...</div>}>
      <ResultsContent />
    </Suspense>
  );
}
