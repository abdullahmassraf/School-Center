#!/usr/bin/env python3
"""Minimal dependency-free PNG reader + screenshot QA metrics.

Used instead of a human eyeball or an image library: the CI screenshots are
decoded here so sharpness, flatness, darkness and colour can be *measured*
rather than assumed. Not part of the shipped site.
"""
import struct
import sys
import zlib

_CH = {0: 1, 2: 3, 4: 2, 6: 4}


def read_png(path):
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a png')
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        (ln,) = struct.unpack('>I', data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT':
            idat.append(body)
        elif typ == b'IEND':
            break
    w, h, depth, color, comp, filt, inter = ihdr
    if depth != 8 or color not in _CH or inter != 0:
        raise ValueError(f'unsupported png (depth={depth} color={color} interlace={inter})')
    nch = _CH[color]
    raw = zlib.decompress(b''.join(idat))
    stride = w * nch
    prev = bytearray(stride)
    rows = []
    p = 0
    for _ in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(nch, stride):
                line[i] = (line[i] + line[i - nch]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                b = prev[i]
                c = prev[i - nch] if i >= nch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        rows.append(line)
        prev = line
    return w, h, nch, rows


def to_gray(w, h, nch, rows):
    out = []
    for y in range(h):
        r = rows[y]
        line = bytearray(w)
        for x in range(w):
            i = x * nch
            line[x] = (r[i] * 299 + r[i + 1] * 587 + r[i + 2] * 114) // 1000
        out.append(line)
    return out


def metrics(path):
    w, h, nch, rows = read_png(path)
    g = to_gray(w, h, nch, rows)
    n = w * h
    tot = sum(sum(r) for r in g)
    mean = tot / n
    dark = sum(1 for r in g for v in r if v < 16)
    very_dark = dark / n
    # gradient energy = sharpness proxy (mean |dI/dx| + |dI/dy|)
    gx = gy = 0
    cnt = 0
    for y in range(0, h, 2):
        r = g[y]
        for x in range(1, w, 2):
            gx += abs(r[x] - r[x - 1]); cnt += 1
    for y in range(1, h, 2):
        r, q = g[y], g[y - 1]
        for x in range(0, w, 2):
            gy += abs(r[x] - q[x])
    edge = (gx + gy) / max(1, cnt * 2)
    # local flatness: fraction of 8x8 blocks with near-zero variance
    flat = blocks = 0
    for by in range(0, h - 7, 8):
        for bx in range(0, w - 7, 8):
            s = mx = 0
            mn = 255
            for yy in range(by, by + 8):
                r = g[yy]
                for xx in range(bx, bx + 8):
                    v = r[xx]
                    s += v
                    if v > mx: mx = v
                    if v < mn: mn = v
            if mx - mn <= 3:
                flat += 1
            blocks += 1
    # colourfulness
    sat = 0
    step = max(1, n // 40000)
    seen = 0
    for y in range(0, h, max(1, h // 200)):
        r = rows[y]
        for x in range(0, w, max(1, w // 200)):
            i = x * nch
            R, G, B = r[i], r[i + 1], r[i + 2]
            mx, mn = max(R, G, B), min(R, G, B)
            sat += 0 if mx == 0 else (mx - mn) / mx
            seen += 1
    return {
        'file': path.split('/')[-1],
        'size': f'{w}x{h}',
        'mean_luma': round(mean, 1),
        'edge_energy': round(edge, 2),
        'very_dark_pct': round(very_dark * 100, 2),
        'flat_block_pct': round(flat / max(1, blocks) * 100, 1),
        'saturation': round(sat / max(1, seen), 3),
    }


if __name__ == '__main__':
    for f in sys.argv[1:]:
        try:
            m = metrics(f)
            print(' '.join(f'{k}={v}' for k, v in m.items()))
        except Exception as e:  # noqa: BLE001
            print(f'{f}: ERROR {e}')
