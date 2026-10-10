#!/usr/bin/env python3
"""Objective detail metrics for 64x64 monster sheets (4x4 of 16x16 frames).

Metrics (per sheet):
  frames            : number of populated 16x16 frames
  mean_opaque       : mean opaque-pixel count per frame  (silhouette coverage)
  min/max_opaque    : spread of coverage across frames
  colours           : distinct RGB colours used (alpha>0)
  edges             : count of 4-neighbour pixel pairs where both are opaque and
                      the RGB differs  (internal colour transitions = internal detail)
  mean_edges_frame  : edges / frames
  boundary          : count of 4-neighbour pairs where exactly one is opaque
                      (silhouette perimeter = limb/articulation proxy)
  mean_boundary_frm : boundary / frames

Usage:  python3 tools/measure_monster_detail.py <sheet.png> [<sheet.png> ...]
        python3 tools/measure_monster_detail.py --json <sheet.png> ...
"""
import os
import sys
import json
from collections import Counter

from PIL import Image


def measure(path):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    px = im.load()

    colour_counter = Counter()
    frame_opaque = []
    edges = 0
    boundary = 0

    nfr = 0
    for fr in range(4):
        for fc in range(4):
            x0, y0 = fc * 16, fr * 16
            opaq = 0
            for y in range(y0, y0 + 16):
                for x in range(x0, x0 + 16):
                    a = px[x, y][3]
                    if a:
                        opaq += 1
                        colour_counter[px[x, y][:3]] += 1
                    # 4-neighbour right + down (avoids double counting)
                    for dx, dy in ((1, 0), (0, 1)):
                        nx, ny = x + dx, y + dy
                        if nx >= x0 + 16 or ny >= y0 + 16:
                            continue
                        na = px[nx, ny][3]
                        if a and na:
                            if px[x, y][:3] != px[nx, ny][:3]:
                                edges += 1
                        elif bool(a) != bool(na):
                            boundary += 1
            frame_opaque.append(opaq)
            if opaq > 0:
                nfr += 1

    mean_opaque = sum(frame_opaque) / len(frame_opaque) if frame_opaque else 0.0
    return {
        'path': os.path.relpath(path).replace('\\', '/'),
        'bytes': os.path.getsize(path),
        'size': (W, H),
        'frames': nfr,
        'mean_opaque': round(mean_opaque, 2),
        'min_opaque': min(frame_opaque) if frame_opaque else 0,
        'max_opaque': max(frame_opaque) if frame_opaque else 0,
        'colours': len(colour_counter),
        'edges': edges,
        'mean_edges_frame': round(edges / nfr, 2) if nfr else 0.0,
        'boundary': boundary,
        'mean_boundary_frame': round(boundary / nfr, 2) if nfr else 0.0,
    }


def main():
    argv = sys.argv[1:]
    as_json = False
    if argv and argv[0] == '--json':
        as_json = True
        argv = argv[1:]
    rows = [measure(p) for p in argv]
    if as_json:
        print(json.dumps(rows, indent=2))
        return
    hdr = f"{'asset':<26}{'B':>6}{'col':>5}{'frms':>5}{'opaq/f':>8}{'min':>5}{'max':>5}{'edge/f':>8}{'bnd/f':>8}"
    print(hdr)
    print('-' * len(hdr))
    for r in rows:
        print(f"{os.path.basename(r['path']):<26}{r['bytes']:>6}{r['colours']:>5}{r['frames']:>5}"
              f"{r['mean_opaque']:>8}{r['min_opaque']:>5}{r['max_opaque']:>5}"
              f"{r['mean_edges_frame']:>8}{r['mean_boundary_frame']:>8}")


if __name__ == '__main__':
    main()
