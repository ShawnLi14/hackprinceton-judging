'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface TeamResult {
  id: string;
  name: string;
  project_name: string | null;
  table_number: string;
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

  const exportCSV = () => {
    const header = 'Rank,Team,Project,Score,Times Judged,Num Rankings,Room,Floor,Table\n';
    const rows = results.map((r, idx) =>
      `${idx + 1},"${r.name}","${r.project_name || ''}",${r.score?.toFixed(1) || 'N/A'},${r.times_judged},${r.num_rankings},"${r.room_name}",${r.floor},${r.table_number}`
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
    return <p>No event selected. <a href="/" className="underline">Go back</a></p>;
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Judging Results</h1>
          <p className="text-muted-foreground">{results.length} teams ranked</p>
        </div>
        <Button onClick={exportCSV}>Export CSV</Button>
      </div>

      {/* Top 3 */}
      {results.length >= 3 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {results.slice(0, 3).map((team, idx) => (
            <Card key={team.id} className={`${
              idx === 0 ? 'border-yellow-400 bg-yellow-50/50 ring-2 ring-yellow-200' :
              idx === 1 ? 'border-gray-300 bg-gray-50/50' :
              'border-amber-700/30 bg-amber-50/30'
            }`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <span className={`text-3xl font-bold ${
                    idx === 0 ? 'text-yellow-500' :
                    idx === 1 ? 'text-gray-400' : 'text-amber-700'
                  }`}>
                    #{idx + 1}
                  </span>
                  <Badge variant="outline">{team.score?.toFixed(1) || 'N/A'} pts</Badge>
                </div>
                <CardTitle className="text-lg">{team.name}</CardTitle>
                {team.project_name && (
                  <p className="text-sm text-muted-foreground">{team.project_name}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{team.times_judged} judgings</span>
                  <span>{team.room_name}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Full rankings table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-center p-3 font-medium w-16">Rank</th>
                  <th className="text-left p-3 font-medium">Team</th>
                  <th className="text-left p-3 font-medium">Project</th>
                  <th className="text-center p-3 font-medium">Score</th>
                  <th className="text-center p-3 font-medium">Times Judged</th>
                  <th className="text-center p-3 font-medium"># Rankings</th>
                  <th className="text-left p-3 font-medium">Room</th>
                  <th className="text-center p-3 font-medium">Floor</th>
                </tr>
              </thead>
              <tbody>
                {results.map((team, idx) => (
                  <tr key={team.id} className={`border-b ${idx < 3 ? 'font-medium' : ''}`}>
                    <td className="p-3 text-center">
                      {idx < 3 ? (
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold ${
                          idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                          idx === 1 ? 'bg-gray-100 text-gray-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {idx + 1}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{idx + 1}</span>
                      )}
                    </td>
                    <td className="p-3">{team.name}</td>
                    <td className="p-3 text-muted-foreground">{team.project_name || '—'}</td>
                    <td className="p-3 text-center">
                      {team.score !== null ? (
                        <Badge variant={idx < 3 ? 'default' : 'secondary'}>
                          {team.score.toFixed(1)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </td>
                    <td className="p-3 text-center">{team.times_judged}</td>
                    <td className="p-3 text-center">{team.num_rankings}</td>
                    <td className="p-3">{team.room_name}</td>
                    <td className="p-3 text-center">{team.floor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Loading...</div>}>
      <ResultsContent />
    </Suspense>
  );
}
