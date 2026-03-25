'use client';

import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { Event } from '@/lib/types';

function OrganizerNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const eventId = searchParams.get('event') || '';

  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    fetch('/api/events')
      .then(async (r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]));
  }, []);

  const currentEvent = events.find(e => e.id === eventId);

  const switchEvent = (newEventId: string) => {
    router.push(`${pathname}?event=${newEventId}`);
  };

  const links = [
    { href: `/organizer/setup?event=${eventId}`, label: 'Setup', path: '/organizer/setup' },
    { href: `/organizer/dashboard?event=${eventId}`, label: 'Live Dashboard', path: '/organizer/dashboard' },
    { href: `/organizer/results?event=${eventId}`, label: 'Results', path: '/organizer/results' },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link
          href="/"
          className="font-pixel shrink-0 text-sm font-semibold text-foreground"
        >
          HackPrinceton
        </Link>

        <div className="hidden min-[960px]:block text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Organizer console
        </div>

        <div className="ml-auto flex items-center gap-3">
          {events.length > 1 && (
            <select
              aria-label="Switch event"
              className="h-8 max-w-[200px] rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
              value={eventId}
              onChange={(e) => switchEvent(e.target.value)}
            >
              {events.map(evt => (
                <option key={evt.id} value={evt.id}>{evt.name}</option>
              ))}
            </select>
          )}
          {events.length === 1 && currentEvent && (
            <span className="hidden max-w-[220px] truncate text-sm text-muted-foreground sm:inline">
              {currentEvent.name}
            </span>
          )}

          <div className="flex gap-1">
            {links.map(link => (
              <Link
                key={link.path}
                href={link.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  pathname === link.path
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                aria-current={pathname === link.path ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-foreground">
      <Suspense>
        <OrganizerNav />
      </Suspense>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
