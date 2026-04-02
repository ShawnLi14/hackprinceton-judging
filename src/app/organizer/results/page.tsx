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
  name: string;
  project_name: string | null;
  team_number: string;
  room_name: string;
  floor: number;
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
    const header = 'Rank,Team,Project,Average Score (/5),Times Judged,Score Entries,Room,Floor,Team #\n';
    const rows = results.map((result, idx) =>
      `${idx + 1},"${result.name}","${result.project_name || ''}",${result.score !== null ? result.score.toFixed(1) : 'N/A'},${result.times_judged},${result.num_rankings},"${result.room_name}",${result.floor},${result.team_number}`
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

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="space-y-1">
              <h1 className="text-base font-semibold text-balance">Judging results</h1>
              <p className="text-sm text-muted-foreground text-pretty">
                Teams are sorted by average score on a 1 to 5 scale, where 5 is the strongest result.
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
            <TableHead className="text-xs font-medium text-muted-foreground">Team</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Project</TableHead>
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Score</TableHead>
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Judgings</TableHead>
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Entries</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Room</TableHead>
            <TableHead className="text-center text-xs font-medium text-muted-foreground">Floor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((team, idx) => {
            const score = team.score;

            return (
              <TableRow key={team.id}>
                <TableCell className="text-center">
                  <span className={`inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-1 text-xs font-medium ${
                    idx === 0
                      ? 'bg-yellow-100 text-yellow-900'
                      : idx === 1
                        ? 'bg-slate-100 text-slate-800'
                        : idx === 2
                          ? 'bg-orange-100 text-orange-900'
                          : 'bg-muted/60 text-foreground'
                  }`}>
                    {idx + 1}
                  </span>
                </TableCell>
                <TableCell className="text-sm font-medium">{team.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{team.project_name || '—'}</TableCell>
                <TableCell className="text-center">
                  {score !== null ? (
                    <Badge
                      variant="secondary"
                      className={
                        idx === 0
                          ? 'bg-yellow-100 text-yellow-900'
                          : idx === 1
                            ? 'bg-slate-100 text-slate-800'
                            : idx === 2
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
              </TableRow>
            );
          })}
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
