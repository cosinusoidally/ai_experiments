# Changelog

This changelog records user-visible feature progress for the MMVM v2
JavaScript demos.

Versions are deliberately simple `0.x` progress releases, not semantic
versions. Every completed new feature or user-visible feature update advances
the point release by one (`0.1`, `0.2`, `0.3`, and so on). The major version
remains `0` for this development series.

## 0.7

Approximate completion: 2026-08-23 17:33 BST

### Demo 8

- Corrected the garage saloon's side windows, which previously kept the wider
  sill width all the way to the roof and appeared to splay outward.
- Moved the upper side-glass edges and upper A/B/C-pillar vertices inward to
  meet the narrower roof and front/rear window surrounds. The lower sills stay
  at body width, producing the intended inward cabin taper on both sides.

## 0.6

Approximate completion: 2026-08-23 17:27 BST

### Demo 8

- Replaced the garage's lightweight rally-car representation with a detailed,
  boxy 1970s two-door rally saloon sized for four occupants, while leaving the
  performance-sensitive race and AI car path unchanged.
- Added four octagonal tyres with contrasting metal hubs, separate unlit front
  and rear lamp units, sloped windscreen and rear glass, divided side windows,
  painted external window surrounds and A/B/C pillars, and a highlighted
  painted-metal roof skin.
- Added a long wheelbase and cabin, distinct bonnet and boot, one outlined long
  door and handle per side, fixed rear quarter windows, a rectangular grille,
  and bright period-style bumpers. No rear-door seams or handles are present.

## 0.5

Approximate completion: 2026-08-23 17:14 BST

### Demo 8

- Changed `R RESTART GAME` to reset the race and return to rolling attract
  mode with `PUSH SPACE TO PLAY`. Space then starts a freshly reset
  human-controlled race.
- Defined Escape followed by Escape as pause/resume: the first press opens the
  menu and freezes the current mode; the second closes it and resumes without
  resetting player, AI, race, garage, or free-drive state.

## 0.4

Approximate completion: 2026-08-23 17:10 BST

### Demo 8

- Added the explicit `R RESTART GAME` label to the full pause menu and updated
  its help text and documentation.

## 0.3

Approximate completion: 2026-08-23 17:03 BST

### Demo 8

- Made the built-in 5x7 bitmap font scale proportionally with the viewport.
  The 320x240 presentation remains the 2x baseline, smaller displays use the
  1x source glyph, and larger displays select a correspondingly larger
  integral scale.
- Applied the same scaled glyph, character-advance, and line metrics to the
  HUD, loading screen, garage label, FPS counter, and menu layout.

## 0.2

Approximate completion: 2026-08-23 16:59 BST

### Demo 8

- Added a dedicated compact menu layout for demo8's supported 64-pixel minimum
  framebuffer width.

## 0.1

Approximate completion: 2026-08-23 16:58 BST

### Demo 8

- Added an Escape pause menu with resume, race restart, garage, free-drive,
  and quit actions.
- Added a garage scene rendered through demo8's software rasterizer. Its camera
  follows an elliptical automatic orbit with sinusoidal vertical motion.
  Holding mouse button 1 and dragging controls orbit angle and camera height;
  automatic motion resumes after release.
- Added free driving on a fixed 90-by-68-unit muddy field with deterministic
  surface variation, puddles, boundary posts, automatic-style vehicle physics,
  and collision handling at the field boundary.
- Extended the JavaScript-only X11 test driver with named key sequences,
  button-1 drags, and timed key holds. These controls work under both Node.js
  and `js_min.exe` through `node_runner.js`.
