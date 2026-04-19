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
    - `table_number` and `room_name` are placeholders (TBD) — fill them in
      manually before running the bulk import.
    - `Submission Url` (case-insensitive lookup) is emitted as the 5th field.
    - `Opt-In Prize` values are sanitized (commas -> spaces) and joined with
      `|` in the 6th field. Submissions with no opt-ins emit an empty 6th
      field, which the importer tolerates.
    - Commas inside any field are replaced with a space so the importer's
      naive `split(',')` parser still works.

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
PRIZE_COLUMN = "Opt-In Prize"
SUBMITTER_EMAIL_COLUMN = "Submitter Email"
SUBMITTER_FIRST_COLUMN = "Submitter First Name"
SUBMITTER_LAST_COLUMN = "Submitter Last Name"
URL_COLUMN_CANDIDATES = ("Submission Url", "Submission URL", "Submission url")

DEFAULT_PROJECT = "Untitled"
DEFAULT_TRACK = "Unspecified"
PLACEHOLDER_TABLE = "TBD"
PLACEHOLDER_ROOM = "TBD"

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
    return 0


if __name__ == "__main__":
    sys.exit(main())
