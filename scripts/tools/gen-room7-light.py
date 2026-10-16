#!/usr/bin/env python3
"""Generates src/room7-public/room7-theme-generated.css.

Reads the dark guest-site stylesheets and, for every rule that paints text,
backgrounds or borders in a dark-theme colour, emits a matching override that
is scoped to .room7Public[data-theme="light"]. Re-run after editing those
stylesheets:  python3 scripts/tools/gen-room7-light.py
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = ['src/room7-public/room7-public.css', 'src/room7-public/room7-public-experience.css',
           'src/room7-public/room7-guest-engagement.css', 'src/room7-shared/room7-chat.css']
OUT = ROOT / 'src/room7-public/room7-theme-generated.css'
SCOPE = '.room7Public[data-theme="light"]'
TEXT, MUTED = '#0f1b2d', '#566478'

def parse_color(v):
    v = v.strip().lower()
    m = re.fullmatch(r'#([0-9a-f]{3}|[0-9a-f]{6})', v)
    if m:
        h = m.group(1)
        if len(h) == 3: h = ''.join(c * 2 for c in h)
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0
    m = re.fullmatch(r'rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)', v)
    if m:
        return float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4) or 1)
    return None

def lum(c): return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

def is_amber(c): return c[0] > 200 and 100 < c[1] < 215 and c[2] < 120

def map_text(v):
    c = parse_color(v)
    if not c: return None
    l = lum(c)
    if is_amber(c): return '#8a5200' if l > 0.45 else None  # pale amber copy -> readable amber
    if c[3] < 0.3: return None
    if l > 0.78: return TEXT if c[3] >= 0.8 else MUTED
    if l > 0.45 and c[2] >= c[0]: return MUTED  # cool grey used for muted copy
    return None

def map_bg(v):
    c = parse_color(v)
    if not c: return None
    r, g, b, a = c
    l = lum(c)
    if is_amber(c): return None
    if a < 0.02: return None
    if l > 0.85:   # translucent white wash on dark becomes a soft dark tint
        return 'rgba(15,23,42,%.2f)' % min(0.14, a * 0.8) if a < 0.9 else None
    if l < 0.22:   # dark panel / field becomes a light surface
        return 'rgba(255,255,255,%.2f)' % min(0.96, max(0.7, a + 0.35)) if a < 0.95 else '#ffffff'
    return None

def map_border(v):
    c = parse_color(v)
    if not c: return None
    if lum(c) > 0.85 and c[3] < 0.9: return 'rgba(15,23,42,%.2f)' % min(0.25, c[3] + 0.05)
    return None

def split_decls(body):
    out, depth, cur = [], 0, ''
    for ch in body:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ';' and depth == 0:
            out.append(cur); cur = ''
        else: cur += ch
    if cur.strip(): out.append(cur)
    return out

def process_decls(body):
    res = []
    for d in split_decls(body):
        if ':' not in d: continue
        prop, val = d.split(':', 1)
        prop, val = prop.strip().lower(), val.strip()
        imp = ' !important' if '!important' in val else ''
        val = val.replace('!important', '').strip()
        new = None
        if prop == 'color': new = map_text(val)
        elif prop in ('background', 'background-color'):
            if 'url(' in val: new = None
            elif 'gradient' in val:
                cols = re.findall(r'rgba?\([^)]*\)', val)
                parsed = [parse_color(x) for x in cols]
                if parsed and all(x and lum(x) > 0.85 and x[3] < 0.5 for x in parsed):
                    new = 'linear-gradient(145deg,rgba(255,255,255,.92),rgba(255,255,255,.7))'
                else: new = None
            else: new = map_bg(val)
        elif prop == 'box-shadow' and re.search(r'rgba\(0,\s*0,\s*0,\s*([.\d]+)\)', val):
            new = re.sub(r'rgba\(0,\s*0,\s*0,\s*([.\d]+)\)', lambda m: 'rgba(15,23,42,%.2f)' % min(0.16, float(m.group(1)) * 0.5), val)
        elif prop.startswith('border') and ('color' in prop or prop in ('border', 'border-top', 'border-bottom', 'border-left', 'border-right')):
            if prop.endswith('color') or True:
                parts = re.split(r'\s+(?![^()]*\))', val)
                changed = False
                for i, p in enumerate(parts):
                    m = map_border(p)
                    if m: parts[i] = m; changed = True
                new = ' '.join(parts) if changed else None
        if new: res.append(f'{prop}:{new}{imp}')
    return res

def scoped(selectors):
    out = []
    for s in selectors.split(','):
        s = s.strip()
        if not s.startswith('.room7'): continue
        if s.startswith('.room7Experience') or s.startswith('.room7PublicMeeting'): continue
        if s.startswith('.room7Public') and re.match(r'^\.room7Public(\s|$|:|\.|\[)', s):
            s2 = SCOPE + s[len('.room7Public'):]
        else:
            s2 = SCOPE + ' ' + s
        out.append(s2)
    return ', '.join(out)

def walk(css, depth=0):
    rules, i = [], 0
    while i < len(css):
        j = css.find('{', i)
        if j < 0: break
        head = css[i:j].strip()
        k, d = j + 1, 1
        while k < len(css) and d:
            if css[k] == '{': d += 1
            elif css[k] == '}': d -= 1
            k += 1
        body = css[j + 1:k - 1]
        i = k
        if head.startswith('@media'):
            inner = walk(body, depth + 1)
            if inner: rules.append(f'{head}{{\n{inner}\n}}')
        elif head.startswith('@'):
            continue
        else:
            sel = scoped(head)
            if not sel: continue
            decls = process_decls(body)
            if decls: rules.append(f'{sel}{{{";".join(decls)}}}')
    return '\n'.join(rules)

chunks = ['/* GENERATED by scripts/tools/gen-room7-light.py. Do not edit by hand. */']
for src in SOURCES:
    css = re.sub(r'/\*.*?\*/', '', (ROOT / src).read_text(), flags=re.S)
    chunks.append(f'/* {src} */')
    chunks.append(walk(css))
OUT.write_text('\n'.join(chunks) + '\n')
print('wrote', OUT.relative_to(ROOT), OUT.stat().st_size, 'bytes')
