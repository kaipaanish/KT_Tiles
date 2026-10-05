# KT Tile Designer (prototype)

A salesperson or customer lays out a bathroom wall or floor with a KT Ceramics tile series, drags the pattern into alignment, and gets tile and box counts.

This is step 1 of 3:

1. **Pattern designer** for a flat wall or floor, seen straight on (this repo, in progress).
2. Photo mode: the same layout drawn onto a photo of the room, in perspective.
3. Live AR on Android Chrome (WebXR).

The layout engine has no DOM or canvas code, so steps 2 and 3 can reuse its output unchanged.

**Status:** these are done:
- the layout engine and demo tile textures
- the canvas renderer and gestures
- the Pattern / Row / Tile modes, with undo/redo
- the Design / Tiles / Align / Count panels

Floor-mode polish, sharing and autosave are next.

## Using it

The floating switch at the top of the canvas chooses what a one-finger drag grabs.

| Mode | What you can do |
| --- | --- |
| **Pattern** | Drag to shift the whole layout. It moves in half-tile steps and jumps to the centreline, a centred motif or a flush edge when close. While dragging you see the centreline, motif centres and each edge's cut (red below the minimum). |
| **Row** (walls) | Each band has a handle showing its height range from the floor. Drag ⠿ to move a band up or down, use − / + for its rows, and tap a band to change its design. "Fills rest" marks the band that fills up to the tiled height. |
| **Tile** | Tap a tile to select it, then tap again to rotate it (rectangular tiles only turn 180°). Hold a tile and drag it onto another to swap them. **Reset tiles** undoes all tile changes. |

Everywhere:
- Pinch to zoom, pan with two fingers, and double-tap to fit.
- On desktop, the mouse wheel zooms and right- or middle-drag pans.
- Undo and Redo are in the top bar, or use Ctrl+Z and Ctrl+Shift+Z.

The panel is a bottom sheet on phones: tap a tab to open it, and tap it again to fold it down. On screens 900 px and wider it is a side panel.

| Tab | Contents |
| --- | --- |
| **Design** | Series for the current surface, the wall presets (drawn on your wall), and the band list with the same actions as Row mode plus add/remove. On floors, the floor design. |
| **Tiles** | The series' tiles grouped by role. Tap one to put it in the selected band (Row mode or the band list), or in the selected tile (Tile mode). |
| **Align** | Alignment across and up (or along, for floors), a custom offset or bottom-row height, the smallest acceptable cut, and **Suggest alignment**. Suggestions are ranked by the chosen priority (avoid slivers, or centre the motif); tap one to apply it. Also shows the current cut at each edge. |
| **Count** | Full, cut, pieces, tiles to buy and boxes per tile, with totals, tiled area (m² and sq ft) and the allowance. |

## Run and test

Needs Node 20.19+ or 22.12+ (required by Vite 8).

```sh
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run typecheck  # app types, plus the engine checked without DOM types
npm run build      # typecheck, then a production build into dist/
```

### Browser check

`npm run check:browser` opens the pages listed in `scripts/check-scenarios.mjs` at phone size (390 × 844, touch, 3× pixels) and desktop size (1440 × 900). It saves screenshots and fails if any page logs a console error or a failed request.

```sh
npm run build && npx vite preview --port 4173     # leave running
npm run check:browser -- --out checks/latest       # screenshots land in checks/ (git-ignored)
```

The check uses `playwright-core`, which downloads no browsers: it drives the Chrome already installed on the machine (`--browser msedge` uses Edge instead). It is a development tool only. `npm run build` never runs it, so it has no effect on Vercel deployments.

### URL parameters

These open the app on a particular design, for demos and checks:

| Parameter | Example | Effect |
| --- | --- | --- |
| `series` | `demo-azure-medallion` | Wall or floor series |
| `preset` | `feature-wall` | Wall preset (`classic`, `highlighter-band`, `feature-wall`) |
| `design` | `floor-checker` | A single design: the floor's design, or one band filling a wall |
| `surface` | `floor` | Show the wall or the floor |
| `w`, `h`, `th` | `2450`, `2700`, `2100` | Width, height and tiled height in mm |
| `x`, `y` | `centre-motif`, `-100` | Alignment mode, or a custom offset in mm |
| `zoom`, `cx`, `cy` | `4`, `1225`, `1500` | Open zoomed in on a point (mm) |
| `cuts`, `repeat`, `motifs`, `dims` | `1` or `0` | View toggles |
| `mode` | `row` | Start in Pattern, Row or Tile mode |
| `tab` | `align` | Open the panel on a tab |
| `debug` | `1` | Exposes `window.ktDebug` (state and coordinates) for the browser check |

## How the code is organised

```
src/engine/    pure layout logic: no DOM or canvas, fully unit tested
src/designs/   series.json (tiles, series, designs, presets) and texture painters
src/render/    canvas renderer and texture cache
src/state/     the design document, pure edit actions, store with undo/redo; autosave (coming)
src/ui/        canvas view, gestures, modes, top bar, band handles, the sheet and its tabs
scripts/       browser check (development only)
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
5. **Images.** Put each tile's image in `public/tiles/` and set the tile's `textureUrl` to `"/tiles/<file>"`, for example `"/tiles/kt-blossom-hl-a.jpg"`.
   - Use one image per printed tile, drawn the way the tile is laid at 0°. The top of the image is the top of the tile on the wall.
   - The image's proportions should match `widthMm : heightMm`. About 2 pixels per mm (600 × 900 px for a 300 × 450 tile) is plenty.
   - A motif printed across several tiles needs no special handling: give each tile its own image, and the design's slots and `motifCentre` describe how they go together.
   - The `placeholder` stays in the data. It is drawn while the image loads, or if the image fails to load (a warning appears in the console). Painters available: `marble`, `stone`, `speckle`, `antiskid`, `flat`, `sprig`, `medallion`.

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

**Drawing**

21. **Placeholder textures are painted at 2 px per mm**, once per tile. Smaller copies (mipmaps) are made by halving, and the renderer draws from the smallest copy that is still sharp at the current zoom. Only the textures of the series on screen are built.
22. **"Show repeat" outlines only multi-tile designs.** A plain design repeats every tile, and the grout already shows that.
23. **Cut hatching.** Normal cuts are hatched grey; cuts below the minimum are hatched red. Edge-cut labels show with the dimensions and during a pattern drag.
24. **Motif centres that fall exactly on an edge are still shown**, e.g. a medallion cut in half by the top of the wall.

**Interaction**

25. **"Fill" stays with the top position.**
    - When bands are reordered, whichever band ends up on top fills the rest of the wall.
    - A band that stops filling keeps the number of rows it was showing.
    - Removing the fill band hands "fill" to the new top band.
26. **Overrides are stored only where a cell differs from its design.** Rotating a tile back, or swapping two tiles back, leaves no override.
27. **Double-tap fits the view**, except on a tile in Tile mode. There it counts as a second tap and rotates the tile. The Fit button always works.
28. **Only Pattern mode moves the pattern.** In Row and Tile modes, a one-finger drag on the wall pans the view.
    - A second finger turns any drag into pinch-and-pan.
    - A pattern drag that had already moved keeps its result.
29. **The canvas turns off the browser's own touch gestures** (it cancels `touchstart`). Without this, Chrome treats the long press used to lift a tile as its own gesture, and the next tap anywhere (e.g. on Undo) does nothing. The browser check caught this on the phone.
30. **Row handles sit to the left of the wall when there's room** (desktop), and over its left edge on phones. Each shows the design name above its height range.

**Panels**

31. **On phones the panel starts folded**, with just the tabs showing, so the wall opens large.
32. **The Tiles tab shows only the current series**, because every band on a wall uses the same series. Switch series in the Design tab.
33. **The band list runs from the top of the wall down**, like the wall itself. Its arrows move a band up or down.
    - **Add band** puts a one-repeat Light band just below the top band.
    - Removing the "fill" band hands "fill" to the band below it.
34. **The minimum-cut slider runs from 10% to 50% of a tile.** 33% means exactly a third, the default.
35. **Suggestions appear when asked for** ("Suggest alignment") and keep updating while the tab is open. The option matching the current layout is marked "Current".
36. **The Count tab's area is the tiled area** (what the tiles cover), not the area of the tiles bought.

**Floors**

37. **One design holds a wall and a floor.** Wall | Floor switches between them without losing either. The switch is part of undo, like every other change saved in the design.
38. **A floor is drawn from above, with no bands.**
    - Row mode is switched off on floors, and the floor's design is picked in the Design tab.
    - Its second dimension is its length. Alignment, snapping and suggestions work on both axes.
    - The default floor is 1800 × 2400 mm in Grey anti-skid, centred on a joint both ways.
39. **Square tiles turn in quarter turns everywhere**, so floor tiles (300 × 300 mm) can be turned 90° in Tile mode.
