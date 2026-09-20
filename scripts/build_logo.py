#!/usr/bin/env python3
"""Build the School Center crest: assets/logo.svg, assets/favicon.svg,
assets/logo.png, assets/logo-180.png.

Geometry is parametric; the SVG is the source of truth and the built-in
rasterizer parses THAT file, so the verification render shows exactly what
ships. Run: python3 scripts/build_logo.py"""
import math, struct, zlib, re

S = 128.0  # viewBox size

# ---------------------------------------------------------------- helpers
def fmt(v):
    s = f"{v:.2f}".rstrip('0').rstrip('.')
    return s if s else '0'

def poly_d(pts, close=True):
    d = f"M{fmt(pts[0][0])} {fmt(pts[0][1])}"
    for x, y in pts[1:]:
        d += f"L{fmt(x)} {fmt(y)}"
    return d + ("Z" if close else "")

def arc_cubics(cx, cy, rx, ry, rot_deg, a0, a1):
    """Elliptical arc -> exact cubic bezier segments (kappa form)."""
    spans = max(1, int(math.ceil(abs(a1 - a0) / (math.pi / 2))))
    rot = math.radians(rot_deg)
    cr, sr = math.cos(rot), math.sin(rot)
    def pt(a):
        ex, ey = rx * math.cos(a), ry * math.sin(a)
        return (cx + ex * cr - ey * sr, cy + ex * sr + ey * cr)
    def der(a):
        ex, ey = -rx * math.sin(a), ry * math.cos(a)
        return (ex * cr - ey * sr, ex * sr + ey * cr)
    dA = (a1 - a0) / spans
    k = 4 * math.tan(dA / 4) / 3
    segs = []
    p0 = pt(a0)
    for i in range(spans):
        t0 = a0 + i * dA
        t1 = t0 + dA
        p1 = pt(t1)
        d0 = der(t0)
        d1 = der(t1)
        c1 = (p0[0] + d0[0] * k, p0[1] + d0[1] * k)
        c2 = (p1[0] - d1[0] * k, p1[1] - d1[1] * k)
        segs.append((p0, c1, c2, p1))
        p0 = p1
    return segs

def arc_d(cx, cy, rx, ry, rot_deg, a0, a1):
    segs = arc_cubics(cx, cy, rx, ry, rot_deg, a0, a1)
    p0 = segs[0][0]
    d = f"M{fmt(p0[0])} {fmt(p0[1])}"
    for _, c1, c2, p1 in segs:
        d += f"C{fmt(c1[0])} {fmt(c1[1])} {fmt(c2[0])} {fmt(c2[1])} {fmt(p1[0])} {fmt(p1[1])}"
    return d

def gear_d(cx, cy, r_tip, r_root, r_hole, teeth=8):
    pts = []
    half = math.radians(11)
    step = 2 * math.pi / teeth
    for i in range(teeth):
        a = i * step
        g = step / 2 - 2 * half  # root arc span between teeth
        pts.append((cx + r_root * math.cos(a - g / 2), cy + r_root * math.sin(a - g / 2)))
        pts.append((cx + r_root * math.cos(a - g / 2), cy + r_root * math.sin(a - g / 2)))
        for r, da in ((r_root, -half), (r_tip, -half * 0.72), (r_tip, half * 0.72), (r_root, half)):
            pts.append((cx + r * math.cos(a + da), cy + r * math.sin(a + da)))
        pts.append((cx + r_root * math.cos(a + g / 2), cy + r_root * math.sin(a + g / 2)))
    outer = poly_d(pts)
    hole = (f"M{fmt(cx - r_hole)} {fmt(cy)}"
            f"A{fmt(r_hole)} {fmt(r_hole)} 0 1 0 {fmt(cx + r_hole)} {fmt(cy)}"
            f"A{fmt(r_hole)} {fmt(r_hole)} 0 1 0 {fmt(cx - r_hole)} {fmt(cy)}Z")
    return outer + hole

# ---------------------------------------------------------------- geometry
G = []
def add(fragment):
    G.append(fragment)

# Background: full-bleed black square (matches the source logo's canvas)
add(f'<rect width="{fmt(S)}" height="{fmt(S)}" fill="#000000"/>')

HALO = 2.4  # black separation stroke between overlapping whites

# Shield: thick band sweeping upper-left -> bottom tip -> upper-right
add('<path d="M20.5 47 Q31 79 64 116.5 Q97 79 107.5 47 L100.5 47 Q93.5 76 64 109 '
    'Q34.5 76 27.5 47 Z" fill="#fff"/>')

# Orbits (elliptical arcs) + planet dot on the right arc
add(f'<path d="{arc_d(57, 49, 44, 33, -24, math.radians(115), math.radians(257))}" '
    'fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round"/>')
add(f'<path d="{arc_d(59, 52, 47, 34, -24, math.radians(-52), math.radians(88))}" '
    'fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round"/>')
rot = math.radians(-24)
dot_a = math.radians(28)
dx = 47 * math.cos(dot_a)
dy = 34 * math.sin(dot_a)
dotx = 59 + dx * math.cos(rot) - dy * math.sin(rot)
doty = 52 + dx * math.sin(rot) + dy * math.cos(rot)
add(f'<circle cx="{fmt(dotx)}" cy="{fmt(doty)}" r="5.4" fill="#fff"/>')

# Torso / shoulders (halo separates from book + orbits)
add(f'<path d="M45 80 C45 67.5 53 62.5 64 62.5 C75 62.5 83 67.5 83 80 Z" '
    f'fill="#fff" stroke="#000" stroke-width="{fmt(HALO)}" paint-order="stroke"/>')

# Head
add(f'<circle cx="64" cy="54.5" r="12.2" fill="#fff" stroke="#000" stroke-width="{fmt(HALO)}" '
    'paint-order="stroke"/>')

# Cap band (front face under the board)
add(f'<path d="M48.5 36 L48.5 43.5 Q48.5 48 53 48 L75 48 Q79.5 48 79.5 43.5 L79.5 36 Z" '
    f'fill="#fff" stroke="#000" stroke-width="{fmt(HALO)}" paint-order="stroke"/>')

# Cap board (mortarboard rhombus)
add(f'<path d="M64 13.5 L99 27.5 L64 41.5 L29 27.5 Z" fill="#fff" '
    f'stroke="#000" stroke-width="{fmt(HALO)}" paint-order="stroke"/>')

# Tassel: cord from the right board tip, bead, tail
add('<path d="M91.5 28.5 C91.5 35 90.5 39 90.3 42.5" fill="none" stroke="#fff" '
    'stroke-width="2.2" stroke-linecap="round"/>')
add('<circle cx="90.3" cy="45.5" r="3" fill="#fff"/>')
add('<path d="M88.6 47.5 L92 47.5 L91.2 54 L89.4 54 Z" fill="#fff"/>')

# Gear under the book (drawn before it so the book halo separates them)
add(f'<path d="{gear_d(64, 89.5, 13.4, 10.5, 5.4)}" fill="#fff" fill-rule="evenodd" '
    f'stroke="#000" stroke-width="{fmt(HALO)}" paint-order="stroke"/>')

# Open book: cover, then black-haloed pages on top
add('<path d="M64 68.5 C55 61 43.5 58.5 32.5 60.5 C30 61 28.5 63 28.5 65.5 L28.5 69 '
    'C42 69.5 55 76.5 64 90.5 C73 76.5 86 69.5 99.5 69 L99.5 65.5 '
    'C99.5 63 98 61 95.5 60.5 C84.5 58.5 73 61 64 68.5 Z" fill="#fff"/>')
add(f'<path d="M61.8 74.5 C55.5 66.5 46 63 35.5 64.6 C33.2 65 31.8 66.6 31.8 68.8 L31.8 71.6 '
    f'C43 72.5 54.5 79.5 62.6 90.5 Z" fill="#fff" stroke="#000" stroke-width="{fmt(HALO)}" paint-order="stroke"/>')
add(f'<path d="M66.2 74.5 C72.5 66.5 82 63 92.5 64.6 C94.8 65 96.2 66.6 96.2 68.8 L96.2 71.6 '
    f'C85 72.5 73.5 79.5 65.4 90.5 Z" fill="#fff" stroke="#000" stroke-width="{fmt(HALO)}" paint-order="stroke"/>')

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" '
       'aria-label="School Center crest">\n  ' + '\n  '.join(G) + '\n</svg>\n')

with open('assets/logo.svg', 'w') as f:
    f.write(svg)
with open('assets/favicon.svg', 'w') as f:
    f.write(svg)
print('SVG written:', len(svg), 'bytes')

# ---------------------------------------------------------------- rasterizer
# Parses the exact SVG subset this generator emits (M/L/Q/C/A/Z, fill, stroke,
# even-odd) and scanline-fills at 4x supersample.
CMDS = re.compile(r'([MLQCAZ])([-\d.,\s]+)')

def flatten(d, scale):
    """-> list of (polyline, closed) in raster space."""
    out = []
    cur = []
    start = pen = (0.0, 0.0)
    def P(x, y):
        return (x * scale, y * scale)
    def push():
        nonlocal cur
        if len(cur) > 1:
            out.append((cur, False))
        cur = []
    for c, arg in CMDS.findall(d):
        nums = [float(v) for v in re.findall(r'-?\d+\.?\d*', arg)]
        if c == 'M':
            push()
            pen = start = (nums[0], nums[1])
            cur = [P(*pen)]
        elif c == 'L':
            pen = (nums[0], nums[1])
            cur.append(P(*pen))
        elif c == 'Q':
            x0, y0 = pen
            for i in range(1, 13):
                t = i / 12
                mt = 1 - t
                x = mt*mt*x0 + 2*mt*t*nums[0] + t*t*nums[2]
                y = mt*mt*y0 + 2*mt*t*nums[1] + t*t*nums[3]
                cur.append(P(x, y))
            pen = (nums[2], nums[3])
        elif c == 'C':
            x0, y0 = pen
            for i in range(1, 13):
                t = i / 12
                mt = 1 - t
                x = mt**3*x0 + 3*mt*mt*t*nums[0] + 3*mt*t*t*nums[2] + t**3*nums[4]
                y = mt**3*y0 + 3*mt*mt*t*nums[1] + 3*mt*t*t*nums[3] + t**3*nums[5]
                cur.append(P(x, y))
            pen = (nums[4], nums[5])
        elif c == 'A':
            rx, ry, rot, laf, sf, x1, y1 = nums[:7]
            x0, y0 = pen
            phi = math.radians(rot)
            dx2, dy2 = (x0 - x1) / 2, (y0 - y1) / 2
            x1p = dx2 * math.cos(phi) + dy2 * math.sin(phi)
            y1p = -dx2 * math.sin(phi) + dy2 * math.cos(phi)
            lam = x1p**2 / rx**2 + y1p**2 / ry**2
            if lam > 1:
                s = math.sqrt(lam)
                rx *= s
                ry *= s
            num = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p
            den = rx*rx*y1p*y1p + ry*ry*x1p*x1p
            co = math.sqrt(max(0.0, num / den)) * (-1 if laf == sf else 1)
            cxp = co * rx * y1p / ry
            cyp = -co * ry * x1p / rx
            cx = cxp * math.cos(phi) - cyp * math.sin(phi) + (x0 + x1) / 2
            cy = cxp * math.sin(phi) + cyp * math.cos(phi) + (y0 + y1) / 2
            def ang(ux, uy, vx, vy):
                du = math.hypot(ux, uy) * math.hypot(vx, vy)
                c = max(-1.0, min(1.0, (ux * vx + uy * vy) / du))
                a = math.acos(c)
                return -a if ux * vy - uy * vx < 0 else a
            th0 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
            dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
            if not sf and dth > 0:
                dth -= 2 * math.pi
            if sf and dth < 0:
                dth += 2 * math.pi
            for i in range(1, 13):
                t = th0 + dth * i / 12
                ex = rx * math.cos(t)
                ey = ry * math.sin(t)
                x = cx + ex * math.cos(phi) - ey * math.sin(phi)
                y = cy + ex * math.sin(phi) + ey * math.cos(phi)
                cur.append(P(x, y))
            pen = (x1, y1)
        elif c == 'Z':
            if len(cur) > 1:
                out.append((cur, True))
            cur = []
            pen = start
    push()
    return out

def fill_polys(shapes, buf, N, eo, color=255):
    alledges = []
    for pts, closed in shapes:
        pp = pts + ([pts[0]] if closed else [])
        alledges += list(zip(pp, pp[1:]))
    ys = [p[1] for pts, _ in shapes for p in pts]
    y0, y1 = max(0, int(min(ys))), min(N - 1, int(max(ys)) + 1)
    for y in range(y0, y1 + 1):
        sy = y + 0.5
        xs = []
        for (xa, ya), (xb, yb) in alledges:
            if (ya <= sy < yb) or (yb <= sy < ya):
                xs.append(xa + (sy - ya) * (xb - xa) / (yb - ya))
        xs.sort()
        if eo:
            pairs = range(0, len(xs) - 1, 2)
        else:
            pairs = range(0, len(xs) - 1, 2)  # generator only emits simple windings
        for i in pairs:
            for x in range(max(0, int(xs[i])), min(N - 1, int(math.ceil(xs[i + 1])))):
                j = (y * N + x) * 4
                buf[j] = buf[j + 1] = buf[j + 2] = color

def stroke_segs(segs, buf, N, w, color=255):
    r2 = (w / 2) ** 2
    for (xa, ya), (xb, yb) in segs:
        minx, maxx = int(min(xa, xb) - w), int(max(xa, xb) + w) + 1
        miny, maxy = int(min(ya, yb) - w), int(max(ya, yb) + w) + 1
        dx, dy = xb - xa, yb - ya
        L2 = dx * dx + dy * dy
        for y in range(max(0, miny), min(N - 1, maxy) + 1):
            for x in range(max(0, minx), min(N - 1, maxx) + 1):
                px, py = x + 0.5, y + 0.5
                t = 0 if L2 == 0 else max(0.0, min(1.0, ((px - xa) * dx + (py - ya) * dy) / L2))
                ex, ey = xa + t * dx - px, ya + t * dy - py
                if ex * ex + ey * ey <= r2:
                    j = (y * N + x) * 4
                    buf[j] = buf[j + 1] = buf[j + 2] = color

def raster(svg_text, size):
    SS = 4
    N = size * SS
    buf = bytearray(N * N * 4)  # black start
    for m in re.finditer(r'<(path|circle|rect)\b([^>]*)/?>', svg_text):
        tag, attrs = m.group(1), m.group(2)
        def attr(name):
            mm = re.search(name + r'="([^"]*)"', attrs)
            return mm.group(1) if mm else None
        fill = attr('fill')
        stroke = attr('stroke')
        sw = float(attr('stroke-width') or 0) * SS
        eo = (attr('fill-rule') == 'evenodd')
        shapes = []
        if tag == 'rect':
            x = float(attr('x') or 0) * SS
            y = float(attr('y') or 0) * SS
            w = float(attr('width')) * SS
            h = float(attr('height')) * SS
            shapes = [([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True)]
        elif tag == 'circle':
            cx = float(attr('cx')) * SS
            cy = float(attr('cy')) * SS
            r = float(attr('r')) * SS
            pts = [(cx + r * math.cos(2 * math.pi * i / 48), cy + r * math.sin(2 * math.pi * i / 48)) for i in range(48)]
            shapes = [(pts, True)]
        else:
            shapes = flatten(attr('d'), SS)
        if fill and fill != 'none':
            fill_polys(shapes, buf, N, eo, 0 if fill in ('#000', '#000000', 'black') else 255)
        if stroke and stroke != 'none':
            scol = 0 if stroke in ('#000', '#000000', 'black') else 255
            for pts, closed in shapes:
                segs = list(zip(pts, pts[1:] + ([pts[0]] if closed else [])))
                stroke_segs(segs, buf, N, sw, scol)
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    i = ((y * SS + sy) * N + x * SS + sx) * 4
                    r += buf[i]
                    g += buf[i + 1]
                    b += buf[i + 2]
            n = SS * SS
            j = (y * size + x) * 4
            out[j], out[j + 1], out[j + 2], out[j + 3] = r // n, g // n, b // n, 255
    return bytes(out)

# ------------------------------------------------- verify + PNG emission
img = raster(svg, 128)
print('\nStructure preview (white marks):')
for gy in range(0, 128, 3):
    line = ''
    for gx in range(0, 128, 2):
        i = (gy * 128 + gx) * 4
        lum = img[i] * 0.3 + img[i + 1] * 0.59 + img[i + 2] * 0.11
        line += '#' if lum > 150 else ('+' if lum > 60 else '.')
    print(line)

def write_png(path, size, rgba):
    raw = b''.join(b'\x00' + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    with open(path, 'rb') as f:
        d = f.read()
    pos = 8
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        assert typ in (b'IHDR', b'IDAT', b'IEND'), f'corrupt chunk {typ}'
        pos += 12 + ln
        if typ == b'IEND':
            break
    else:
        raise AssertionError('missing IEND')
    print(f'{path}: {len(png)} bytes, valid chunk walk to IEND')

write_png('assets/logo.png', 128, img)
img180 = raster(svg, 180)
write_png('assets/logo-180.png', 180, img180)
print('done')
