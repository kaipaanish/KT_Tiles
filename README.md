# KT Tile Designer (prototype)

A salesperson or customer lays out a bathroom wall or floor with a KT Ceramics tile series, drags the pattern into alignment, and gets tile and box counts.

This is step 1 of 3:

1. **Pattern designer** for a flat wall or floor, seen straight on (this repo, in progress).
2. Photo mode: the same layout drawn onto a photo of the room, in perspective.
3. Live AR on Android Chrome (WebXR).

The layout engine has no DOM or canvas code, so steps 2 and 3 can reuse its output unchanged.

**Status:** the layout engine and its tests are done. The designer UI is being built.

## Run and test

Needs Node 20.19+ or 22.12+ (required by Vite 8).

```sh
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run typecheck  # app types, plus the engine checked without DOM types
npm run build      # typecheck, then a production build into dist/
```

## How the code is organised

```
src/engine/    pure layout logic: no DOM or canvas, fully unit tested
src/designs/   series.json (tiles, series, designs, presets) and texture painters
src/render/    canvas renderer and texture cache          (coming)
src/state/     store, undo/redo, localStorage autosave    (coming)
src/ui/        panels, gestures, selection                (coming)
```

Units are millimetres. A surface's origin is its bottom-left corner, with x to the right and y up; the renderer flips y.

The engine's main function is `layoutSurface(surface, layout, alignment, overrides, catalog, options?)`. It returns a flat list of placed pieces (tile, rotation, grid cell, full and visible rectangles, cut sizes, band) together with motif centres, repeat-unit outlines, centreline guides, edge cuts, band height ranges and warnings. Renderers only draw that list.

The other engine functions are:
- `suggestAlignments`, which ranks the alignment options and explains each in one line
- `countTiles`, which gives pieces, tiles needed and boxes per tile
- `snapPatternOffset`, which snaps the pattern during a drag
- validation helpers for the data, bands and rotations

`tsconfig.engine.json` type-checks `src/engine` without the DOM library, so any use of `document`, `window` or canvas there fails `npm run typecheck` and `npm run build`.

## Adding a real KT series

All tile data lives in `src/designs/series.json` and is validated when the app loads. A mistake stops the app with a list of every problem, each naming the tile or design involved.

1. **Tiles.** Add one entry per printed tile:
   - `id`, `seriesId`, `name`, `widthMm` and `heightMm` (as laid on the wall), `finish` (`matt` or `glossy`) and `tilesPerBox`.
   - `role`: one of `light`, `dark` or `highlighter` for walls, or `floor` for floors.
   
   Every tile in a series must be the same size.
2. **Series.** Add `{ id, name, surface: "wall" | "floor", tileIds }`.
3. **Designs.** A design is a repeat unit of `cols × rows` tiles. List its `slots` row by row, **starting from the bottom row**. Each slot has a `tileId` and a `rotation` (0, 90, 180 or 270, clockwise as seen on the wall). Tiles are never mirrored, and rectangular tiles may only use 0 or 180. A plain design is 1 × 1. For a motif, add `motifCentre`: its position in mm from the unit's bottom-left corner.

   For example, a 2 × 2 medallion made from one quarter-tile:
   ```
   top row:     [HL 90°]  [HL 180°]      slots: HL 0°, HL 270°,   (bottom row)
   bottom row:  [HL 0°]   [HL 270°]             HL 90°, HL 180°   (top row)
   motifCentre: { "x": 300, "y": 300 }   (where the four tiles meet)
   ```
4. **Presets** need no changes. They are written in terms of roles ("Dark × 2 rows, Light fills the rest"), so every wall series that has light, dark and highlighter designs gets them automatically.
5. **Images.** Real tile images replace the procedural placeholders. (Details arrive with the renderer in step 2.)

Keep the three demo series: the engine tests use them.

## Deploying to Vercel

Push the repo to GitHub, then import it in Vercel with the **Vite** preset. The build command is `npm run build` and the output directory is `dist`. After that, every push redeploys the site.

## Decisions

Where the brief was ambiguous, these are the choices made.

**Layout**
1. **Grout doesn't change spacing.** Tiles sit on their nominal grid (8 × 300 mm = 2400 mm) and grout is drawn over the joints.
2. **Tile size.** All tiles in a series must be the same size (data validation enforces this), because every band on a wall shares one grid.
3. **The minimum cut is a fraction of the tile on each axis.** The default is ⅓: 100 mm across and 150 mm up for a 300 × 450 tile.
4. **Band order.** Design slots start from the bottom row, which matches how bands are listed and the y-up axis. Rotation is clockwise as seen on the surface.
5. **Band heights** are reported as ranges from the floor (e.g. "Highlighter: 1350–2250 mm"), because placement is discussed as "basin height" or "eye level".
6. **"Fill" bands.** Only the top band can be "fill".
   - If fixed bands stop below the tiled height, the gap stays untiled and a warning appears.
   - A band taller than the tiled height is cut off there, and its top-row pieces count as cuts. A warning appears.
   - A band that sits entirely above the tiled height is hidden, with a warning.
7. **Invalid input.**
   - An invalid layout (unknown ids, the wrong surface, or band rows that aren't a multiple of the design's rows) makes `layoutSurface` throw. Edits are validated before they are applied, so a throw means there's a bug.
   - An override that doesn't fit is ignored and a warning appears. Examples are a 90° turn on a rectangular tile, or a tile from another series.

**Alignment**

8. **Named alignments set the grid origin within one repeat.** The repeat covers every band's unit width: 600 mm on a wall that has a 2-column medallion band.
   - Custom offsets are used as given.
   - A wall's vertical offset only sets the bottom row's cut, so it wraps within one tile.
9. **Vertical alignment on walls** can also be "top": a full tile at the tiled height, with the cut at the floor. Centre-motif doesn't apply vertically on walls.
10. **Centre-motif on a wall** uses the lowest visible band that has a motif. If there is no motif, it falls back to centre-tile and shows a warning.
11. **Pattern drag snapping** moves the pattern in half-tile steps. Magnets take over when the pattern is close to one: a centred joint, tile or motif, or a flush edge.
    - Landing on a magnet sets that named mode, so the layout stays centred if the wall width changes.
    - Exact offsets are typed in the Align tab.
12. **On walls, vertical drag only sets the bottom cut**, anywhere from a full tile to half a tile, or flush at the top. Bands keep their row counts. To raise the highlighter band, add rows to the band below it.
13. **Suggestion ranking.** Options are ranked by:
    1. no slivers
    2. motif centred
    3. symmetric
    4. the largest smallest cut
    
    The Align tab's priority switch ("centre the motif") puts motif-centred options first. Walls compare horizontal options only; floors compare both axes. Alignments that produce the same layout are merged, e.g. "Centre joint (same as Left and Right)".

**Editing**

14. **Overrides belong to the pattern.** They are keyed to grid cells counted from the layout origin, so they move with the pattern when it's dragged. When a named alignment's origin is whole repeats away from the dragged one, the overrides are re-keyed so they stay on the same tiles.
15. **Tile mode:** the first tap selects a tile and a second tap rotates it. This way, selecting a tile to replace it from the palette doesn't also rotate it.
16. **Presets are role templates** (dark / light / highlighter).
17. **Assigning a tile to a band** uses that tile's plain design. If it has none, it uses the smallest design that contains it, so HL-A gives the Highlighter pair.

**Data and counts**

18. **Engine functions take the catalog** (tiles and designs) as an extra argument, on top of surface, layout, alignment and overrides.
19. **Motifs drawn across several tiles** are described on each tile with a placeholder `group`: the group's id, its cols and rows, and this tile's slice counted from the bottom-left. Tiles in a group must share series, painter, colours and group size.
20. **Counts are conservative.** Each cut piece uses a whole tile, because offcuts aren't reused. Tiles needed is pieces × (1 + allowance), rounded up after removing floating-point noise, so 40 pieces at 5% is 42 tiles, not 43. Boxes are rounded up per tile.
