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
