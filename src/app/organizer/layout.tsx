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
      .then(r => r.json())
      .then(data => setEvents(Array.isArray(data) ? data : []));
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
    <nav className="border-b bg-white/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-4">
        <Link href="/" className="font-bold text-lg tracking-tight shrink-0">
          HackPrinceton
        </Link>

        {/* Event switcher */}
        {events.length > 1 && (
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm max-w-[180px] truncate"
            value={eventId}
            onChange={(e) => switchEvent(e.target.value)}
          >
            {events.map(evt => (
              <option key={evt.id} value={evt.id}>{evt.name}</option>
            ))}
          </select>
        )}
        {events.length === 1 && currentEvent && (
          <span className="text-sm text-muted-foreground truncate">{currentEvent.name}</span>
        )}

        <div className="flex gap-1 ml-auto">
          {links.map(link => (
            <Link
              key={link.path}
              href={link.href}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                pathname === link.path
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
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
    <div className="min-h-screen bg-slate-50">
      <Suspense>
        <OrganizerNav />
      </Suspense>
      <main className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
