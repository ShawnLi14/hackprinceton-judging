#!/usr/bin/env python3
"""Generate a judges.txt file the bulk importer understands, given a list of
judge names.

Each judge gets a fresh, random, 10-character (configurable) alphanumeric
access code. By default the alphabet excludes visually ambiguous characters
(0, 1, I, L, O) so codes survive being read off a screen and typed on a
phone. Codes are unique within the output file.

Output line format (one judge per line, comma-separated):

    Name, CODE

This matches the format the judging app's bulk judge importer accepts.

Input format:
    - One judge name per line.
    - Lines starting with `#` and empty lines are skipped.
    - Whitespace at line ends is trimmed.
    - If a line contains a comma, only the part before the first comma is
      treated as the name (so an existing `Name, OLDCODE` file can be
      re-shuffled by passing it through this script — old codes are
      discarded and replaced with newly generated ones).

Usage:
    python scripts/generate_judge_codes.py <names.txt> [output.txt]
    python scripts/generate_judge_codes.py - < names.txt        # stdin
    python scripts/generate_judge_codes.py names.txt --length 8
    python scripts/generate_judge_codes.py names.txt --allow-confusable

If output.txt is omitted, output is written to scripts/judges.txt.
"""

from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

# Uppercase letters + digits, minus characters that are easy to misread when
# typed off a screen: 0/O, 1/I/L. Leaves 32 characters, which gives 32**10
# (~1.1e15) possible codes at the default length — collisions are not a
# concern for hackathon scale.
SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
FULL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

DEFAULT_LENGTH = 10
HEADER = "# Judge Name, Access Code"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "input",
        type=str,
        help="Path to a text file with one judge name per line, or '-' for stdin.",
    )
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parent / "judges.txt",
        help="Destination .txt file (default: scripts/judges.txt).",
    )
    parser.add_argument(
        "--length",
        type=int,
        default=DEFAULT_LENGTH,
        help=f"Length of each generated code (default: {DEFAULT_LENGTH}).",
    )
    parser.add_argument(
        "--allow-confusable",
        action="store_true",
        help="Use the full A-Z 0-9 alphabet (don't exclude 0/1/I/L/O).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Optional integer seed for reproducible output (uses random.Random instead of secrets).",
    )
    return parser.parse_args()


def read_names(input_arg: str) -> list[str]:
    if input_arg == "-":
        lines = sys.stdin.readlines()
    else:
        path = Path(input_arg)
        if not path.exists():
            print(f"error: input file not found: {path}", file=sys.stderr)
            sys.exit(1)
        with path.open("r", encoding="utf-8-sig") as f:
            lines = f.readlines()

    names: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # Allow `Name, OLDCODE` style lines by taking the part before the
        # first comma — old codes are intentionally discarded.
        name = line.split(",", 1)[0].strip()
        if name:
            names.append(name)
    return names


def make_code_generator(alphabet: str, length: int, seed: int | None):
    if length < 4:
        print(f"error: --length must be at least 4 (got {length})", file=sys.stderr)
        sys.exit(1)

    if seed is not None:
        import random

        rng = random.Random(seed)

        def gen() -> str:
            return "".join(rng.choice(alphabet) for _ in range(length))
    else:
        def gen() -> str:
            return "".join(secrets.choice(alphabet) for _ in range(length))

    return gen


def main() -> int:
    args = parse_args()

    names = read_names(args.input)
    if not names:
        print("error: no judge names found in input", file=sys.stderr)
        return 1

    alphabet = FULL_ALPHABET if args.allow_confusable else SAFE_ALPHABET
    gen = make_code_generator(alphabet, args.length, args.seed)

    used: set[str] = set()
    pairs: list[tuple[str, str]] = []
    # Bound the inner retry loop so a pathological alphabet/length combination
    # can't spin forever. With a 32-char alphabet at length 10 even a billion
    # judges would not stress this.
    max_attempts_per_judge = 1000
    for name in names:
        code: str | None = None
        for _ in range(max_attempts_per_judge):
            candidate = gen()
            if candidate not in used:
                code = candidate
                break
        if code is None:
            print(
                f"error: could not generate a unique code for {name!r} after "
                f"{max_attempts_per_judge} attempts; widen --length or --allow-confusable.",
                file=sys.stderr,
            )
            return 1
        used.add(code)
        pairs.append((name, code))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        f.write(HEADER + "\n")
        for name, code in pairs:
            f.write(f"{name}, {code}\n")

    alphabet_label = "full A-Z 0-9" if args.allow_confusable else "safe (no 0/1/I/L/O)"
    print(
        f"Wrote {len(pairs)} judges to {args.output} "
        f"(codes: length {args.length}, alphabet {alphabet_label}).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
