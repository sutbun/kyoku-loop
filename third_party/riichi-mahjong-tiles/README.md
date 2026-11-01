# Tile artwork

Source: [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles), Regular variant, revision `26e127ba2117f45cdce5ea0225748cc0cfad3169`.

The upstream [README](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/README.md) and [license](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/LICENSE.md) dedicate the assets to the public domain under CC0 1.0. The license text is preserved alongside this file.

37 SVGs (34 ordinary faces and three red fives) are included in `src/assets/tiles/`. No faces are drawn from prior mahjong software. The files were optimized with SVGO 4.0.0 default settings: editing metadata/unused definitions removed, geometry and colors retained. Total SVG source size is 304,689 bytes (upstream 765,988 bytes). SVGs have no scripts, external images or font dependency.

Vite bundles small faces as data URLs and emits larger faces as hashed SVG assets. The existing phone shell cache includes every emitted asset; no external image request is made at runtime. Accessible Japanese tile labels live in the React wrapper, independently of the artwork. White, green/red dragons, winds and red fives each retain distinct artwork.
