# KT Tile Designer (prototype)

A salesperson or customer lays out a bathroom wall or floor with a KT Ceramics tile series, drags the pattern into alignment, and gets tile and box counts.

The project has three steps:

1. **Pattern designer** for a flat wall or floor, seen straight on.
2. **Photo mode**: the same layout drawn onto a photo of the room, in perspective.
3. Live AR on Android Chrome (WebXR).

The layout engine has no DOM or canvas code, so photo mode and AR reuse its output unchanged.

**Status:**
- Step 1 is complete; see the [checklist](#step-1-checklist). Two things still need a real Android phone: smooth dragging, and sharing to WhatsApp.
- Step 3a, a first AR test, is done; see the [checklist](#step-3-checklist). On the user's Android phone AR started with every feature (depth, lighting, anchors, plane detection), found a wall and the floor, kept placed tiles anchored, and ran at 30 fps.
- Step 2 is complete in the browser; see the [checklist](#step-2-checklist). Photo mode opens a photo from the camera, the gallery or a sample, and finds the walls and floor in it on the device. You tap a wall or the floor, fit its corners and confirm its real size; its tiles are then drawn on the photo in perspective, behind fixtures, with the room's lighting. Each surface keeps its own design. The pattern can be dragged on the photo, a brush corrects where tiles go, a before/after line compares, and Share sends the photo with its tiles. Still to try on a real phone: the camera, WhatsApp, and timings.

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
| **Align** | Alignment across and up (or along, for floors), a custom offset or bottom-row height, the smallest acceptable cut, and **Suggest alignment**. Suggestions are ranked by the chosen priority (Avoid slivers, or Symmetric pattern) and say how many motifs are whole or cut; tap one to apply it. Also shows the current cut at each edge. |
| **Count** | Full, cut, pieces, tiles to buy and boxes per tile, with totals, tiled area (m² and sq ft) and the allowance. |

**Share** (top bar) makes a picture of the wall or floor with its dimensions. Under it is a summary: series, size, band heights from the floor, tiles and boxes per tile, totals and area.
- On a phone the share sheet opens with the picture, ready for WhatsApp.
- Where the browser can't share files, the picture downloads instead.

**Autosave**: the design is kept in the browser, and it reopens as you left it.

### Photo mode

**Designer | Photo** at the left of the top bar switches between the flat designer and a photo of the room. Both show the same design.

- **Take photo** opens the phone's rear camera, and **Choose from gallery** picks a photo you already have. You can also try a sample photo.
- Photos are turned the right way up and scaled down to at most 2048 px on the long side.
- Pinch or scroll to zoom, drag to pan, and double-tap to fit. You can zoom out past the photo's edge.
- The **Photo** tab shows the current photo, offers another one, and lists the sample photos with their credits.

When a photo opens, the **wall finder** marks the walls (blue), floor (orange) and ceiling (grey) on it. It runs on the device; the first time, it downloads 4–15 MB (depending on the device), which the browser then keeps.
- **Show regions** in the Photo tab hides or shows the colours.

**Tiling a wall or the floor:**
1. **Tap it.** It starts with the designer's design and size for that kind of surface. Its four corners are fitted to its region; when one region covers two walls (a corner of the room, say), a starting rectangle goes around the tap instead, with the hint "Drag the corners to this wall's edges".
2. **Drag the corners** onto the surface's edges. A magnifier shows the photo under the corner, and corners may go beyond the photo's edge (zoom out to reach them). Each drag is one undo step.
3. **Confirm the real size** in the card below the photo, then **Done**. If the surface's corners can't be seen, the corners can mark **a known rectangle** on it instead, such as a door or a tile: enter its size, and the surface's size is measured from the photo.

**A wall bigger than the photo** (it runs off the top and bottom of the photo, or off three of its edges) has no corners to fit, so it starts with a known rectangle. The rectangle follows the wall's own lines: its tile joints, stripes and edges. Where lines run near the tap, the rectangle's edges sit on them, so on a tiled wall it often marks one tile. Dragging a corner keeps it lined up, with two more corners sliding along. Put it on something you know the size of and enter that size. Without enough lines on the wall, the corners are fitted as usual.

The tiles then appear on the surface in perspective, behind fixtures, keeping the room's light and shadow. **Room lighting** in the Photo tab sets how much (70% to start). Tap another wall or the floor to tile it too; each has its own design.
- The Design, Tiles, Align and Count tabs change the surface being edited ("Editing Wall in the photo"). A wall can use one series and the floor another.
- Tap a surface to edit it. The Photo tab lists them, with **Corners** to fit one again and **Remove**.
- **Tiles cover**, in the Photo tab, sets where the tiles go inside the corners. **Where the wall is** follows the wall finder, so fixtures stay in front. **Inside the corners** fills them. **Automatic** (the default) uses the wall finder unless it found less than 40% of the area inside the corners, as when it takes a plain wall for a door; then the tiles fill your corners, and a message says so.
- Patches of wall the wall finder misread (a textured wall taken for a screen door, say) are filled back in when they look like the wall around them with no edge between, so the tiles don't have holes. Things in front have an outline and stay out. If a fair share inside the corners is still untiled after Done, a message suggests **Add** for any of it that is wall.
- **Designer** shows the surface being edited flat, with "Photo wall:" in the size chip. **Wall** or **Floor** there goes back to the designer's own surfaces.

**Editing on the photo:** with a tiled surface selected, a bar under the photo offers three tools.
- **Pattern**: drag on the tiles to move the pattern. The snapping, magnets and edge-cut labels are the designer's, and the centreline shows in perspective while you drag. On a phone, zoom in for fine moves.
- **Add** and **Remove**: a brush for where tiles go. Paint over a tap or a mirror the wall finder took for wall, or over a gap it missed. Each stroke is one undo step. **Size** sets the brush, and zooming in makes it finer. **Clear brush changes** in the Photo tab removes them all.
- **Show grid and centreline**, in the Photo tab, draws the tile grid and centreline in perspective over the tiles.

**Before / after** in the same bar puts a line over the photo, with the room as it is on the left and the new tiles on the right. Drag the line, or use the arrow keys on its handle.

**Share** (top bar) in photo mode sends the photo with its tiles at the photo's own size, with a summary strip below it listing each tiled surface's series, size, tiles and boxes. It shares or downloads as in the designer. Once shared or saved, leaving the page no longer asks first.

Photos stay on the device. They are never uploaded and never saved, so closing the page loses them. While a photo has surfaces that haven't been shared, the browser asks before you leave the page.

### AR test (step 3a)

**AR** in the top bar opens the AR test screen (`?view=ar`). It needs Chrome on an Android phone with Google Play Services for AR; elsewhere it says so.

1. **Start AR** opens the camera.
2. Move the phone slowly over a wall or the floor until a ring appears on it: blue on a wall, orange on the floor.
3. Tap to place a 1 m square of your design there (the wall's or the floor's, as saved in the designer). **Undo**, **Clear** and **Exit AR** are at the bottom.

Text at the top reports what the phone granted and how tracking is going:
- the features (hit test, overlay, anchors, plane detection, depth, lighting);
- tracking;
- what the ring is on and how far away;
- the surfaces found, the squares placed (anchored or not), and the frame rate.

After **Exit AR**, the same report stays on the screen.

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

Photo checks run the real wall finder, so the first run needs an internet connection. Its downloads (about 30 MB: the model, Transformers.js and the ONNX runtime) are kept in `checks/.download-cache` for later runs.

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
| `view` | `photo` | Open in photo mode |
| `sample` | `old-bathroom-subway-tiles.jpg` | With `view=photo`: open that photo from `public/samples/` |
| `backend` | `wasm` | Run the wall finder on WASM even where WebGPU is available, for comparison |
| `edges` | `bilinear` | Turn off the photo-guided edges, for comparison |
| `segmenter` | `fake` | Skip the model: a plain room layout (ceiling, wall, floor), for quick checks. `fake-wall`: a wall filling the photo |
| `view` | `ar` | The AR test screen (step 3a) |
| `debug` | `1` | Exposes `window.ktDebug` (state and coordinates) for the browser check |
| `fresh` | `1` | Start from the default design instead of the autosaved one |

A link with any design parameter (`series`, `preset`, `design`, `surface`, `w`, `h`, `th`, `x`, `y` or `fresh`) opens that design instead of the autosaved one.

## How the code is organised

```
src/engine/    pure layout logic: no DOM or canvas, fully unit tested
src/designs/   series.json (tiles, series, designs, presets) and texture painters
src/render/    canvas renderer, texture cache, previews, the shared picture
src/render/webgl/  the tiles on the photo: mesh, shaders and the WebGL2 compositor
src/state/     the design document, pure edit actions, store with undo/redo, autosave
src/ui/        canvas view, gestures, modes, top bar, band handles, the sheet and its tabs, share
src/photo/     photo mode: getting the photo, the photo stage, regions, the perspective maths,
               a wall's lines (lines.ts) and filling misread patches (holes.ts)
src/segment/   the wall finder: model interface, worker, and cleaning up its output
public/samples/  sample photos and their credits, listed automatically
scripts/       browser check (development only)
```

Units are millimetres. A surface's origin is its bottom-left corner, with x to the right and y up; the renderer flips y.

The engine's main function is `layoutSurface(surface, layout, alignment, overrides, catalog, options?)`. It returns a flat list of placed pieces (tile, rotation, grid cell, full and visible rectangles, cut sizes, band) together with motif centres, repeat-unit outlines, centreline guides, edge cuts, band height ranges and warnings. Renderers only draw that list.

The other engine functions are:
- `suggestAlignments`, which ranks the alignment options and explains each in one line
- `countTiles`, which gives pieces, tiles needed and boxes per tile
- `snapPatternOffset`, which snaps the pattern during a drag
- validation helpers for the data, bands and rotations

`tsconfig.engine.json` type-checks `src/engine` without the DOM library, so any use of `document`, `window` or canvas there fails `npm run typecheck` and `npm run build`. It checks photo mode's pure maths the same way, including `homography.ts`, `maskToQuad.ts`, `fit.ts`, `lines.ts` and `holes.ts` in `src/photo/`.

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

## Sample photos

Photo mode offers every photo in `public/samples/` as a sample, and the browser check opens each one. Adding a photo needs no code changes.

1. Put the photo (JPEG, PNG or WebP) in `public/samples/`. The app scales photos down to 2048 px on the long side, so saving them at about that size keeps the site small.
2. Optionally, give it a title and credit in `public/samples/credits.json`, keyed by file name:
   ```json
   "our-bathroom.jpg": { "title": "Our bathroom", "credit": "", "licence": "", "source": "" }
   ```
   Without an entry, the title is the file name with dashes turned into spaces.

A running `npm run dev` picks up added or removed photos on the next page reload.

The sample included now is [Old bathroom with subway tiles](https://commons.wikimedia.org/wiki/File:Old_bathroom_with_subway_tiles.JPG) by Alf van Beem, released into the public domain under CC0 1.0. The copy here is scaled down to 2048 × 1536.

## The wall finder

Photo mode finds walls, floors and ceilings with **SegFormer-B0** trained on ADE20K, a 150-class scene dataset ([Xenova/segformer-b0-finetuned-ade-512-512](https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512), an ONNX export of [nvidia/segformer-b0-finetuned-ade-512-512](https://huggingface.co/nvidia/segformer-b0-finetuned-ade-512-512)). It runs in a Web Worker with [Transformers.js](https://huggingface.co/docs/transformers.js).

**Licence: non-commercial only.** NVIDIA's SegFormer licence allows research and non-commercial use. That is fine for this prototype, but a commercial launch needs a different model. The model is kept behind two interfaces in `src/segment/segmenter.ts`, so replacing it touches one file:
- `SurfaceModel`: load the model, then return wall, floor and ceiling probabilities for an image. A model trained on ADE20K labels only needs its id; others need `GROUP_NAMES` in `classes.ts` adjusted.
- `Segmenter`: the whole job (a photo in, a label per pixel out), for a model that works differently.

Everything after the probabilities (sharpening edges, removing specks, fitting corners) stays the same.

**Network:** photos never leave the device. When the first photo is opened, the browser downloads:
- Transformers.js 4.3.0 and the ONNX runtime's WASM file from jsDelivr
- the model's files from Hugging Face, pinned to one commit of the repository: 7.9 MB for WebGPU with fp16, 15.3 MB for WebGPU without fp16 support, or 4.4 MB for WASM

All of it is cached by the browser, so later photos and visits don't download it again.

## Deploying to Vercel

1. Push the repo to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Vercel detects the **Vite** preset. Keep the build command (`npm run build`) and the output directory (`dist`), then deploy.
4. Every push to the main branch redeploys the site, and other branches get preview links.

The site is static, so it needs no environment variables, server or API keys. The build runs the type checks first, so a type error stops a bad deploy. The browser-check tool is never part of the build.

Sharing files to WhatsApp needs HTTPS, which Vercel provides.

No special headers are set. Cross-origin isolation (COOP/COEP) would let the wall finder use several CPU threads, but it changes how the model files may be fetched. It is left off until that is tested on the deployed site.

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
10. **Centre-motif and between-motifs on a wall** use the lowest visible band that has a motif. Centre-motif puts a motif centre on the centreline; between-motifs puts the centreline exactly midway between two neighbouring motifs. With no motif they fall back to centre-tile and centre-joint, with a warning.
11. **Pattern drag snapping** moves the pattern in half-tile steps. Magnets take over when the pattern is close to one: a centred joint, tile or motif, the centreline between two motifs, or a flush edge. When several magnets give the same grid, the motif-aware name wins.
    - Landing on a magnet sets that named mode, so the layout stays centred if the wall width changes.
    - Exact offsets are typed in the Align tab.
12. **On walls, vertical drag only sets the bottom cut**, anywhere from a full tile to half a tile, or flush at the top. Bands keep their row counts. To raise the highlighter band, add rows to the band below it.
13. **Suggestion ranking.** With **Avoid slivers**, options are ranked by:
    1. no slivers
    2. symmetric
    3. fewest cut motifs
    4. fewest cut tiles
    5. the largest smallest cut

    **Symmetric pattern** puts symmetric first, then the same order.
    - *Symmetric* means the pattern mirrors about the centreline: a motif centre on it, or it exactly midway between two neighbouring motif centres. For plain designs, the tile grid is symmetric. Floors must be symmetric both ways.
    - *Cut motifs* are motif repeat units that cross any surface edge, including the tiled height.
    - Ties keep a fixed order (centre motif, between motifs, centre tile, centre joint, left, right).
    - Explanations for motif designs read like "4 whole medallions, no cuts, symmetric"; plain designs keep "No slivers; 175 mm cuts at both ends".
    
    Walls compare horizontal options only; floors compare both axes. Alignments that produce the same grid are merged, e.g. "Between motifs (same as Centre joint, Left and Right)".
    - **The opening design uses the top suggestion**: on the default 2400 mm wall that is between motifs, with 8 whole sprigs and no cuts.
    - Saved designs from before this change read the old "centre the motif" priority as "Symmetric pattern".

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

**Share and autosave**

40. **The shared picture is 1400 px wide.** It is laid out at 700 px and drawn at 2×, so its labels stay readable on a phone.
    - It always shows dimensions, and uses the current view toggles for cuts, repeat and motifs.
    - The summary wraps between tiles, never in the middle of one.
    - Cancelling the share sheet does nothing more. Any other share failure falls back to a download.
41. **Autosave** keeps the design in `localStorage` 0.4 s after each change, and immediately when the page is hidden. The view toggles are kept too.
    - On load, the saved design is checked against the current catalog and the rules. If anything no longer fits, the app starts fresh. Examples: a removed series, band rows that don't fit a design, or a rotation a tile can't take.
    - Settings added in later versions take their defaults.
    - If storage is blocked or full, nothing breaks; the design just isn't kept.
42. **A link with design parameters wins over the autosaved design.** Autosave then keeps working on the linked design. `?fresh=1` starts from the default.

**Photo mode**

43. **Photo mode is a second view of the same design**, switched with Designer | Photo in the top bar. The hidden designer keeps its size and zoom, and the Photo tab appears only in photo mode.
44. **Photos are kept in memory only.** They are never uploaded and never written to `localStorage`, so closing the page loses them.
    - Each photo is turned upright with its EXIF orientation as it is decoded. Current browsers do this through `createImageBitmap` with `imageOrientation: 'from-image'`, and older ones through an `<img>`.
    - It is then scaled to at most 2048 px on the long side, which keeps a phone's memory and the tile drawing manageable.
45. **Sample photos are listed when the site is built.** A small Vite plugin reads `public/samples/` and `credits.json`, so new photos need no code, and the browser check opens every sample.
46. **Zooming out goes down to 0.3× the fitted size**, so a corner can be placed beyond the photo's edge when a wall runs out of frame. Zooming in stops at 12×.
47. **A surface is mapped onto the photo with a homography**, from surface millimetres (y up, as in the engine) to photo pixels.
    - It is solved from four corners in surface order (bottom-left, bottom-right, top-right, top-left), with Hartley normalisation so the solve stays accurate.
    - A drag on the photo becomes a move in millimetres through the inverse map, so the pattern follows the finger at any depth.
48. **A surface's first corners come from its region in the segmentation.**
    - The fit starts from the region under the tap, minus anything other surfaces already cover, with enclosed holes (a mirror, a basin) filled.
    - The region's convex hull is reduced to four corners. Each corner then moves to where straight lines fitted along its two sides meet, because pixelated corners are rounded off.
49. **Two walls in one region aren't forced into one quad.**
    - The fit is scored as 1 − IoU (intersection over union) of the quad and the filled region, where 0 is a perfect fit. Above 15%, the app places a starter quad around the tap, as tall as the region there, with the hint "Drag the corners to this wall's edges".
    - Comparing the convex hull's area with the quad's, as first proposed, isn't enough. An L-shaped region (a tall wall beside a lower one) loses only about 14% of its hull to the best quad, so it would pass. Its 1 − IoU is above 15%, and the unit tests include that case.

**The wall finder**

50. **Transformers.js is loaded from jsDelivr (pinned to 4.3.0), not installed from npm.** The npm package also installs onnxruntime-node (301 MB) and sharp, which a static site never uses. onnxruntime-node also downloads CUDA libraries during `npm install` on Linux x64, which includes Vercel's build machines. Loading the browser build at run time keeps installs and builds unchanged. The ONNX runtime's WASM comes from jsDelivr in either case.
51. **WebGPU when available, otherwise WASM**, as the brief asks. WebGPU uses fp16 where the GPU supports it (7.9 MB) and fp32 where it doesn't (15.3 MB). WASM uses the 8-bit model (4.4 MB) and is also the fallback if WebGPU fails. `?backend=wasm` forces WASM. Measured on the sample photo at 512 × 512, in headless Chrome on a laptop with an Intel GPU (not a phone):

    | | Download | First run | Later runs | Labels matching fp32 |
    | --- | --- | --- | --- | --- |
    | WASM 8-bit | 4.4 MB | 1.5 s | 1.0 s | 99.5% |
    | WebGPU fp32 | 15.3 MB | 2.4 s | 0.8 s | 100% |
    | WebGPU fp16 | 7.9 MB | 3.7 s | 0.5 s | 99.95% |

    Each photo is segmented once, so the download and the first run matter most. On this laptop WASM gave the first result sooner, because WebGPU's first run includes compiling its shaders. Phone GPUs may change that, so the default stays as the brief has it until it has been timed on a real phone: open a sample with and without `?backend=wasm` and compare the times in the Photo tab.
52. **The model sees the photo in its own shape**: about 640 px on the long side in multiples of 32 (640 × 480 for a 4:3 photo), rather than squashed into the 512 × 512 square it was trained on. It takes the same time and separates fixtures from the wall better: on the sample, the WC cistern and most of the towel are no longer labelled as wall.
53. **Edges follow the photo (a guided filter).** The model labels cells of about 6 × 6 working pixels, and scaling its output up smoothly left visible bands of old wall around the basin and the WC in the sample (browser check `photo-edges`).
    - Each class's probability is passed through a colour guided filter (He, Sun and Tang) with the photo as the guide. Where the probability changes, it is refitted as a linear function of the photo's colour in a small window, so the edge moves onto the photo's own edge. With it, the edges hug the basin's rim and the side of the WC.
    - Settings: a 12 px window, eps 0.0004, with coefficients worked out at quarter size (the "fast" guided filter). On desktop, the clean-up takes about 0.3–0.4 s, against 2.5 s for the model.
    - It can't recover objects the model missed entirely, e.g. tiles reflected in a mirror read as wall. The undoable brush (still to come) handles those.
54. **Specks are absorbed by their surroundings.** Wall, floor or ceiling patches smaller than 0.2% of the photo take the label around them. So do "other" specks below 0.02%, a limit kept tiny so taps and soap dishes stay in front of the tiles.
55. **What counts as a surface.** Wall, floor and ceiling are found by name in the model's labels, and a rug counts as floor because it is usually lifted for tiling. Everything else stays in front of the tiles: fixtures, mirrors, doors, furniture. Ceilings are shown, but tapping one explains that only walls and floors are tiled.
56. **The wall finder runs as soon as a photo opens**, at a working size of 1024 px on the long side. A status at the top shows the download, then "Finding walls and floor…", then a legend. If it fails (offline, say), it says so and offers **Try again**.

**Photo surfaces**

57. **Photo surfaces live in the design document**, beside the designer's wall and floor, so every change to them is undoable. The surface being edited can be one of them. The tabs, the designer and the actions all edit "the surface being edited", so a photo wall has the same Design, Tiles, Align and Count tabs as the designer's wall. Autosave leaves photo surfaces out, because their photo isn't saved.
58. **A new photo surface copies the designer's design** for its kind: series, bands and alignment, but no single-tile changes, because those belong to the designer's grid. It also starts with the designer's size, which the fit card asks the user to confirm.
59. **Tapping inside a surface's outline edits it.** Tapping elsewhere adds a surface from the region under the tap, leaving out whatever other surfaces already cover. So a second wall that shares a region with the first still gets its own corners.
60. **Tiles stay inside the surface's own rectangle**, mapped into the photo. Two walls in one region therefore don't spill into each other, even though they share the same mask. Within the rectangle, the tiles go where the wall finder found that kind of surface, so fixtures stay in front (see decision 83).
61. **Corners.** Handles can go anywhere, including beyond the photo. While one is dragged, a magnifier shows the photo at three times the current zoom. It sits above the corner when there is room, otherwise in a top corner of the stage clear of the other handles, and never below the finger, where the hand is. Corners that cross over are drawn red, and Done waits until they're fixed. While the card shows, the photo fits above it.
62. **A known rectangle.** When the surface's corners can't be seen, the corners can mark any rectangle of known size on it, such as a door or a tile.
    - The surface's size is then measured from the photo: its region's outline (its convex hull, because straight lines stay straight on the plane) is mapped into the rectangle's plane, skipping anything at or beyond the horizon.
    - The measured size is rounded to 10 mm and can be changed in the size chip afterwards.
63. **Until the tiles are drawn on the photo** (the next step), a confirmed surface shows its tile grid in perspective, clipped to its region.
64. **Leaving the page asks first** whenever photo surfaces have changed since they were last shared or downloaded, because photo work is never saved. With no photo surfaces (for example, after undoing them all), it doesn't ask.
65. **On phones the top bar has two rows in the designer**: Designer | Photo and the actions on the first, the surface and its size on the second. Once Designer | Photo was added, one row left the size chip about 30 px wide.

**Tiles on the photo**

66. **Tiles are drawn with WebGL2, in true perspective.**
    - Each tile's visible part is a quad in surface millimetres. The vertex shader applies the surface's homography, together with the photo's place on screen, and passes its third component as w.
    - The GPU therefore interpolates the texture in perspective: grout lines stay straight and converge as the room's own lines do.
    - There is no 3D engine and no warping of flat triangles.
67. **They are the designer's tiles and grout.**
    - The textures come from the designer's cache at full resolution. The GPU makes their mipmaps, and anisotropic filtering, where available, keeps floors sharp into the distance.
    - Grout is drawn in the fragment shader, in millimetres on the surface. It goes on joints only and is at least a pixel wide, like the designer's grout lines.
68. **The mask is the surface's region at the working size, feathered by one pixel there** (about 2 photo pixels) and filtered linearly by the GPU. A close-up check along the bathtub's rim showed stair steps without the feather and a clean edge with it.
69. **Room lighting comes from the photo's own luminance over the surface.**
    - It is worked out at 256 px and blurred three times with a radius of 5% of that size (about two tiles in a typical photo), so the old tiles and grout don't show through.
    - The blur is a normalised convolution: only the surface's region counts, so a white WC doesn't brighten the wall beside it.
    - The result is divided by the region's average, the tiles are multiplied by it, and the slider sets how much (default 70%).
    - On the sample photo, moving the slider from 0% to 100% changes the brightness of the drawn tiles by up to 25 levels out of 255. (It was 50 when first measured, in an earlier version; `photo-tiles` prints the current figure.)
70. **The tiles are drawn at the screen's pixel ratio** (up to 3×) and again with every zoom and pan. The shared picture, still to come, will be drawn at the photo's own resolution.
71. **Without WebGL2, the tile grid shows where the tiles go**, and the Photo tab says why. `?webgl=0` forces this, for checks.
72. **The region colours stay off tiled areas**: they are cut out where tiles are drawn. Otherwise the colour would tint the tiles' soft edges, while untiled walls should still be coloured to invite a tap.

**Editing on the photo**

73. **The pattern drag on the photo is the designer's.** Both views call the same action for snapping, magnets and re-keying single-tile changes.
    - On the photo the pointer goes through the surface's inverse homography into millimetres.
    - The magnet radius is the designer's 14 screen pixels, turned into millimetres where the finger is. The far end of a floor, which is smaller on screen, therefore gets a larger magnet in millimetres.
    - While dragging, the centreline, motif centres and edge cuts are drawn in perspective. Each label sits 30 px in from the middle of its edge.
74. **On a phone, zoom in for fine moves.** At fit size, 150 mm on a 2.4 m wall can be under the 8 px it takes for a touch to count as a drag. As in the designer, the magnets do most of the work at that size.
75. **Brush strokes are part of the design document**, so they are undoable, one step per stroke.
    - The radius is set in screen pixels when painting, so zooming in gives a finer brush.
    - Strokes are applied in order to the wall finder's region, at the working size.
    - The room lighting stays based on the wall finder's region, because brush strokes are small corrections.
76. **The tool bar shows for a tiled surface being edited.** Pattern is the default. With a brush selected, a tap paints a dot, and the cursor shows which tool is active.
77. **Double taps are timed by the touches' own timestamps**, not by when they are handled. A slow first tap (adding a surface) used to push the second past the double-tap window, so the photo didn't fit.
78. **Tapping a wall stays quick.**
    - A new surface's mask, lighting map and clip are made only when it is tiled (Done), and the region the tap found is reused.
    - The per-pixel loops (flood fill, feathering, box filter) no longer allocate per pixel, and they read memory in order.
    - In headless desktop Chrome, a tap that adds a surface went from about 480 ms to 120–150 ms. This should be checked again on a phone.

**Compare and share**

79. **Before / after is a line over the photo.**
    - The tiles show only to its right, clipped with CSS, so moving the line draws nothing again.
    - Outlines, colours and handles hide while comparing, and so does the hint at the top.
    - The line's handle is also a keyboard slider.
80. **Sharing in photo mode sends the photo with its tiles at the photo's own size** (up to 2048 px). The GPU draws the tiles again at that size for the picture.
    - Below the photo is the designer's summary strip, scaled to the photo's width, with one section per tiled surface. The footer notes that it is a preview, so sizes should be checked on site.
    - Shared or saved, leaving the page no longer asks first.
    - With nothing tiled yet, Share explains what to do first.
81. **No photo is uploaded, and a check proves it.** `photo-network` records every request in a whole session: a photo from the gallery, the wall finder, tiling a wall and sharing. It expects only GETs without bodies, to the site itself, Hugging Face (the model) and jsDelivr (the libraries). On the last run that was 5, 3 and 3 requests.
82. **Touch drags on page controls cancel `touchstart`, as the canvas does** (decision 29). Otherwise Chrome takes the drag for its own gesture and swallows the next tap's click. After the before/after line had been dragged, its button wouldn't turn off. The browser check found this on the phone.

**Corners over the wall finder**

83. **Your corners win when the wall finder disagrees with them.** On a real photo the finder labelled most of a plain grey wall as something else (probably a door, from its frame and number sign). The tiles used to follow the finder's area, so they only filled a thin strip of the corners.
    - Inside the corners, the tiles now go wherever the finder found that kind of surface. That counts all of it, not only the patch connected to the tap.
    - If the finder found less than 40% of the area inside the corners, it has most likely missed the surface, so the tiles fill the corners. A message suggests Remove for anything in front.
    - **Tiles cover** in the Photo tab overrides this either way, and is undoable. Room lighting is worked out over the same area.
    - On the sample bathroom the finder found most of the wall, so the bathtub still stays in front. Browser check `photo-cover` recreates the disagreement, and `photo-tiles` covers the normal case.

**A wall bigger than the photo**

These came from two photos of a real wall: a large textured one with stripes, photographed at an angle and close up. The photo used in the app was rebuilt from a screenshot of its regions, for measuring. Neither is in the repository.

84. **When a wall runs past the photo's edges, its own lines set the perspective.**
    - The problem: the wall finder's region reached every edge of the photo, so the fitted corners were just the photo's corners. The tiles came out flat, with their rows sloping the opposite way to the wall's stripes.
    - The app now finds the photo's straight lines with an LSD-style detector at 512 px (25–65 ms in headless desktop Chrome). From the lines on the wall it works out where the wall's horizontals meet, and where its verticals meet.
    - Verticals have to meet far off, at least 1.25 long sides from the centre. Otherwise they are taken as upright in the photo.
    - This applies when the region reaches the photo's top and bottom, or three of its edges. Reaching an edge means covering at least 30% of it, because things in front and misread patches often cover much of an edge.
    - A wall's size can't be read from a photo that doesn't show its edges. So the corners mark a rectangle along the wall's lines around the tap, snapped to the nearest lines, and the card asks for something of known size.
    - The first guess at the rectangle's size treats the visible wall as the designer's wall height, which is what corners on the photo's edges amounted to before. Its width-to-height comes from the lines and a typical phone camera (about 70° across the long side).
    - When a corner is dragged, the rectangle keeps to the lines: the opposite corner stays put and the other two slide towards the vanishing points. Switching to "The wall's edges" frees the corners again.
    - Without enough lines (a plain painted wall), the corners are fitted as before.
    - Tests:
      - Unit tests use a wall drawn at 35°. The vanishing point comes within 12 px of the true one (about 610 px off), and a rectangle's width-to-height within 0.1%.
      - Browser check `photo-lines` uses a generated striped wall with `?segmenter=fake-wall`. It checks that the rectangle follows the lines, before and after a drag.
    - Still open: a wall with a step in it (a pillar) is still one flat surface, so tap its main face.
85. **Nothing is drawn off the photo.** A wall's outline can now run far past the photo.
    - The tile shader drops fragments outside the photo, where the mask's edge pixels would otherwise repeat.
    - The outline and the guides are clipped to the photo.
    - `photo-lines` checks that just past each edge of the photo there are no tiles.

**Misread patches**

86. **Bits of wall the wall finder misread are filled back in.**
    - The problem, on the close-up: SegFormer-B0 took 15% of the photo, which was all wall, for a "screen door" (7%), a bathtub (3%), the floor and so on, leaving holes in the tiles.
    - A bigger model doesn't fix this. B2 (twice the download) missed 17%, and B1 more. B0 on WASM matched B0 on WebGPU. So the fix comes after the model.
    - The photo is cut into about 1,500 superpixels (SLIC at 512 px). Inside the corners, a patch not labelled as the surface joins it when it carries on from a neighbour already in:
      - mean colour within 8 (CIELAB);
      - similar texture;
      - no edge between them stronger than 1.6× the smoother one's texture.
    - The model's own probabilities guard against things in front. The guided filter already refines them to the photo's edges for the labels. It now also keeps each pixel's chance of being some surface (wall, floor or ceiling), one byte per pixel.
    - A patch with under a 20% chance stays out, unless the surface all but surrounds it (75% of its border).
    - A wall taken for floor counts as a surface, so it is filled.
    - Each group of added patches must blend into what's around it (no edge) along at least half of its border. That means the surface, and the rest of a misread patch. A thing in front has an edge against the wall and against whatever else it touches.
    - A misread patch lies among the surface and other unsure bits. A thing in front often touches things the model is sure aren't a surface. So if an unsure blob (added patches and the unsure bits joined to them) touches such things (under 10%) along a quarter of its border or more, its added patches are dropped.
    - The bath mixer is why that last rule exists:
      - Its chrome reflects the tiles, so it passes the colour, texture and edge tests. Even the refined chance makes it 27–29% surface.
      - The bottom of the starter rectangle cuts through it.
      - Two earlier versions tiled it, and `photo-tiles` caught both. It stays out now because it is set into the bath.
    - Specks wholly within the surface are filled too. These stay out:
      - slivers at a fixture's edge, which are joined to the fixture;
      - bits at the edge of the corners with no added patch in them, which may be the end of a thing the corners cut through.
    - Results:
      - On the close-up, the untiled share inside the corners went from 18% to 5.4%. What's left is the patch's tip and the area around a cable, which stays in front as it should.
      - On the sample bathroom, the mixer, basin and bath stay in front (`photo-tiles`). Even with the whole photo as the corners, nothing there is filled.
    - What didn't work:
      - Colour and edges alone, without the model's probabilities, filled more of the close-up, but also the bath mixer and a bin.
      - A wall-only probability threshold left the floor-labelled patch.
      - The model's coarse output (before the guided filter) blurs the wall into small things.
      - A per-pixel threshold can't separate the mixer from a misread patch: their chances overlap.
    - "Found" (for Automatic) still counts the finder's labels alone.
    - After Done, if more than 4% inside the corners is left untiled, a message suggests Add for any of it that is wall.
    - The superpixels are made once per photo, the first time a surface is tiled. Done takes about 250–450 ms in headless desktop Chrome, including the superpixels; this needs checking on a phone.

**Step 3a: AR test**

87. **A test on a real phone comes before full AR.** The AR test screen answers four questions before the full version is built:
    - Does the phone run WebXR AR at all?
    - Does it find walls as well as floors? Plain painted walls are hard for ARCore.
    - Do placed tiles stay put?
    - Which extras does it grant: depth (for things in front), lighting, anchors, plane detection?
88. **The AR screen stands apart from the app for now.** It is a separate screen (`?view=ar`, loaded only when asked for), built from the saved design, so the test barely touches the designer and photo mode. Step 3b brings AR into the app.
89. **AR draws the same tile mesh as photo mode, with the same grout.**
    - The tiles stay in surface millimetres; a matrix places them in the room in metres.
    - The mesh upload, tile textures and grout shader code are shared with the photo compositor.
    - A wall's "up" is the room's up. On a floor the design's "up" runs away from you, so it reads the right way round as you look down at it.
    - The surface normal is turned to face you, so a wall can't come out mirrored.
90. **Each placed square is anchored where the phone allows**, so tracking corrections move it with the room. The placement is kept relative to the anchor.
91. **The session asks for the most features first, then fewer.**
    - Depth sensing must name its data format, and the names have changed between versions of the spec. An unknown name fails the whole request.
    - So it tries, in order: everything with one name, everything with the other, everything but depth, then hit test and overlay only.
    - Chrome may want a fresh tap for a retry, so the screen then asks for one.
    - The report says which attempt worked and why the others failed.
92. **There are no WebXR type definitions in the dependencies.** TypeScript's DOM library leaves WebXR out, so `src/ar/webxr.d.ts` declares the few parts used.
93. **AR is tested in the browser with a stand-in for WebXR.**
    - Headless Chrome has no AR. Browser check `ar-fake` injects a fake session: the camera 1.5 m up, and a wall 2 m ahead that every hit test finds.
    - It runs the real screen, session code, maths and renderer. It checks the features asked for, the aim ("wall, 2.00 m away"), a tap placing an anchored square, and the GPU's pixel beside the ring, then Undo and the report after Exit.
    - `ar-unsupported` checks that a laptop gets the explanation.
    - Real tracking, frame rate and what the phone grants can only be seen on a phone.
94. **Nothing of a session is touched after it ends, and the report is kept on the phone.**
    - On the first phone test, AR started, found the wall and kept the tiles anchored, but Chrome crashed ("Aw, Snap") on Exit AR.
    - The likely cause: the code deleted the session's anchors and cancelled its hit test after the session had ended. Ending the session releases both anyway, so they are now left alone.
    - The report is saved on the phone every second and at the end, so it shows again after a crash and a reload. It is text only: no camera image is ever kept.

## Step 1 checklist

What "done" means for step 1, and how each item is verified. "Browser check" is a scenario in `scripts/check-scenarios.mjs`, run on the phone (real touch events) and on desktop.

| Item | Status | Evidence |
| --- | --- | --- |
| Opens with a "Highlighter band" wall in Demo Ivory Bloom, with no setup | Done | Browser check `opening-wall`; `pattern-drag` asserts the opening design |
| Pattern drag shifts the layout with snapping, and the edge-cut labels update live | Done | Snapping unit tests; browser check `pattern-drag` (mid-drag screenshot, snaps to centre-joint, undo/redo) |
| The medallion forms around its shared corner; the Ivory Bloom sprig continues across the HL-A/HL-B joint | Done | Engine tests on the corner rotations and on HL-B below HL-A; zoomed screenshots `medallion-joint` and `sprig-joint` |
| Bands reorder by dragging; tiles rotate and swap in Tile mode; rectangular tiles never turn 90° | Done | Browser checks `row-mode` and `tile-mode` (touch and mouse); unit tests reject 90° on 300 × 450 tiles |
| Switching to Floor changes the series and tile menu to floor tiles only | Done | Browser check `floor-mode` |
| "Suggest alignment" shows the slivers-versus-centred-motif trade-off for the medallion on a 2450 mm wall | Done | Suggestion unit tests; browser check `align-tab`, which also flips the priority |
| The Count tab matches the unit tests | Done | Browser check `count-tab`: 48 pieces / 51 tiles / 7 boxes left-aligned, and 42 full + 12 cut / 57 tiles / 8 boxes centred, the same as the engine tests |
| Share produces a PNG and works on an Android phone | PNG verified; **phone still to try** | Browser checks `share-download` (a real PNG file) and `share-api` (the PNG file reaches the Web Share API). Sharing to WhatsApp needs a real Android phone on the deployed HTTPS site. |
| All engine tests pass | Done | `npm test`: 97 tests (engine and state) |
| Dragging stays smooth on a mid-range Android phone | **Phone still to try** | Textures are built once and cached at several sizes, and frames are drawn only on change. Smoothness can't be judged in headless Chrome. |

## Step 2 checklist

What "done" means for step 2, and how each item is verified. Browser checks run on the phone (390 × 844, real touch events) and on desktop (1440 × 900), with the real wall finder on every photo in `public/samples/`. Timings come from headless desktop Chrome and say little about a phone.

| Item | Status | Evidence |
| --- | --- | --- |
| "Take photo" opens the camera on an Android phone, on the deployed HTTPS site; gallery and sample photos work on a laptop | Gallery and samples verified; **camera still to try** | Browser checks `photo-exif` (a gallery photo, turned upright), `photo-samples` (every sample) and `photo-network` (a gallery photo through the whole flow). The camera is a file input with `capture="environment"`, which needs a real phone. |
| Walls, floor and ceiling are labelled, and tapping a region switches to the matching Wall or Floor menus | Done | `photo-segment` on every sample (regions, legend, timings). In `photo-fit`, the Design tab offers wall series for a wall and floor series for the floor |
| Corner handles and dimensions fit the surface; tiles appear in correct perspective; grout lines stay straight; medallion and sprig motifs stay continuous | Done | `photo-fit` (corner drag with the loupe, undo and redo, real size), `photo-rectangle` (a known rectangle), and `photo-tiles` with its grout close-up. The perspective-correct mapping has unit tests. The sprig runs on unbroken across tiles in the shared picture |
| WC, basin and door stay in front of the tiles; the brush fixes mistakes | Done | `photo-tiles` reads GPU pixels: the tiles are opaque on the wall and transparent over the bathtub. `photo-edges` covers the guided filter at the basin and WC. In `photo-edit`, Remove hides tiles, undo brings them back, and Add tiles over a fixture |
| The Room lighting slider visibly keeps shadows and light falloff | Done; the effect is modest on the sample | `photo-tiles`: from 0% to 100% the tiles' brightness changes by up to 25 levels out of 255, with screenshots at both. Unit tests cover falloff and fixtures outside the surface |
| Dragging on the photo shifts the pattern with the same snapping and edge-cut labels as the designer | Done | `photo-edit`: a 150 mm drag snaps to a centred motif, as in the designer's own `pattern-drag`, with edge cuts and the centreline mid-drag. Both views use one action, which has unit tests |
| A floor and a wall in the same photo can use different series | Done | `photo-fit` and `photo-share-api` ("Wall: Demo Ivory Bloom · Floor: Demo Floor"), plus action tests |
| The before/after slider and Share PNG work | Done in the browser; **WhatsApp on a phone still to try** | `photo-compare` (drag and clip), `photo-share` (a 2048 px wide PNG with the summary) and `photo-share-api` (the file reaches the Web Share API) |
| The network panel shows no photo upload, only the one-time model download | Done | `photo-network`: GETs only and no request bodies, to the site, huggingface.co and cdn.jsdelivr.net |
| A wall bigger than the photo gets the right perspective; bits the wall finder misread don't leave holes (from testing on real photos) | Done on the two photos tested; **more real photos to try** | Decisions 84–86. `photo-lines` (lines on a generated wall, the rectangle kept to them while dragged, nothing off the photo); `photo-tiles` (fixtures still in front); unit tests for lines, vanishing points, the locked rectangle and the fill |
| All tests pass, including step 1's | Done | `npm test`: 201 tests. Browser check: 64 pages, no console errors |

The wall finder on the sample, in headless desktop Chrome: WebGPU fp16 about 3 s to load (the download already cached) and 3 s to run the first time; WASM about 2.3 s to run.

## Step 3 checklist

Step 3a is a test on a real phone; its answers shape 3b (the real thing) and 3c (realism).

| Item | Status | Evidence |
| --- | --- | --- |
| AR starts on an Android phone in Chrome, on the deployed HTTPS site | Done on the user's phone | Started on the first attempt, with every feature asked for. In the browser, `ar-fake` starts a session with a stand-in for WebXR |
| A ring appears on walls and on the floor | Done on the user's phone | Plane detection found 1 wall and 3 level surfaces; squares were placed on a wall and on the floor. `ar-fake`: "wall, 2.00 m away" |
| A tap places a 1 m square of the design, drawn in perspective with grout, and it stays put while walking around | Done on the user's phone: 3 squares placed, all anchored, and they stayed put | `ar-fake` reads the GPU's pixel beside the ring before and after the tap; unit tests for the surface frames, the mm-to-metre placement and anchors |
| The phone's features (depth, lighting, anchors, plane detection) and frame rate are known | Done on the user's phone | Granted: hit test, anchors, plane detection, light estimation, DOM overlay, and depth sensing (CPU, luminance-alpha). 30 fps with tracking "good". The first try crashed Chrome on Exit AR (decision 94); fixed |
| Where AR can't run, the screen says what it needs | Done | `ar-unsupported` (headless Chrome on a laptop) |
| All tests pass, including steps 1 and 2 | Done | `npm test`: 207 tests. Browser check: 68 pages, no console errors |
