'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { Event } from '@/lib/types';

export default function Home() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadEvents = useCallback(() => {
    fetch('/api/events')
      .then(r => r.json())
      .then(data => {
        const evts = Array.isArray(data) ? data : [];
        setEvents(evts);
        if (evts.length > 0 && !evts.find(e => e.id === selectedEvent)) {
          setSelectedEvent(evts[0].id);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedEvent]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const deleteEvent = async (id: string) => {
    if (!confirm('Delete this event and ALL its data (teams, judges, sets)? This cannot be undone.')) return;
    await fetch(`/api/events?id=${id}`, { method: 'DELETE' });
    if (selectedEvent === id) setSelectedEvent('');
    loadEvents();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="animate-pulse text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const selected = events.find(e => e.id === selectedEvent);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">HackPrinceton</h1>
          <p className="text-lg text-muted-foreground">Judging System</p>
        </div>

        {events.length === 0 && !showCreate ? (
          <Card>
            <CardHeader>
              <CardTitle>No Events Yet</CardTitle>
              <CardDescription>
                Create your first event to get started.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateEventForm onCreated={(evt) => {
                setEvents([evt]);
                setSelectedEvent(evt.id);
              }} />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Event selector with delete */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Event</CardTitle>
                  <Button size="sm" variant="outline" onClick={() => setShowCreate(!showCreate)}>
                    {showCreate ? 'Cancel' : '+ New Event'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {showCreate && (
                  <div className="border rounded-lg p-3 bg-muted/30">
                    <CreateEventForm onCreated={(evt) => {
                      setEvents(prev => [evt, ...prev]);
                      setSelectedEvent(evt.id);
                      setShowCreate(false);
                    }} />
                  </div>
                )}

                {events.map(evt => (
                  <div
                    key={evt.id}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedEvent === evt.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'hover:border-muted-foreground/30'
                    }`}
                    onClick={() => setSelectedEvent(evt.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{evt.name}</span>
                      <Badge variant={
                        evt.status === 'active' ? 'default' :
                        evt.status === 'completed' ? 'secondary' : 'outline'
                      } className="text-xs shrink-0">
                        {evt.status}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive h-7 px-2 shrink-0"
                      onClick={(e) => { e.stopPropagation(); deleteEvent(evt.id); }}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Role selection */}
            {selected && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card
                  className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                  onClick={() => router.push(`/judge?event=${selectedEvent}`)}
                >
                  <CardHeader className="text-center pb-2">
                    <div className="text-4xl mb-2">⚖️</div>
                    <CardTitle>I&apos;m a Judge</CardTitle>
                    <CardDescription>
                      Log in with your access code to start judging teams
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button className="w-full" variant="default">
                      Enter as Judge
                    </Button>
                  </CardContent>
                </Card>

                <Card
                  className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                  onClick={() => router.push(`/organizer/setup?event=${selectedEvent}`)}
                >
                  <CardHeader className="text-center pb-2">
                    <div className="text-4xl mb-2">📋</div>
                    <CardTitle>I&apos;m an Organizer</CardTitle>
                    <CardDescription>
                      Manage the event, monitor judges, and view results
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button className="w-full" variant="outline">
                      Enter as Organizer
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CreateEventForm({ onCreated }: { onCreated: (evt: Event) => void }) {
  const [name, setName] = useState('');
  const [adminCode, setAdminCode] = useState('ADMIN');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, admin_code: adminCode }),
    });
    const data = await res.json();
    if (data.id) onCreated(data);
    setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Event Name</Label>
        <Input
          placeholder="HackPrinceton Spring 2026"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Admin Code</Label>
        <Input
          placeholder="ADMIN"
          value={adminCode}
          onChange={e => setAdminCode(e.target.value)}
        />
      </div>
      <Button onClick={handleCreate} disabled={creating || !name.trim()} className="w-full">
        {creating ? 'Creating...' : 'Create Event'}
      </Button>
    </div>
  );
}
