import { supabase } from './supabase';

// ============================================
// Event Log
// ============================================
// One helper. Writes a row to the `event_log` table AND emits a JSON line
// to stdout so even when the DB write fails we still have a record in the
// host's log stream (Vercel, local terminal, etc).
//
// Designed to be called fire-and-forget from API route handlers and shared
// lib code. It NEVER throws — a logging failure must not break the request.

export type LogActor = string | null | undefined;

export interface LogInput {
  event_id?: string | null;
  actor?: LogActor;
  action: string;
  message?: string;
  details?: unknown;
}

const SENSITIVE_KEYS = new Set([
  'admin_code',
  'access_code',
  'password',
  'site_password',
  'SITE_PASSWORD',
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

export async function logEvent(input: LogInput): Promise<void> {
  const row = {
    event_id: input.event_id ?? null,
    actor: input.actor ?? null,
    action: input.action,
    message: input.message ?? null,
    details: (sanitize(input.details) as object | null) ?? null,
  };

  // Safety net: structured stdout line (cheap, durable in host log drains).
  try {
    console.log(`[event_log] ${JSON.stringify({ ts: new Date().toISOString(), ...row })}`);
  } catch {
    // ignore JSON stringify cycles etc.
  }

  try {
    await supabase.from('event_log').insert(row);
  } catch (e) {
    console.error('[event_log] insert failed', e);
  }
}

// ============================================
// Actor helpers
// ============================================
// Identity is not session-bound in this app — judges and organizers send
// their IDs in request bodies. These helpers turn whatever we have into a
// short, human-readable label suitable for the `actor` column.

export async function actorFromJudgeId(judgeId: string | null | undefined): Promise<string> {
  if (!judgeId) return 'anonymous';
  try {
    const { data } = await supabase
      .from('judges')
      .select('access_code, name')
      .eq('id', judgeId)
      .single();
    if (data?.access_code) return data.access_code;
    if (data?.name) return data.name;
  } catch {
    // fall through
  }
  return `judge:${judgeId.slice(0, 8)}`;
}

export function actorOrganizer(): string {
  return 'organizer';
}

export function actorSystem(): string {
  return 'system';
}

// ============================================
// Error normalizer
// ============================================
// Pull the useful bits out of a thrown value or a Supabase error response
// without dragging the whole object (which often has cycles or huge payloads).

export function describeError(e: unknown): Record<string, unknown> {
  if (e == null) return { message: 'unknown error' };
  if (typeof e === 'string') return { message: e };
  if (e instanceof Error) {
    return {
      message: e.message,
      name: e.name,
      stack: e.stack?.split('\n').slice(0, 8).join('\n'),
    };
  }
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    return {
      message: o.message ?? 'unknown error',
      code: o.code,
      hint: o.hint,
      details: o.details,
    };
  }
  return { message: String(e) };
}
