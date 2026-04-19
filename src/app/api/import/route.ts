import { NextRequest, NextResponse } from 'next/server';
import { assignGeneratedJudgeCodes } from '@/lib/judge-codes';
import { supabase } from '@/lib/supabase';
import { actorOrganizer, logEvent } from '@/lib/log';

// POST: bulk import rooms, teams (by room name), and judges from text data
// Body: { event_id, type: 'rooms' | 'teams' | 'judges', data: string }
// Data format (one per line, comma-separated):
//   rooms:  name, room_number, floor
//   teams:  project_name, track, team_number, room_name, devpost_url, prizes  (6 fields)
//       or: project_name, track, team_number, room_name, devpost_url          (5 fields)
//       or: project_name, track, team_number, room_name                       (4 fields, no URL)
//       or: project_name, team_number, room_name                              (3 fields, no track or URL)
//   judges: name, access_code
//
// The `prizes` field (6th) is `|`-separated because prize names often contain
// commas. Empty `prizes` field is allowed (no opt-ins).
export async function POST(req: NextRequest) {
  const { event_id, type, data } = await req.json();

  if (!event_id || !type || !data) {
    return NextResponse.json({ error: 'Missing event_id, type, or data' }, { status: 400 });
  }

  const lines = data
    .split('\n')
    .map((l: string) => l.trim())
    .filter((l: string) => l && !l.startsWith('#')); // skip empty lines and comments

  if (lines.length === 0) {
    return NextResponse.json({ error: 'No data lines found' }, { status: 400 });
  }

  try {
    if (type === 'rooms') {
      const rooms = lines.map((line: string) => {
        const [name, room_number, floor] = line.split(',').map((s: string) => s.trim());
        return {
          event_id,
          name,
          room_number: parseInt(room_number),
          floor: parseInt(floor) || 1,
        };
      });

      const { data: created, error } = await supabase.from('rooms').insert(rooms).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await logEvent({
        event_id,
        actor: actorOrganizer(),
        action: 'import.rooms',
        message: `Imported ${created?.length || 0} room(s)`,
        details: { count: created?.length || 0 },
      });
      return NextResponse.json({ imported: created?.length || 0, items: created });
    }

    if (type === 'teams') {
      // First, look up all rooms for this event
      const { data: rooms } = await supabase
        .from('rooms')
        .select('id, name')
        .eq('event_id', event_id);

      if (!rooms || rooms.length === 0) {
        return NextResponse.json({ error: 'No rooms found. Import rooms first.' }, { status: 400 });
      }

      const roomMap = new Map(rooms.map(r => [r.name.toLowerCase(), r.id]));

      const teams = [];
      const errors: string[] = [];

      let teams_with_prizes = 0;

      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(',').map((s: string) => s.trim());
        if (parts.length < 3) {
          errors.push(`Line ${i + 1}: expected at least 3 fields (project_name, team_number, room_name), got ${parts.length}`);
          continue;
        }

        let project_name: string,
          track: string | null,
          team_number: string,
          room_name: string,
          devpost_url: string | null,
          prizes_str: string;

        if (parts.length === 3) {
          [project_name, team_number, room_name] = parts;
          track = null;
          devpost_url = null;
          prizes_str = '';
        } else if (parts.length === 4) {
          [project_name, track, team_number, room_name] = parts;
          devpost_url = null;
          prizes_str = '';
        } else if (parts.length === 5) {
          [project_name, track, team_number, room_name, devpost_url] = parts;
          prizes_str = '';
        } else {
          [project_name, track, team_number, room_name, devpost_url, prizes_str] = parts;
        }

        const room_id = roomMap.get(room_name.toLowerCase());
        if (!room_id) {
          errors.push(`Line ${i + 1}: room "${room_name}" not found`);
          continue;
        }

        const opt_in_prizes = prizes_str
          ? prizes_str
              .split('|')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
          : [];
        if (opt_in_prizes.length > 0) teams_with_prizes += 1;

        teams.push({
          event_id,
          project_name: project_name || null,
          track: track || null,
          team_number,
          room_id,
          devpost_url: devpost_url ? devpost_url : null,
          opt_in_prizes,
        });
      }

      if (teams.length === 0) {
        return NextResponse.json({ error: 'No valid teams found', details: errors }, { status: 400 });
      }

      const { data: created, error } = await supabase.from('teams').insert(teams).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await logEvent({
        event_id,
        actor: actorOrganizer(),
        action: 'import.teams',
        message: `Imported ${created?.length || 0} team(s)${errors.length ? ` (${errors.length} skipped)` : ''}`,
        details: { count: created?.length || 0, with_prizes_count: teams_with_prizes, errors },
      });
      return NextResponse.json({ imported: created?.length || 0, errors, items: created });
    }

    if (type === 'judges') {
      const parsedJudges = lines.map((line: string) => {
        const parts = line.split(',').map((s: string) => s.trim());
        return {
          event_id,
          name: parts[0],
          access_code: parts[1] || undefined,
        };
      });

      const { data: existingJudges, error: existingError } = await supabase
        .from('judges')
        .select('access_code')
        .eq('event_id', event_id);

      if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });

      const judges = assignGeneratedJudgeCodes(
        parsedJudges,
        (existingJudges || []).map(judge => judge.access_code)
      );

      const { data: created, error } = await supabase.from('judges').insert(judges).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await logEvent({
        event_id,
        actor: actorOrganizer(),
        action: 'import.judges',
        message: `Imported ${created?.length || 0} judge(s)`,
        details: {
          judges: created?.map(j => ({ name: j.name, access_code: j.access_code })),
        },
      });
      return NextResponse.json({ imported: created?.length || 0, items: created });
    }

    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: `Import failed: ${e}` }, { status: 500 });
  }
}
