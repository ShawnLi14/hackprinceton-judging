'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  const [newTeam, setNewTeam] = useState({ name: '', project_name: '', table_number: '', room_name: '' });
  const [newJudge, setNewJudge] = useState({ name: '', access_code: '' });
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

  const addTeam = async () => {
    if (!newTeam.name.trim() || !newTeam.table_number || !newTeam.room_name || !eventId) return;
    const room_id = resolveRoomId(newTeam.room_name);
    if (!room_id) return;
    await fetch('/api/organizer/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        name: newTeam.name,
        project_name: newTeam.project_name || null,
        table_number: newTeam.table_number,
        room_id,
      }),
    });
    setNewTeam({ name: '', project_name: '', table_number: '', room_name: '' });
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
      let name: string, project_name: string | null, table_number: string, roomName: string;
      if (parts.length === 3) {
        [name, table_number, roomName] = parts;
        project_name = null;
      } else if (parts.length >= 4) {
        [name, project_name, table_number, roomName] = parts;
      } else {
        return null;
      }
      const room_id = resolveRoomId(roomName);
      if (!room_id) {
        errors.push(`Line ${i + 1}: room "${roomName}" not found`);
        return null;
      }
      return { event_id: eventId, name, project_name, table_number, room_id };
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
    await fetch(`/api/organizer/rooms?id=${id}`, { method: 'DELETE' });
    loadData();
  };

  const deleteTeam = async (id: string) => {
    await fetch(`/api/organizer/teams?id=${id}`, { method: 'DELETE' });
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
    return <p>No event selected. <a href="/" className="underline">Go back</a></p>;
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Event Info */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{event?.name || 'Event'} — Setup</h1>
          <p className="text-muted-foreground">
            {teams.length} teams · {judges.length} judges · {rooms.length} rooms
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={event?.status === 'active' ? 'default' : 'secondary'}>
            {event?.status || 'setup'}
          </Badge>
          {event?.status === 'setup' && teams.length > 0 && judges.length > 0 && (
            <Button onClick={startEvent}>Start Judging</Button>
          )}
          {event?.status === 'active' && (
            <Button onClick={() => router.push(`/organizer/dashboard?event=${eventId}`)}>
              Go to Dashboard
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ROOMS */}
        <Card>
          <CardHeader>
            <CardTitle>Rooms</CardTitle>
            <CardDescription>
              Physical locations. Closer room numbers = closer proximity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    placeholder="Room A"
                    value={newRoom.name}
                    onChange={e => setNewRoom(p => ({ ...p, name: e.target.value }))}
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Number</Label>
                  <Input
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
                    type="number"
                    placeholder="1"
                    value={newRoom.floor}
                    onChange={e => setNewRoom(p => ({ ...p, floor: e.target.value }))}
                    className="text-sm"
                  />
                </div>
              </div>
              <Button onClick={addRoom} size="sm" className="w-full">Add Room</Button>
            </div>

            <Separator />

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {rooms.map(room => (
                <div key={room.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{room.name}</span>
                    <span className="text-muted-foreground ml-2">#{room.room_number} · F{room.floor}</span>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => deleteRoom(room.id)}>×</Button>
                </div>
              ))}
              {rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet</p>}
            </div>
          </CardContent>
        </Card>

        {/* TEAMS */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Teams ({teams.length})</CardTitle>
                <CardDescription>Hackathon teams/projects</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowBulkImport(!showBulkImport)}>
                {showBulkImport ? 'Single' : 'Bulk Import'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showBulkImport ? (
              <div className="space-y-2">
                <Label className="text-xs">CSV: name, project, table, room name (one per line)</Label>
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm min-h-[120px] font-mono"
                  placeholder={`Team Alpha, AI Project, T1, ${rooms[0]?.name || 'Room A'}\nTeam Beta, Web App, T2, ${rooms[0]?.name || 'Room A'}`}
                  value={bulkTeams}
                  onChange={e => setBulkTeams(e.target.value)}
                />
                <Button onClick={bulkImportTeams} size="sm" className="w-full">Import Teams</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  placeholder="Team Name"
                  value={newTeam.name}
                  onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="Project Name (optional)"
                  value={newTeam.project_name}
                  onChange={e => setNewTeam(p => ({ ...p, project_name: e.target.value }))}
                  className="text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Table #"
                    value={newTeam.table_number}
                    onChange={e => setNewTeam(p => ({ ...p, table_number: e.target.value }))}
                    className="text-sm"
                  />
                  <Select value={newTeam.room_name} onValueChange={(v) => setNewTeam(p => ({ ...p, room_name: v ?? '' }))}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Room" />
                    </SelectTrigger>
                    <SelectContent>
                      {rooms.map(room => (
                        <SelectItem key={room.id} value={room.name}>{room.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={addTeam} size="sm" className="w-full">Add Team</Button>
              </div>
            )}

            <Separator />

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {teams.map(team => (
                <div key={team.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium truncate block">{team.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {team.room?.name || '?'} · Table {team.table_number}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => deleteTeam(team.id)}>×</Button>
                </div>
              ))}
              {teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet</p>}
            </div>
          </CardContent>
        </Card>

        {/* JUDGES */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Judges ({judges.length})</CardTitle>
                <CardDescription>Each judge gets a unique access code</CardDescription>
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
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm min-h-[120px] font-mono"
                  placeholder={`Alice Johnson, ALICE1\nBob Smith, BOB42\nCharlie Brown`}
                  value={bulkJudges}
                  onChange={e => setBulkJudges(e.target.value)}
                />
                <Button onClick={bulkImportJudges} size="sm" className="w-full">Import Judges</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  placeholder="Judge Name"
                  value={newJudge.name}
                  onChange={e => setNewJudge(p => ({ ...p, name: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="Access Code (auto-generated if empty)"
                  value={newJudge.access_code}
                  onChange={e => setNewJudge(p => ({ ...p, access_code: e.target.value.toUpperCase() }))}
                  className="text-sm font-mono"
                />
                <Button onClick={addJudge} size="sm" className="w-full">Add Judge</Button>
              </div>
            )}

            <Separator />

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {judges.map(j => (
                <div key={j.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{j.name}</span>
                    <Badge variant="outline" className="ml-2 font-mono text-xs">{j.access_code}</Badge>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => deleteJudge(j.id)}>×</Button>
                </div>
              ))}
              {judges.length === 0 && <p className="text-sm text-muted-foreground">No judges yet</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Event Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Event Configuration</CardTitle>
              <CardDescription>
                Admin code: <code className="font-mono bg-muted px-1 rounded">{event?.admin_code}</code>
              </CardDescription>
            </div>
            {event?.status === 'setup' && !editingConfig && (
              <Button size="sm" variant="outline" onClick={startEditingConfig}>Edit</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editingConfig ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Event Name</Label>
                  <Input
                    value={configForm.name}
                    onChange={e => setConfigForm(p => ({ ...p, name: e.target.value }))}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Teams per Set</Label>
                  <Input
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{event?.set_size}</p>
                <p className="text-xs text-muted-foreground">Teams per Set</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{event?.target_judgings_per_team}</p>
                <p className="text-xs text-muted-foreground">Target Judgings/Team</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{event?.max_judging_minutes}m</p>
                <p className="text-xs text-muted-foreground">Max Time per Set</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{Math.ceil((teams.length * (event?.target_judgings_per_team || 3)) / (judges.length * (event?.set_size || 5))) || '?'}</p>
                <p className="text-xs text-muted-foreground">Estimated Rounds</p>
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
