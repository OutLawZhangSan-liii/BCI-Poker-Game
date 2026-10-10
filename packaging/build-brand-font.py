"""Build the small, bundled Ming-style font used only by the brand name.

Requires fonttools and brotli. Input: an OFL-licensed Noto Serif SC font.
The emitted font keeps its copyright/license metadata and ships with OFL.txt.
"""
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1])
destination = Path(__file__).resolve().parents[1] / "renderer/public/assets/branding/fonts/shengong-ming.woff2"
font = TTFont(source)
if "fvar" in font:
    font = instantiateVariableFont(font, {"wght": 600}, inplace=True)
options = subset.Options()
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
options.name_languages = [0x409]
subsetter = subset.Subsetter(options=options)
subsetter.populate(text="神工 · 神游")
subsetter.subset(font)
# Use a distinct family name for this static brand-only subset.
for record in font["name"].names:
    if record.nameID in (1, 4, 6):
        value = "ShengongMing" if record.nameID == 6 else "Shengong Ming"
        record.string = value.encode(record.getEncoding())
font.flavor = "woff2"
destination.parent.mkdir(parents=True, exist_ok=True)
font.save(destination)
print(f"Brand font: {destination} ({destination.stat().st_size} bytes)")
