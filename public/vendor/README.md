# Hanzi Writer

`hanzi-writer-3.7.3.min.js` is the unmodified Hanzi Writer 3.7.3 browser distribution.

- Upstream: https://github.com/chanind/hanzi-writer/tree/v3.7.3
- Download: https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js
- Documentation: https://hanziwriter.org/docs.html
- License: MIT; see `hanzi-writer-LICENSE.txt`.

The application's `writing-strokes.js` supplies local JSON data using `charDataLoader`, so demonstrations never request the library's default CDN. Stroke data has its own license documented in `public/data/strokes/`.

The application uses a rendering-only SVG target through the library's `rendererOverride` option, avoiding quiz pointer listeners for this noninteractive demonstration layer. Completed strokes are rendered separately from the active stroke so stopping playback removes a half-finished stroke without clearing finished strokes. No internal render-state APIs are used.
