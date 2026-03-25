'use client';

import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="space-y-6">
      <Card className="border-amber-200 bg-amber-50/40 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-balance">Judging results</h1>
              <CardDescription className="text-pretty">
                Teams are sorted by average score on a 1 to 5 scale, where 5 is the strongest result.
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="rounded-full border border-border/60 bg-muted/40 px-3 py-1">{results.length} teams</span>
              <span className="rounded-full border border-border/60 bg-muted/40 px-3 py-1">
                Average {averageScore !== null ? averageScore.toFixed(1) : 'N/A'} / 5
              </span>
              <span className="rounded-full border border-border/60 bg-muted/40 px-3 py-1">
                Best {bestScore !== null ? bestScore.toFixed(1) : 'N/A'} / 5
              </span>
            </div>
          </div>

          <Button onClick={exportCSV}>Export CSV</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-4">
            <p className="text-2xl font-semibold">{results.length}</p>
            <p className="text-sm text-muted-foreground">Ranked teams</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/45 shadow-sm">
          <CardContent className="p-4">
            <p className="text-2xl font-semibold text-amber-900">{averageScore !== null ? averageScore.toFixed(1) : 'N/A'}</p>
            <p className="text-sm text-muted-foreground">Average score / 5</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-300 bg-yellow-50/60 shadow-sm">
          <CardContent className="p-4">
            <p className="text-2xl font-semibold text-yellow-800">{bestScore !== null ? bestScore.toFixed(1) : 'N/A'}</p>
            <p className="text-sm text-muted-foreground">Best score / 5</p>
          </CardContent>
        </Card>
      </div>

      {results.length >= 3 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {results.slice(0, 3).map((team, idx) => {
            const score = team.score;
            const accentClass =
              idx === 0
                ? 'border-yellow-300 bg-yellow-50/70'
                : idx === 1
                  ? 'border-slate-300 bg-slate-50/80'
                  : 'border-orange-200 bg-orange-50/70';
            const scoreClass =
              idx === 0
                ? 'bg-yellow-100 text-yellow-900'
                : idx === 1
                  ? 'bg-slate-100 text-slate-800'
                  : 'bg-orange-100 text-orange-900';
            return (
              <Card key={team.id} className={`shadow-sm ${accentClass}`}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="border-current/15 bg-white/70">
                      #{idx + 1}
                    </Badge>
                    <Badge variant="secondary" className={scoreClass}>
                      {score !== null ? `${score.toFixed(1)} / 5` : 'N/A'}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{team.name}</CardTitle>
                    {team.project_name && <CardDescription>{team.project_name}</CardDescription>}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span>{team.times_judged} judgings</span>
                  <span>Room {team.room_name}</span>
                  <span>Floor {team.floor}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-16 text-center">Rank</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead className="text-center">Judgings</TableHead>
                <TableHead className="text-center">Scores</TableHead>
                <TableHead>Room</TableHead>
                <TableHead className="text-center">Floor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((team, idx) => {
                const score = team.score;
                return (
                  <TableRow key={team.id}>
                    <TableCell className="text-center">
                      <span className={`inline-flex size-7 items-center justify-center rounded-full text-sm font-medium ${
                        idx === 0
                          ? 'bg-yellow-500 text-white'
                          : idx === 1
                            ? 'bg-slate-500 text-white'
                            : idx === 2
                              ? 'bg-orange-500 text-white'
                              : 'bg-muted text-foreground'
                      }`}>
                        {idx + 1}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{team.name}</TableCell>
                    <TableCell className="text-muted-foreground">{team.project_name || '—'}</TableCell>
                    <TableCell className="text-center">
                      {score !== null ? (
                        <Badge
                          variant={idx < 3 ? 'default' : 'secondary'}
                          className={
                            idx === 0
                              ? 'bg-yellow-500 text-white'
                              : idx === 1
                                ? 'bg-slate-500 text-white'
                                : idx === 2
                                  ? 'bg-orange-500 text-white'
                                  : ''
                          }
                        >
                          {score.toFixed(1)} / 5
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{team.times_judged}</TableCell>
                    <TableCell className="text-center">{team.num_rankings}</TableCell>
                    <TableCell>{team.room_name}</TableCell>
                    <TableCell className="text-center">{team.floor}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
