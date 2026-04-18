#!/usr/bin/env python3
"""Convert a Devpost-style submissions CSV into a teams.txt file the judging
app's bulk importer understands.

Output line format (one team per line, comma-separated):

    project_name, track, table_number, room_name

Behavior:
    - Skips rows whose `Project Status` is "Draft" (case/whitespace-insensitive).
    - Empty `Project Title` is allowed and emitted as "Untitled".
    - Empty / missing track is emitted as "Unspecified".
    - `table_number` and `room_name` are placeholders (TBD) — fill them in
      manually before running the bulk import.
    - Commas inside a field are replaced with a space so the importer's naive
      `split(',')` parser still works.
    - Duplicate submissions are kept (one line each).

Usage:
    python scripts/csv_to_teams.py <input.csv> [output.txt]

If output.txt is omitted, output is written to scripts/teams.txt.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

PROJECT_COLUMN = "Project Title"
STATUS_COLUMN = "Project Status"
TRACK_COLUMN = "What Main Hack Princeton Track Are You Submitted For?"

DEFAULT_PROJECT = "Untitled"
DEFAULT_TRACK = "Unspecified"
PLACEHOLDER_TABLE = "TBD"
PLACEHOLDER_ROOM = "TBD"

HEADER = "# Project Name, Track, Table Number, Room Name"


def sanitize(value: str | None) -> str:
    """Strip, collapse whitespace, and replace commas (the importer is comma-split)."""
    if value is None:
        return ""
    cleaned = value.replace(",", " ").replace("\r", " ").replace("\n", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


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
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.input.exists():
        print(f"error: input file not found: {args.input}", file=sys.stderr)
        return 1

    with args.input.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        missing = [c for c in (PROJECT_COLUMN, STATUS_COLUMN, TRACK_COLUMN) if c not in (reader.fieldnames or [])]
        if missing:
            print(
                "error: missing required column(s) in CSV: " + ", ".join(missing),
                file=sys.stderr,
            )
            print("       expected Devpost-style headers like:", file=sys.stderr)
            print(f"         '{PROJECT_COLUMN}', '{STATUS_COLUMN}', '{TRACK_COLUMN}'", file=sys.stderr)
            return 1

        kept_lines: list[str] = []
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

            kept_lines.append(f"{project}, {track}, {PLACEHOLDER_TABLE}, {PLACEHOLDER_ROOM}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        f.write(HEADER + "\n")
        for line in kept_lines:
            f.write(line + "\n")

    print(
        f"Wrote {len(kept_lines)} teams to {args.output} "
        f"(skipped {skipped_drafts} draft{'s' if skipped_drafts != 1 else ''} "
        f"out of {total_rows} row{'s' if total_rows != 1 else ''}).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
