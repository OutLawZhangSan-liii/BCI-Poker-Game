"""Trace the selected lower-row lettering into a small SVG brand asset.

Input is the approved comparison image, not the rejected transparent drafts.
This emits vector contours only; the original image remains unchanged.
Requires opencv-python-headless in the development environment.
"""
from pathlib import Path
import sys

import cv2
import numpy as np

source = Path(sys.argv[1])
image = cv2.imdecode(np.fromfile(source, dtype=np.uint8), cv2.IMREAD_COLOR)
if image is None:
    raise ValueError(f"Cannot read {source}")
# The original comparison has two rows; select only the approved lower row.
height = image.shape[0]
row = image[round(height * 0.51):round(height * 0.92)]
ink = cv2.inRange(row, (128, 128, 128), (255, 255, 255))
contours, _ = cv2.findContours(ink, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
contours = [c for c in contours if abs(cv2.contourArea(c)) > 6]
points = np.concatenate(contours)
x, y, width, height = cv2.boundingRect(points)
padding = 5
paths = []
for contour in contours:
    outline = cv2.approxPolyDP(contour, 0.55, True).reshape(-1, 2)
    coordinates = [(int(px) - x + padding, int(py) - y + padding) for px, py in outline]
    paths.append("M" + " L".join(f"{px} {py}" for px, py in coordinates) + " Z")
width += padding * 2
height += padding * 2
destination = Path(__file__).resolve().parents[1] / "renderer/public/assets/branding/shoujin-wordmark.svg"
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">\n'
       '<title>神工神游 — 定制瘦金风格字标</title>\n'
       f'<path fill="white" fill-rule="evenodd" d="{" ".join(paths)}"/>\n</svg>\n')
destination.write_text(svg, encoding="utf-8")
print(f"Wordmark: {destination}, {width}x{height}, ratio {width / height:.6f}, {destination.stat().st_size} bytes")
