# Selected brand lettering

`shoujin-selection.png` is the original generated comparison approved by the user.
Only its lower row, the four characters 神工神游 in a custom Slender Gold style,
is used for the application wordmark.

`packaging/build-brand-wordmark.py` traces that row to the local SVG asset at
`renderer/public/assets/branding/shoujin-wordmark.svg` without modifying the
source image. The two rejected transparent drafts are not application assets.

The SVG is a fixed four-character brand mark, not a general-purpose typeface.
It is shared by the window header and the intro. Body/UI text keeps its fonts.
The original comparison and development conversion tools are not runtime
dependencies and are not included in the installer.
