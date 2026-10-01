# Bundled stroke data

These 152 JSON files are selected from **hanzi-writer-data 2.0.1**, the stroke outlines and drawing medians used by Hanzi Writer. The collection includes the application's 150 selectable characters and the existing classroom/name examples 辰、明 (春 is now part of the selectable curriculum).

- Upstream: https://github.com/chanind/hanzi-writer-data
- Exact archive: https://registry.npmjs.org/hanzi-writer-data/-/hanzi-writer-data-2.0.1.tgz
- The upstream dataset is derived from Make Me a Hanzi: https://github.com/skishore/makemeahanzi
- Font-data license: **Arphic Public License**, reproduced unchanged in [ARPHICPL.TXT](ARPHICPL.TXT). The source font copyright is Copyright (C) 1999 Arphic Technology Co., Ltd. This license applies separately from the Hanzi Writer JavaScript renderer's MIT license.

Each JSON file is copied byte for byte from the pinned package; outlines and medians have not been edited. Only the selection and filenames differ: the original character filename becomes its lowercase hexadecimal Unicode code point, for example `大.json` → `5927.json`.

`../writing-strokes.json` records each character's local URL, stroke count and SHA-256. Run `python3 scripts/fetch-writing-strokes.py` from the repository root to regenerate the files and manifest. The script checks the archive's pinned SHA-512 before extracting any selected files and preserves the original license. Network access is needed only for regeneration, not for normal playback.
