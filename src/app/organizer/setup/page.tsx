'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Event, Room, Team, Judge } from '@/lib/types';

function SetupPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const eventId = searchParams.get('event');

  const [event, setEvent] = useState<Event | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teams, setTeams] = useState<(Team & { room?: Room })[]>([]);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [newRoom, setNewRoom] = useState({ name: '', room_number: '', floor: '1' });
  const [newTeam, setNewTeam] = useState({ name: '', project_name: '', team_number: '', room_name: '' });
  const [newJudge, setNewJudge] = useState({ name: '', access_code: '' });
  const [bulkRooms, setBulkRooms] = useState('');
  const [showBulkRoomImport, setShowBulkRoomImport] = useState(false);
  const [bulkTeams, setBulkTeams] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkJudges, setBulkJudges] = useState('');
  const [showBulkJudgeImport, setShowBulkJudgeImport] = useState(false);

  // Event config editing
  const [editingConfig, setEditingConfig] = useState(false);
  const [configForm, setConfigForm] = useState({ set_size: '', target_judgings_per_team: '', max_judging_minutes: '', name: '' });
  const [savingConfig, setSavingConfig] = useState(false);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [eventRes, roomsRes, teamsRes, judgesRes] = await Promise.all([
        fetch(`/api/events?id=${eventId}`),
        fetch(`/api/organizer/rooms?event_id=${eventId}`),
        fetch(`/api/organizer/teams?event_id=${eventId}`),
        fetch(`/api/organizer/judges?event_id=${eventId}`),
      ]);
      setEvent(await eventRes.json());
      setRooms(await roomsRes.json());
      setTeams(await teamsRes.json());
      setJudges(await judgesRes.json());
    } catch (e) {
      console.error('Failed to load data:', e);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { loadData(); }, [loadData]);

  const addRoom = async () => {
    if (!newRoom.name.trim() || !newRoom.room_number || !eventId) return;
    await fetch('/api/organizer/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        name: newRoom.name,
        room_number: parseInt(newRoom.room_number),
        floor: parseInt(newRoom.floor) || 1,
      }),
    });
    setNewRoom({ name: '', room_number: '', floor: '1' });
    loadData();
  };

  const bulkImportRooms = async () => {
    if (!bulkRooms.trim() || !eventId) return;
    const lines = bulkRooms.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    const roomsToCreate = lines.map(line => {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        return {
          event_id: eventId,
          name: parts[0],
          room_number: parseInt(parts[1]) || 0,
          floor: parseInt(parts[2]) || 1,
        };
      }
      return null;
    }).filter(Boolean);

    if (roomsToCreate.length === 0) return;

    await fetch('/api/organizer/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roomsToCreate),
    });
    setBulkRooms('');
    setShowBulkRoomImport(false);
    loadData();
  };

  const addTeam = async () => {
    if (!newTeam.name.trim() || !newTeam.team_number || !newTeam.room_name || !eventId) return;
    const room_id = resolveRoomId(newTeam.room_name);
    if (!room_id) return;
    await fetch('/api/organizer/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        name: newTeam.name,
        project_name: newTeam.project_name || null,
        team_number: newTeam.team_number,
        room_id,
      }),
    });
    setNewTeam({ name: '', project_name: '', team_number: '', room_name: '' });
    loadData();
  };

  const resolveRoomId = (roomName: string): string | null => {
    const normalized = roomName.toLowerCase().trim();
    const room = rooms.find(r => r.name.toLowerCase().trim() === normalized);
    return room?.id ?? null;
  };

  const bulkImportTeams = async () => {
    if (!bulkTeams.trim() || !eventId) return;
    const lines = bulkTeams.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    const errors: string[] = [];
    const teamsToCreate = lines.map((line, i) => {
      const parts = line.split(',').map(p => p.trim());
      let name: string, project_name: string | null, team_number: string, roomName: string;
      if (parts.length === 3) {
        [name, team_number, roomName] = parts;
        project_name = null;
      } else if (parts.length >= 4) {
        [name, project_name, team_number, roomName] = parts;
      } else {
        return null;
      }
      const room_id = resolveRoomId(roomName);
      if (!room_id) {
        errors.push(`Line ${i + 1}: room "${roomName}" not found`);
        return null;
      }
      return { event_id: eventId, name, project_name, team_number, room_id };
    }).filter(Boolean);

    if (errors.length > 0) {
      alert(`Some lines have unknown rooms:\n${errors.join('\n')}\n\nMake sure rooms are created first and names match exactly.`);
      return;
    }
    if (teamsToCreate.length === 0) return;

    await fetch('/api/organizer/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(teamsToCreate),
    });
    setBulkTeams('');
    setShowBulkImport(false);
    loadData();
  };

  const addJudge = async () => {
    if (!newJudge.name.trim() || !eventId) return;
    await fetch('/api/organizer/judges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        name: newJudge.name,
        access_code: newJudge.access_code || undefined,
      }),
    });
    setNewJudge({ name: '', access_code: '' });
    loadData();
  };

  const bulkImportJudges = async () => {
    if (!bulkJudges.trim() || !eventId) return;
    const lines = bulkJudges.trim().split('\n').filter(l => l.trim());
    const judgesToCreate = lines.map(line => {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        return { event_id: eventId, name: parts[0], access_code: parts[1] || undefined };
      }
      return { event_id: eventId, name: parts[0] };
    }).filter(j => j.name);

    if (judgesToCreate.length === 0) return;

    await fetch('/api/organizer/judges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(judgesToCreate),
    });
    setBulkJudges('');
    setShowBulkJudgeImport(false);
    loadData();
  };

  const startEditingConfig = () => {
    if (!event) return;
    setConfigForm({
      name: event.name,
      set_size: String(event.set_size),
      target_judgings_per_team: String(event.target_judgings_per_team),
      max_judging_minutes: String(event.max_judging_minutes),
    });
    setEditingConfig(true);
  };

  const saveConfig = async () => {
    if (!eventId) return;
    setSavingConfig(true);
    try {
      const res = await fetch('/api/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: eventId,
          name: configForm.name,
          set_size: parseInt(configForm.set_size) || 5,
          target_judgings_per_team: parseInt(configForm.target_judgings_per_team) || 3,
          max_judging_minutes: parseInt(configForm.max_judging_minutes) || 20,
        }),
      });
      if (res.ok) {
        setEditingConfig(false);
        loadData();
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const deleteRoom = async (id: string) => {
    await fetch(`/api/organizer/rooms?id=${id}&event_id=${eventId}`, { method: 'DELETE' });
    loadData();
  };

  const deleteTeam = async (id: string) => {
    await fetch(`/api/organizer/teams?id=${id}&event_id=${eventId}`, { method: 'DELETE' });
    loadData();
  };

  const deleteJudge = async (id: string) => {
    await fetch(`/api/organizer/judges?id=${id}`, { method: 'DELETE' });
    loadData();
  };

  const startEvent = async () => {
    if (!eventId) return;
    await fetch('/api/organizer/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, action: 'start' }),
    });
    router.push(`/organizer/dashboard?event=${eventId}`);
  };

  if (!eventId) {
    return <p>No event selected. <Link href="/" className="underline">Go back</Link></p>;
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 pb-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="space-y-1">
              <Badge variant={event?.status === 'active' ? 'default' : 'secondary'} className="w-fit">
                {event?.status || 'setup'}
              </Badge>
              <h1 className="text-base font-semibold text-balance">
                {event?.name || 'Event'} setup
              </h1>
              <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
                Add rooms, teams, and judges first. When everything is ready, start judging and move to the live dashboard.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="rounded-lg bg-muted/50 px-3 py-1">{teams.length} teams</span>
              <span className="rounded-lg bg-muted/50 px-3 py-1">{judges.length} judges</span>
              <span className="rounded-lg bg-muted/50 px-3 py-1">{rooms.length} rooms</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          {event?.status === 'setup' && teams.length > 0 && judges.length > 0 && (
            <Button onClick={startEvent}>Start judging</Button>
          )}
          {event?.status === 'active' && (
            <Button onClick={() => router.push(`/organizer/dashboard?event=${eventId}`)}>
              Open dashboard
            </Button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ROOMS */}
        <Card className="pt-0 shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Rooms</CardTitle>
                <CardDescription>Physical locations used to group teams by floor.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowBulkRoomImport(!showBulkRoomImport)}>
                {showBulkRoomImport ? 'Single' : 'Bulk Import'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showBulkRoomImport ? (
              <div className="space-y-2">
                <Label className="text-xs">One per line: name, room number, floor</Label>
                <Textarea
                  aria-label="Bulk room import"
                  className="min-h-[120px] font-mono text-sm"
                  placeholder={`Friend 101, 101, 1\nFriend 201, 201, 2\nSherrerd 301, 301, 3`}
                  value={bulkRooms}
                  onChange={e => setBulkRooms(e.target.value)}
                />
                <Button onClick={bulkImportRooms} size="sm" className="w-full">Import rooms</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input
                      aria-label="Room name"
                      placeholder="Room A"
                      value={newRoom.name}
                      onChange={e => setNewRoom(p => ({ ...p, name: e.target.value }))}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Number</Label>
                    <Input
                      aria-label="Room number"
                      type="number"
                      placeholder="101"
                      value={newRoom.room_number}
                      onChange={e => setNewRoom(p => ({ ...p, room_number: e.target.value }))}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Floor</Label>
                    <Input
                      aria-label="Room floor"
                      type="number"
                      placeholder="1"
                      value={newRoom.floor}
                      onChange={e => setNewRoom(p => ({ ...p, floor: e.target.value }))}
                      className="text-sm"
                    />
                  </div>
                </div>
                <Button onClick={addRoom} size="sm" className="w-full">Add room</Button>
              </div>
            )}

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {rooms.map(room => (
                <div key={room.id} className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{room.name}</span>
                    <span className="text-muted-foreground ml-2">#{room.room_number} · F{room.floor}</span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label={`Delete room ${room.name}`} onClick={() => deleteRoom(room.id)}>×</Button>
                </div>
              ))}
              {rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet.</p>}
            </div>
          </CardContent>
        </Card>

        {/* TEAMS */}
        <Card className="pt-0 shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Teams ({teams.length})</CardTitle>
                <CardDescription>Team names, project names, and room placement.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowBulkImport(!showBulkImport)}>
                {showBulkImport ? 'Single' : 'Bulk Import'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showBulkImport ? (
              <div className="space-y-2">
                <Label className="text-xs">CSV: name, project, team #, room name (one per line)</Label>
                <Textarea
                  aria-label="Bulk team import"
                  className="min-h-[120px] font-mono text-sm"
                  placeholder={`Team Alpha, AI Project, 1, ${rooms[0]?.name || 'Room A'}\nTeam Beta, Web App, 2, ${rooms[0]?.name || 'Room A'}`}
                  value={bulkTeams}
                  onChange={e => setBulkTeams(e.target.value)}
                />
                <Button onClick={bulkImportTeams} size="sm" className="w-full">Import teams</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  aria-label="Team name"
                  placeholder="Team Name"
                  value={newTeam.name}
                  onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  aria-label="Project name"
                  placeholder="Project Name (optional)"
                  value={newTeam.project_name}
                  onChange={e => setNewTeam(p => ({ ...p, project_name: e.target.value }))}
                  className="text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label="Team number"
                    placeholder="Team #"
                    value={newTeam.team_number}
                    onChange={e => setNewTeam(p => ({ ...p, team_number: e.target.value }))}
                    className="text-sm"
                  />
                  <Select value={newTeam.room_name} onValueChange={(v) => setNewTeam(p => ({ ...p, room_name: v ?? '' }))}>
                    <SelectTrigger aria-label="Team room" className="text-sm">
                      <SelectValue placeholder="Room" />
                    </SelectTrigger>
                    <SelectContent>
                      {rooms.map(room => (
                        <SelectItem key={room.id} value={room.name}>{room.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={addTeam} size="sm" className="w-full">Add team</Button>
              </div>
            )}

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {teams.map(team => (
                <div key={team.id} className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium truncate block">{team.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {team.room?.name || '?'} · #{team.team_number}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label={`Delete team ${team.name}`} onClick={() => deleteTeam(team.id)}>×</Button>
                </div>
              ))}
              {teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
            </div>
          </CardContent>
        </Card>

        {/* JUDGES */}
        <Card className="pt-0 shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Judges ({judges.length})</CardTitle>
                <CardDescription>Each judge gets a unique access code.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowBulkJudgeImport(!showBulkJudgeImport)}>
                {showBulkJudgeImport ? 'Single' : 'Bulk Import'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showBulkJudgeImport ? (
              <div className="space-y-2">
                <Label className="text-xs">One per line: name, access_code (code is optional)</Label>
                <Textarea
                  aria-label="Bulk judge import"
                  className="min-h-[120px] font-mono text-sm"
                  placeholder={`Alice Johnson, JUDGE-001\nBob Smith, JUDGE-002\nCharlie Brown`}
                  value={bulkJudges}
                  onChange={e => setBulkJudges(e.target.value)}
                />
                <Button onClick={bulkImportJudges} size="sm" className="w-full">Import judges</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  aria-label="Judge name"
                  placeholder="Judge Name"
                  value={newJudge.name}
                  onChange={e => setNewJudge(p => ({ ...p, name: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  aria-label="Access code"
                  placeholder="Access Code (auto-generated if empty)"
                  value={newJudge.access_code}
                  onChange={e => setNewJudge(p => ({ ...p, access_code: e.target.value.toUpperCase() }))}
                  className="text-sm font-mono"
                />
                <Button onClick={addJudge} size="sm" className="w-full">Add judge</Button>
              </div>
            )}

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {judges.map(j => (
                <div key={j.id} className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{j.name}</span>
                    <Badge variant="outline" className="ml-2 font-mono text-xs">{j.access_code}</Badge>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label={`Delete judge ${j.name}`} onClick={() => deleteJudge(j.id)}>×</Button>
                </div>
              ))}
              {judges.length === 0 && <p className="text-sm text-muted-foreground">No judges yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Event Configuration */}
      <Card className="pt-0 shadow-none">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Event Configuration</CardTitle>
              <CardDescription>Update the event name, pacing, and judging targets before it goes live.</CardDescription>
            </div>
            {event?.status === 'setup' && !editingConfig && (
              <Button size="sm" variant="outline" onClick={startEditingConfig}>Edit</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {editingConfig ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Event Name</Label>
                  <Input
                    aria-label="Event name"
                    value={configForm.name}
                    onChange={e => setConfigForm(p => ({ ...p, name: e.target.value }))}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Teams per Set</Label>
                  <Input
                    aria-label="Teams per set"
                    type="number"
                    min={1}
                    max={20}
                    value={configForm.set_size}
                    onChange={e => setConfigForm(p => ({ ...p, set_size: e.target.value }))}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Target Judgings per Team</Label>
                  <Input
                    aria-label="Target judgings per team"
                    type="number"
                    min={1}
                    max={20}
                    value={configForm.target_judgings_per_team}
                    onChange={e => setConfigForm(p => ({ ...p, target_judgings_per_team: e.target.value }))}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max Minutes per Set</Label>
                  <Input
                    aria-label="Max judging minutes per set"
                    type="number"
                    min={1}
                    max={120}
                    value={configForm.max_judging_minutes}
                    onChange={e => setConfigForm(p => ({ ...p, max_judging_minutes: e.target.value }))}
                    className="text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setEditingConfig(false)}>Cancel</Button>
                <Button size="sm" onClick={saveConfig} disabled={savingConfig}>
                  {savingConfig ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-base font-semibold">{event?.set_size}</p>
                <p className="text-xs text-muted-foreground">Teams per Set</p>
              </div>
              <div>
                <p className="text-base font-semibold">{event?.target_judgings_per_team}</p>
                <p className="text-xs text-muted-foreground">Target Judgings/Team</p>
              </div>
              <div>
                <p className="text-base font-semibold">{event?.max_judging_minutes}m</p>
                <p className="text-xs text-muted-foreground">Max Time per Set</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-muted-foreground">Loading...</div>}>
      <SetupPageContent />
    </Suspense>
  );
}
