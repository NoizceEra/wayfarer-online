#!/usr/bin/env python3
"""Generate the tiny login-screen poster still from the login trailer video.

The login <video> used a 7.17 MB animated GIF as its ``poster`` — measured at
~71% of every byte the page moved on a cold visit. This script extracts a
single frame from the existing trailer MP4 and encodes it as a small WebP so
the login paints the same first-frame look in a few tens of KB.

Run from the repo root::

    python tools/make_login_poster.py

Reproducible: a fixed timestamp, scale and encoder quality produce a
byte-identical output for the same input video, so the poster can be
regenerated after any trailer re-render.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = REPO_ROOT / "public" / "trailer" / "wayfarer_login_bg.mp4"
DEFAULT_OUT = REPO_ROOT / "public" / "trailer" / "wayfarer_login_poster.webp"

# The trailer opens on a ~3 s logo card, so t=1.0 s is the fully faded-in title
# card: dark, on-brand, HUD-free and readable behind the login UI. It also
# matches what the <video> itself paints first, so the poster->video handoff
# does not flash.
FRAME_TS = "1.0"
WIDTH = 1920
HEIGHT = 1080
QUALITY = 82


def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    for cand in (
        Path.home() / "AppData/Local/hermes/tools/ffmpeg-9.0.1-win32-x64/bin/ffmpeg.exe",
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
    ):
        if cand.exists():
            return str(cand)
    sys.exit("ffmpeg not found on PATH; install it or edit find_ffmpeg().")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--timestamp", default=FRAME_TS, help="seconds into the trailer")
    ap.add_argument("--width", type=int, default=WIDTH)
    ap.add_argument("--height", type=int, default=HEIGHT)
    ap.add_argument("--quality", type=int, default=QUALITY, help="libwebp quality (0-100)")
    args = ap.parse_args()

    if not args.src.exists():
        sys.exit(f"source video not found: {args.src}")
    args.out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        find_ffmpeg(), "-y", "-loglevel", "error",
        "-ss", args.timestamp, "-i", str(args.src),
        "-frames:v", "1",
        "-vf", f"scale={args.width}:{args.height}:flags=lanczos",
        "-c:v", "libwebp", "-quality", str(args.quality),
        str(args.out),
    ]
    subprocess.run(cmd, check=True)

    size = args.out.stat().st_size
    print(f"wrote {args.out} ({size:,} bytes, {args.width}x{args.height} webp q{args.quality})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
