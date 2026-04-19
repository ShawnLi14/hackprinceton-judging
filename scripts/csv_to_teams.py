#!/usr/bin/env python3
"""Convert a Devpost-style submissions CSV into a teams.txt file the judging
app's bulk importer understands.

Output line format (one team per line, comma-separated):

    project_name, track, table_number, room_name, devpost_url, prize1|prize2|...

The 6th field (opt-in prizes) is `|`-separated because prize names often
contain commas (the outer separator).

Devpost exports one CSV row per (submission, opt-in prize) pair, so a
submission opted into N prizes appears as N rows. This script collapses
duplicate rows by submission key and aggregates the distinct `Opt-In Prize`
values into the 6th field.

Submission key (used to dedup):
    `Submission Url` if present, else `Project Title + Submitter Email`.
URL alone collides on drafts (no URL); title alone collides on many
"Untitled" drafts; the email disambiguates the draft case.

Behavior:
    - Skips rows whose `Project Status` is "Draft" (case/whitespace-insensitive).
    - Empty `Project Title` is allowed and emitted as "Untitled".
    - When `Submitter First Name` / `Submitter Last Name` are present, the
      submitter is appended to the project name in parentheses — e.g.
      "Recall (Jossue Sarango)" — so judges/organizers can disambiguate
      multiple submissions sharing a generic title (very common with
      "Untitled" drafts that slip past the draft filter).
    - Empty / missing track is emitted as "Unspecified".
    - `table_number` and `room_name` are placeholders (TBD) unless a room-
      capacity file is supplied via --rooms (default: scripts/room_caps.txt
      if it exists). When rooms are assigned, all kept submissions are
      shuffled (Fisher-Yates via random.shuffle) and then walked into the
      rooms in spec order, with table numbers running 1..N within each room.
    - `Submission Url` (case-insensitive lookup) is emitted as the 5th field.
    - `Opt-In Prize` values are sanitized (commas -> spaces) and joined with
      `|` in the 6th field. Submissions with no opt-ins emit an empty 6th
      field, which the importer tolerates.
    - Commas inside any field are replaced with a space so the importer's
      naive `split(',')` parser still works.

Usage:
    python scripts/csv_to_teams.py <input.csv> [output.txt] [options]

Common options:
    --rooms PATH       Room-capacity spec (default: scripts/room_caps.txt
                       if present; pass --no-rooms to force TBD placeholders).
    --no-rooms         Skip room assignment even if room_caps.txt exists.
    --seed N           Reproducible shuffle (default: fresh random each run).
    --overflow         If there are more teams than total room capacity,
                       dump the extras into the LAST room rather than aborting.
    --assignments-csv  Where to write the (Project Name, Table Number, Room)
                       companion CSV (default: <output stem>_assignments.csv
                       next to the main output, only when rooms are assigned).
    --no-assignments-csv  Skip the companion CSV.

If output.txt is omitted, output is written to scripts/teams.txt.
"""

from __future__ import annotations

import argparse
import csv
import random
import re
import sys
from pathlib import Path

PROJECT_COLUMN = "Project Title"
STATUS_COLUMN = "Project Status"
TRACK_COLUMN = "What Main Hack Princeton Track Are You Submitted For?"
PRIZE_COLUMN = "Opt-In Prize"
SUBMITTER_EMAIL_COLUMN = "Submitter Email"
SUBMITTER_FIRST_COLUMN = "Submitter First Name"
SUBMITTER_LAST_COLUMN = "Submitter Last Name"
URL_COLUMN_CANDIDATES = ("Submission Url", "Submission URL", "Submission url")

DEFAULT_PROJECT = "Untitled"
DEFAULT_TRACK = "Unspecified"
PLACEHOLDER_TABLE = "TBD"
PLACEHOLDER_ROOM = "TBD"

DEFAULT_ROOMS_PATH = Path(__file__).resolve().parent / "room_caps.txt"

HEADER = "# Project Name, Track, Table Number, Room Name, Devpost URL, Prize1|Prize2|..."


def sanitize(value: str | None) -> str:
    """Strip, collapse whitespace, and replace commas (the importer is comma-split)."""
    if value is None:
        return ""
    cleaned = value.replace(",", " ").replace("\r", " ").replace("\n", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def sanitize_prize(value: str | None) -> str:
    """Sanitize a prize name and also strip the `|` we use as inner delimiter."""
    cleaned = sanitize(value)
    if "|" in cleaned:
        cleaned = re.sub(r"\s*\|\s*", " ", cleaned).strip()
    return cleaned


def find_url_column(fieldnames: list[str]) -> str | None:
    """Find the submission URL column case-insensitively, returning the
    actual key from the CSV header (or None if no candidate matches)."""
    lowered = {name.lower(): name for name in fieldnames}
    for candidate in URL_COLUMN_CANDIDATES:
        actual = lowered.get(candidate.lower())
        if actual:
            return actual
    return None


# ---------------------------------------------------------------------------
# Room assignment helpers (also re-used by scripts/assign_rooms.py).
# ---------------------------------------------------------------------------


def load_room_caps(path: Path) -> list[tuple[str, int]]:
    """Read [(room_name, capacity), ...] in spec order from a caps file.

    Format: one room per line, `Room Name, Count`. Comments (`#`) and blank
    lines are ignored. Aborts the process on any malformed line.
    """
    if not path.exists():
        print(f"error: rooms file not found: {path}", file=sys.stderr)
        sys.exit(1)

    rooms: list[tuple[str, int]] = []
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "," not in line:
            print(
                f"error: {path}:{line_no}: expected `Room Name, Count`, got: {raw!r}",
                file=sys.stderr,
            )
            sys.exit(1)
        name_part, count_part = line.rsplit(",", 1)
        name = name_part.strip()
        try:
            count = int(count_part.strip())
        except ValueError:
            print(
                f"error: {path}:{line_no}: capacity is not an integer: {count_part!r}",
                file=sys.stderr,
            )
            sys.exit(1)
        if count < 0:
            print(
                f"error: {path}:{line_no}: capacity must be >= 0, got {count}",
                file=sys.stderr,
            )
            sys.exit(1)
        rooms.append((name, count))

    if not rooms:
        print(f"error: rooms file {path} contains no rooms", file=sys.stderr)
        sys.exit(1)

    return rooms


def assign_rooms_to_lines(
    team_lines: list[str],
    rooms: list[tuple[str, int]],
    *,
    seed: int | None = None,
    overflow: bool = False,
) -> tuple[list[str], list[tuple[str, int]]]:
    """Shuffle `team_lines` and stamp the 3rd (table) and 4th (room) fields.

    Returns (assigned_lines, summary) where summary is [(room_name, n_teams)]
    in spec order.

    Aborts (sys.exit) if there are more teams than total capacity and
    `overflow` is False.
    """
    rng = random.Random(seed)
    shuffled = list(team_lines)
    rng.shuffle(shuffled)

    total_capacity = sum(count for _, count in rooms)
    if len(shuffled) > total_capacity and not overflow:
        print(
            f"error: {len(shuffled)} teams but rooms only have capacity for "
            f"{total_capacity}. Either expand the rooms file or pass --overflow "
            f"to dump the extras into '{rooms[-1][0]}'.",
            file=sys.stderr,
        )
        sys.exit(1)

    assigned: list[str] = []
    summary: list[tuple[str, int]] = []
    cursor = 0
    last_idx = len(rooms) - 1
    for idx, (room_name, cap) in enumerate(rooms):
        is_last = idx == last_idx
        take = (len(shuffled) - cursor) if (is_last and overflow) else cap
        chunk = shuffled[cursor : cursor + take]
        cursor += len(chunk)
        for table_no, line in enumerate(chunk, start=1):
            assigned.append(_rewrite_room_fields(line, room_name, table_no))
        summary.append((room_name, len(chunk)))
        if cursor >= len(shuffled):
            for remaining_idx in range(idx + 1, len(rooms)):
                summary.append((rooms[remaining_idx][0], 0))
            break
    return assigned, summary


def _rewrite_room_fields(line: str, room: str, table: int) -> str:
    """Replace the 3rd (table) and 4th (room) comma-separated fields of a
    teams.txt line, leaving everything else intact."""
    parts = line.split(",")
    if len(parts) < 4:
        print(
            f"error: team line has fewer than 4 fields, can't assign room: {line!r}",
            file=sys.stderr,
        )
        sys.exit(1)
    parts[2] = f" {table}"
    parts[3] = f" {room}"
    return ",".join(parts)


def write_assignments_csv(team_lines: list[str], path: Path) -> int:
    """Write a small companion CSV with just (Project Name, Table Number, Room).

    Used to share the "where do I set up?" assignment with teams without
    leaking Devpost URLs / prize opt-ins. Rows are sorted by room (in the
    order rooms first appear in `team_lines`, which is the spec order from
    room_caps.txt) and then by table number ascending.

    Skips any row whose table or room is the literal placeholder "TBD"
    (i.e. teams that didn't fit into the rooms file with --overflow off).

    Returns the number of rows written.
    """
    rows: list[tuple[int, int, str, int, str]] = []  # (room_order, table, name, idx, raw_line)
    room_order: dict[str, int] = {}
    for line in team_lines:
        parts = line.split(",")
        if len(parts) < 4:
            continue
        name = parts[0].strip()
        table_str = parts[2].strip()
        room = parts[3].strip()
        if not room or room == PLACEHOLDER_ROOM or table_str == PLACEHOLDER_TABLE:
            continue
        try:
            table = int(table_str)
        except ValueError:
            continue
        order_idx = room_order.setdefault(room, len(room_order))
        rows.append((order_idx, table, name, len(rows), line))

    rows.sort(key=lambda r: (r[0], r[1]))

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Project Name", "Table Number", "Room"])
        for _, table, name, _, raw_line in rows:
            parts = raw_line.split(",")
            room = parts[3].strip()
            writer.writerow([name, table, room])

    return len(rows)


def print_room_assignment_summary(
    summary: list[tuple[str, int]],
    *,
    seed: int | None,
    output_path: Path,
) -> None:
    used_rooms = sum(1 for _, n in summary if n > 0)
    total_teams = sum(n for _, n in summary)
    seed_label = seed if seed is not None else "random"
    print(
        f"Assigned {total_teams} team(s) across {used_rooms} room(s) "
        f"(seed={seed_label}) -> {output_path}",
        file=sys.stderr,
    )
    for room_name, n in summary:
        marker = "  " if n > 0 else "  (empty) "
        print(f"{marker}{room_name}: {n}", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="Path to the Devpost CSV export.")
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parent / "teams.txt",
        help="Destination .txt file (default: scripts/teams.txt).",
    )
    parser.add_argument(
        "--rooms",
        type=Path,
        default=None,
        help=(
            "Room-capacity file (one `Room Name, Count` per line). "
            f"Defaults to {DEFAULT_ROOMS_PATH} if it exists; otherwise leaves "
            "table/room as TBD placeholders."
        ),
    )
    parser.add_argument(
        "--no-rooms",
        action="store_true",
        help="Skip room assignment even if a default room_caps.txt exists.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for the team shuffle (default: fresh random each run).",
    )
    parser.add_argument(
        "--overflow",
        action="store_true",
        help=(
            "If there are more teams than total room capacity, dump the extras "
            "into the LAST room rather than aborting."
        ),
    )
    parser.add_argument(
        "--assignments-csv",
        type=Path,
        default=None,
        help=(
            "Companion CSV with just (Project Name, Table Number, Room). "
            "Defaults to <output stem>_assignments.csv next to the main output "
            "whenever rooms are assigned. Pass --no-assignments-csv to skip it."
        ),
    )
    parser.add_argument(
        "--no-assignments-csv",
        action="store_true",
        help="Skip the companion (Name, Table, Room) CSV.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.input.exists():
        print(f"error: input file not found: {args.input}", file=sys.stderr)
        return 1

    with args.input.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        fieldnames = list(reader.fieldnames or [])
        missing = [c for c in (PROJECT_COLUMN, STATUS_COLUMN, TRACK_COLUMN) if c not in fieldnames]
        if missing:
            print(
                "error: missing required column(s) in CSV: " + ", ".join(missing),
                file=sys.stderr,
            )
            print("       expected Devpost-style headers like:", file=sys.stderr)
            print(f"         '{PROJECT_COLUMN}', '{STATUS_COLUMN}', '{TRACK_COLUMN}'", file=sys.stderr)
            return 1

        url_column = find_url_column(fieldnames)
        has_prize_column = PRIZE_COLUMN in fieldnames
        has_email_column = SUBMITTER_EMAIL_COLUMN in fieldnames
        has_first_column = SUBMITTER_FIRST_COLUMN in fieldnames
        has_last_column = SUBMITTER_LAST_COLUMN in fieldnames

        # Submissions keyed by (url) or (title + email). Each entry remembers
        # the first non-empty representative row plus the union of prize names.
        submissions: dict[str, dict[str, object]] = {}
        order: list[str] = []
        skipped_drafts = 0
        total_rows = 0

        for row in reader:
            total_rows += 1
            status = sanitize(row.get(STATUS_COLUMN)).lower()
            if status == "draft":
                skipped_drafts += 1
                continue

            project = sanitize(row.get(PROJECT_COLUMN)) or DEFAULT_PROJECT
            track = sanitize(row.get(TRACK_COLUMN)) or DEFAULT_TRACK
            url = sanitize(row.get(url_column)) if url_column else ""
            email = sanitize(row.get(SUBMITTER_EMAIL_COLUMN)) if has_email_column else ""
            first = sanitize(row.get(SUBMITTER_FIRST_COLUMN)) if has_first_column else ""
            last = sanitize(row.get(SUBMITTER_LAST_COLUMN)) if has_last_column else ""
            prize = sanitize_prize(row.get(PRIZE_COLUMN)) if has_prize_column else ""

            submitter = " ".join(part for part in (first, last) if part)
            # Always disambiguate with the submitter's name when we have one,
            # so projects sharing a title (frequent for "Untitled" drafts and
            # the occasional generic name like "Recall") don't visually
            # collide in the judge / results UIs. Format: "Title (Submitter)".
            if submitter:
                project_display = f"{project} ({submitter})"
            else:
                project_display = project

            key = url if url else f"{project.lower()}|{email.lower()}"

            entry = submissions.get(key)
            if entry is None:
                entry = {
                    "project": project_display,
                    "track": track,
                    "url": url,
                    "prizes": [],  # list to preserve first-seen order, dedup below
                }
                submissions[key] = entry
                order.append(key)

            if prize and prize not in entry["prizes"]:  # type: ignore[operator]
                entry["prizes"].append(prize)  # type: ignore[union-attr]

    kept_lines: list[str] = []
    rows_with_url = 0
    rows_with_prizes = 0

    for key in order:
        entry = submissions[key]
        project = entry["project"]
        track = entry["track"]
        url = entry["url"]
        prizes = sorted(entry["prizes"])  # type: ignore[arg-type]

        if url:
            rows_with_url += 1
        if prizes:
            rows_with_prizes += 1

        prizes_field = "|".join(prizes)
        kept_lines.append(
            f"{project}, {track}, {PLACEHOLDER_TABLE}, {PLACEHOLDER_ROOM}, {url}, {prizes_field}"
        )

    # Decide whether to assign rooms now. Order of precedence:
    #   1. --no-rooms    -> always skip, emit TBD placeholders.
    #   2. --rooms PATH  -> use that file (must exist).
    #   3. default file  -> use scripts/room_caps.txt if it happens to exist.
    rooms_path: Path | None = None
    if args.no_rooms:
        rooms_path = None
    elif args.rooms is not None:
        rooms_path = args.rooms
    elif DEFAULT_ROOMS_PATH.exists():
        rooms_path = DEFAULT_ROOMS_PATH

    room_summary: list[tuple[str, int]] | None = None
    if rooms_path is not None and kept_lines:
        rooms = load_room_caps(rooms_path)
        kept_lines, room_summary = assign_rooms_to_lines(
            kept_lines,
            rooms,
            seed=args.seed,
            overflow=args.overflow,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        f.write(HEADER + "\n")
        for line in kept_lines:
            f.write(line + "\n")

    url_note = (
        f"; {rows_with_url} with Devpost URL"
        if url_column
        else "; no Devpost URL column found in CSV"
    )
    prize_note = (
        f"; {rows_with_prizes} with opt-in prize(s)"
        if has_prize_column
        else "; no Opt-In Prize column found in CSV"
    )
    print(
        f"Wrote {len(kept_lines)} submission(s) to {args.output} "
        f"(skipped {skipped_drafts} draft row{'s' if skipped_drafts != 1 else ''} "
        f"out of {total_rows} row{'s' if total_rows != 1 else ''}{url_note}{prize_note}).",
        file=sys.stderr,
    )

    if room_summary is not None:
        print(f"Used room spec: {rooms_path}", file=sys.stderr)
        print_room_assignment_summary(room_summary, seed=args.seed, output_path=args.output)

        if not args.no_assignments_csv:
            assignments_path = args.assignments_csv or args.output.with_name(
                f"{args.output.stem}_assignments.csv"
            )
            n_written = write_assignments_csv(kept_lines, assignments_path)
            print(
                f"Wrote {n_written} assignment row(s) -> {assignments_path}",
                file=sys.stderr,
            )
    elif args.no_rooms:
        print(
            "Room assignment skipped (--no-rooms). "
            "Run scripts/assign_rooms.py later to fill in table/room.",
            file=sys.stderr,
        )
    elif rooms_path is None:
        print(
            f"Room assignment skipped (no rooms file at {DEFAULT_ROOMS_PATH}). "
            "Pass --rooms PATH or create that file to auto-assign.",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
