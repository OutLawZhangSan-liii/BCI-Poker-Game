"""Outline the approved Ma Shan Zheng wordmark without raster tracing or font downloads.

Requires the existing fonttools development package. Run from any directory:
python packaging/build-mashan-wordmark.py
"""
from hashlib import sha256
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[1]
source = root / 'artwork/web-pips-v2/MaShanZheng-Regular.ttf'
font = TTFont(source)
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
units = font['head'].unitsPerEm
paths, bounds, advance = [], [], 0.0
for char in '神工神游':
    glyph = cmap[ord(char)]
    outline = SVGPathPen(glyphs)
    glyphs[glyph].draw(TransformPen(outline, (1, 0, 0, -1, advance, 0)))
    paths.append(outline.getCommands())
    pen = BoundsPen(glyphs)
    glyphs[glyph].draw(TransformPen(pen, (1, 0, 0, -1, advance, 0)))
    bounds.append(pen.bounds)
    # Same spacing as the approved specimen: 8 px at 112 px type size.
    advance += font['hmtx'][glyph][0] + units / 14
padding = units * .02
left = min(b[0] for b in bounds) - padding
top = min(b[1] for b in bounds) - padding
width = max(b[2] for b in bounds) + padding - left
height = max(b[3] for b in bounds) + padding - top
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left:.6f} {top:.6f} {width:.6f} {height:.6f}">
<title>神工神游 — 马善政字标</title>
<desc>Original Ma Shan Zheng glyph outlines. Source SHA256: {sha256(source.read_bytes()).hexdigest()}. Copyright 2018 The Ma Shan Zheng Project Authors. SIL OFL 1.1; see fonts/MaShanZheng-OFL.txt.</desc>
<path fill="white" d="{' '.join(paths)}"/>
</svg>
'''
destination = root / 'renderer/public/assets/branding/mashanzheng-wordmark.svg'
destination.write_text(svg, encoding='utf-8')
print(f'{destination.name}: ratio={width/height:.6f}, bytes={destination.stat().st_size}')
