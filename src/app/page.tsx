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
  const [sitePassword, setSitePassword] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(false);

  const requirePassword = (): string | null => {
    if (passwordVerified) return sitePassword;
    const pw = prompt('Enter site password:');
    if (!pw) return null;
    setSitePassword(pw);
    setPasswordVerified(true);
    return pw;
  };

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
    const pw = requirePassword();
    if (!pw) return;
    if (!confirm('Delete this event and ALL its data (teams, judges, sets)? This cannot be undone.')) return;
    const res = await fetch(`/api/events?id=${id}&password=${encodeURIComponent(pw)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Delete failed');
      setPasswordVerified(false);
      return;
    }
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
                      onClick={() => {
                        const pw = requirePassword();
                        if (!pw) return;
                        router.push(`/organizer/setup?event=${event.id}`);
                      }}
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
            <CreateEventForm
              requirePassword={requirePassword}
              onCreated={loadEvents}
              onAuthError={() => setPasswordVerified(false)}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function CreateEventForm({ onCreated, requirePassword, onAuthError }: {
  onCreated: () => void;
  requirePassword: () => string | null;
  onAuthError: () => void;
}) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    const pw = requirePassword();
    if (!pw) return;
    setCreating(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password: pw }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Create failed');
        onAuthError();
        return;
      }
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
