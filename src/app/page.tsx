'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import BlockWordmark from '@/components/BlockWordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Event } from '@/lib/types';

export default function Home() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(() => {
    fetch('/api/events')
      .then(async (r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const deleteEvent = async (id: string) => {
    if (!confirm('Delete this event and ALL its data (teams, judges, sets)? This cannot be undone.')) return;
    await fetch(`/api/events?id=${id}`, { method: 'DELETE' });
    loadEvents();
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <header className="flex justify-center">
        <BlockWordmark text="JUDGING" className="max-w-[420px]" />
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px] lg:items-start">
        <section className="space-y-6">
          <h1 className="text-base font-semibold tracking-[-0.02em] text-balance">Current events</h1>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading events...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="space-y-4">
              {events.map(event => (
                <article
                  key={event.id}
                  className="flex flex-col gap-3 rounded-md bg-card px-4 py-4 shadow-soft lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="space-y-2">
                    <h2 className="text-base font-medium tracking-[-0.01em] text-balance">{event.name}</h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span>{event.set_size} teams per set</span>
                      <span>{event.target_judgings_per_team} target judgings</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                    <Button
                      className="h-11 min-w-[180px] justify-between rounded-md pl-5 pr-4"
                      data-icon="inline-end"
                      onClick={() => router.push(`/judge?event=${event.id}`)}
                    >
                      Join as judge
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 min-w-[180px] justify-between rounded-md pl-5 pr-4"
                      data-icon="inline-end"
                      onClick={() => router.push(`/organizer/setup?event=${event.id}`)}
                    >
                      Join as organizer
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-10 justify-start rounded-md px-3 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteEvent(event.id)}
                    >
                      Delete event
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <h1 className="text-base font-semibold tracking-[-0.02em] text-balance">Create event</h1>
          <div className="rounded-md bg-card px-4 py-4 shadow-soft">
            <CreateEventForm onCreated={loadEvents} />
          </div>
        </section>
      </div>
    </main>
  );
}

function CreateEventForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setName('');
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={handleCreate}>
      <div className="space-y-2">
        <Label htmlFor="event-name" className="text-sm font-medium">
          Event name
        </Label>
        <Input
          id="event-name"
          placeholder="HackPrinceton Spring 2026"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="off"
          className="h-12 rounded-md border-input/80 bg-background px-4 shadow-none"
        />
      </div>

      <Button
        type="submit"
        disabled={creating || !name.trim()}
        className="h-12 w-full justify-between rounded-md pl-5 pr-4"
        data-icon="inline-end"
      >
        {creating ? 'Creating...' : 'Create event'}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </form>
  );
}
