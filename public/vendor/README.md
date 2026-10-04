# Hanzi Writer

`hanzi-writer-3.7.3.min.js` is the unmodified Hanzi Writer 3.7.3 browser distribution.

- Upstream: https://github.com/chanind/hanzi-writer/tree/v3.7.3
- Download: https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js
- Documentation: https://hanziwriter.org/docs.html
- License: MIT; see `hanzi-writer-LICENSE.txt`.

The application's `writing-strokes.js` supplies local JSON data using `charDataLoader`, so demonstrations never request the library's default CDN. Stroke data has its own license documented in `public/data/strokes/`.

The application uses a rendering-only SVG target through the library's `rendererOverride` option, avoiding quiz pointer listeners for this noninteractive demonstration layer. Completed strokes are rendered separately from the active stroke so stopping playback removes a half-finished stroke without clearing finished strokes. No internal render-state APIs are used.

# GSAP

`gsap-3.15.0.min.js` is the unmodified GSAP 3.15.0 browser distribution, used by `garden-scene.js` for finite SVG plant-growth and watering timelines.

- Upstream: https://gsap.com/
- Official npm archive: https://registry.npmjs.org/gsap/-/gsap-3.15.0.tgz
- The downloaded archive was verified against npm's SHA-512 integrity: `sha512-dMW4CWBTUK1AEEDeZc1g4xpPGIrSf9fJF960qbTZmN/QwZIWY5wgliS6JWl9/25fpTGJrMRtSjGtOmPnfjZB+A==`.
- License: Standard No Charge GSAP License, https://gsap.com/community/standard-license/; the text retrieved on 2026-10-04 is saved in `gsap-LICENSE.txt`. This is a custom license, not MIT. The distribution's copyright header is preserved.
- Only the core browser file is included. The scene uses no plugins, CDN requests, or framework adapter.
