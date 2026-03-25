'use client';

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
      .then(async r => {
        if (!r.ok) return [];
        return r.json();
      })
      .then(data => {
        const evts = Array.isArray(data) ? data : [];
        setEvents(evts);
        if (evts.length > 0 && !evts.find(e => e.id === selectedEvent)) {
          setSelectedEvent(evts[0].id);
        }
      })
      .catch(() => setEvents([]))
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
      <div className="app-shell flex items-center justify-center px-4">
        <div className="surface px-5 py-4 text-sm text-muted-foreground">Loading judging app...</div>
      </div>
    );
  }

  const selected = events.find(e => e.id === selectedEvent);
  const statusLabel = selected
    ? selected.status.charAt(0).toUpperCase() + selected.status.slice(1)
    : 'No event selected';

  return (
    <div className="app-shell">
      <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="font-pixel text-xs text-muted-foreground">HackPrinceton Judging</p>
            <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
              Pick an event, then jump in as a judge or organizer.
            </h1>
            <p className="max-w-2xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
              Everything here is intentionally simple: select the event you want, then use the shortest path into the judging flow.
            </p>
          </div>
          <div className="surface px-4 py-3">
            <p className="font-pixel text-xs text-muted-foreground">Events</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{events.length}</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="surface p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-balance">Events</h2>
                <p className="text-sm text-muted-foreground">Select one event to continue.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(v => !v)}>
                {showCreate ? 'Close' : 'New event'}
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {events.length === 0 && !showCreate ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-5">
                  <h3 className="text-base font-medium">No events yet</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Create your first event to start assigning judges and tracking results.
                  </p>
                  <Button className="mt-4" onClick={() => setShowCreate(true)}>
                    Create event
                  </Button>
                </div>
              ) : null}

              {showCreate && (
                <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                  <CreateEventForm
                    onCreated={(evt) => {
                      setEvents(prev => [evt, ...prev]);
                      setSelectedEvent(evt.id);
                      setShowCreate(false);
                    }}
                  />
                </div>
              )}

              <div className="space-y-2">
                {events.map(evt => {
                  const isSelected = selectedEvent === evt.id;
                  return (
                    <div
                      key={evt.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                        isSelected ? 'border-foreground/20 bg-muted/40' : 'border-border/70 bg-background hover:bg-muted/20'
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedEvent(evt.id)}
                        aria-pressed={isSelected}
                        aria-label={`Select event ${evt.name}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{evt.name}</span>
                          <Badge
                            variant={
                              evt.status === 'active'
                                ? 'default'
                                : evt.status === 'completed'
                                  ? 'secondary'
                                  : 'outline'
                            }
                            className="text-xs"
                          >
                            {evt.status}
                          </Badge>
                        </div>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        type="button"
                        aria-label={`Delete event ${evt.name}`}
                        onClick={() => deleteEvent(evt.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="surface p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-balance">Next step</h2>
                  <p className="text-sm text-muted-foreground">{statusLabel}</p>
                </div>
                {selected && (
                  <Badge variant="outline" className="shrink-0">
                    Selected
                  </Badge>
                )}
              </div>

              {selected ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current event</p>
                    <p className="mt-2 text-xl font-semibold text-balance">{selected.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Use the judge flow for scoring. Use the organizer flow to manage rooms, teams, and results.
                    </p>
                  </div>

                  <Button className="w-full justify-start" type="button" onClick={() => router.push(`/judge?event=${selectedEvent}`)}>
                    Enter as judge
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    type="button"
                    onClick={() => router.push(`/organizer/setup?event=${selectedEvent}`)}
                  >
                    Enter as organizer
                  </Button>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 p-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Choose an event on the left to unlock the judge and organizer entry points.
                  </p>
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function CreateEventForm({ onCreated }: { onCreated: (evt: Event) => void }) {
  const [name, setName] = useState('');
  const [adminCode, setAdminCode] = useState('ADMIN');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, admin_code: adminCode }),
      });
      const data = await res.json();
      if (data.id) onCreated(data);
    } finally {
      setCreating(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleCreate}>
      <div className="space-y-2">
        <Label htmlFor="event-name">Event name</Label>
        <Input
          id="event-name"
          placeholder="HackPrinceton Spring 2026"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-code">Admin code</Label>
        <Input
          id="admin-code"
          placeholder="ADMIN"
          value={adminCode}
          onChange={e => setAdminCode(e.target.value)}
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={creating || !name.trim()} className="w-full">
        {creating ? 'Creating...' : 'Create event'}
      </Button>
    </form>
  );
}
