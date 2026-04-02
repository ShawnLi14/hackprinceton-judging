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
    <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Link href="/" className="text-sm font-semibold tracking-[-0.01em] text-foreground">
              Judging
            </Link>
            <p className="text-base font-semibold tracking-[-0.02em] text-balance">
              {currentEvent?.name || 'Organizer'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {events.length > 1 && (
            <select
              aria-label="Switch event"
              className="h-10 min-w-[220px] rounded-lg border border-input bg-background px-4 text-sm text-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
              value={eventId}
              onChange={(e) => switchEvent(e.target.value)}
            >
              {events.map(evt => (
                <option key={evt.id} value={evt.id}>{evt.name}</option>
              ))}
            </select>
          )}
          {events.length === 1 && currentEvent && (
            <span className="hidden max-w-[240px] truncate text-sm text-muted-foreground sm:inline">
              {currentEvent.name}
            </span>
          )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 text-sm">
            {links.map(link => (
              <Link
                key={link.path}
                href={link.href}
                className={`rounded-lg px-3 py-2 font-medium transition-colors ${
                  pathname === link.path
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
                aria-current={pathname === link.path ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
        </div>
      </div>
    </nav>
  );
}

export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="editorial-shell">
      <Suspense>
        <OrganizerNav />
      </Suspense>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
