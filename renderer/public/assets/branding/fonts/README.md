# Brand font

`shengong-ming.woff2` is a static weight-600 subset of Noto Serif SC,
containing only the brand text `神工 · 神游`.

Source font metadata: © 2017–2023 Adobe (http://www.adobe.com/).
Noto Serif SC is licensed under SIL Open Font License 1.1; see `OFL.txt`.
The subset preserves the original copyright and license metadata and uses
the distinct family name `Shengong Ming`.

Reference: https://github.com/google/fonts/tree/main/ofl/notoserifsc

To regenerate, install `fonttools` and `brotli` into a development Python
environment, then run `packaging/build-brand-font.py <NotoSerifSC-font.ttf>`.
The generated font is committed as a local asset; app startup never downloads it.

## Current Ma Shan Zheng wordmark

The header and intro use `../mashanzheng-wordmark.svg`, outlined directly from
`artwork/web-pips-v2/MaShanZheng-Regular.ttf` with the approved specimen's spacing.
Regenerate with `python packaging/build-mashan-wordmark.py` (fonttools required).
The original font is licensed under SIL OFL 1.1; see `MaShanZheng-OFL.txt`.
No font download or runtime text rasterization is required. The earlier Ming
subset and `../shoujin-wordmark.svg` remain available as historical assets.
