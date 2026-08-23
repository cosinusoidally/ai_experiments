# Changelog

This changelog records user-visible feature progress for the MMVM v2
JavaScript demos.

Versions are deliberately simple `0.x` progress releases, not semantic
versions. Every completed new feature or user-visible feature update advances
the point release by one (`0.1`, `0.2`, `0.3`, and so on). The major version
remains `0` for this development series.

## 0.14

Approximate completion: 2026-08-23 18:45 BST

### Demo 8

- Replaced the free-driving outer-boundary centre-point clamp with collision
  limits derived from the saloon's rotated width and length. The complete body,
  wheels, and bumpers now remain inside every side and corner of the field.
- Removed outward velocity on perimeter contact while retaining the tangential
  component. Sustained throttle into an edge stops the car without repeatedly
  bouncing it across the boundary; glancing motion can continue along the edge,
  and reversing pulls the car back into the field normally.
- Kept the internal painted test-course lines non-colliding. Only the visible
  outer perimeter bounds free driving.

## 0.13

Approximate completion: 2026-08-23 18:39 BST

### Demo 8

- Expanded the free-driving field from 90-by-68 to 160-by-128 simulation units
  and replaced its subtle four-shade surface with a clearly alternating
  dark/light brown checkerboard of 16-unit squares.
- Painted two pale course-edge lines and a start/finish stripe directly onto
  the field, using a coarse version of the reproducible rally-course outline.
  The paint changes neither collision nor tyre grip, so the car can cross it or
  ignore it and continue free driving anywhere inside the outer field boundary.
- Moved the free-drive reset position to the painted start line and aligned the
  car with the course tangent. Added camera-frustum rejection for checker tiles
  and paint sections so the larger presentation remains near the 20 FPS target
  under `js_min.exe` at 320x240.

## 0.12

Approximate completion: 2026-08-23 18:13 BST

### Demo 8

- Fixed reverse drive repeatedly alternating between reverse acceleration and
  braking once it passed walking pace. Holding Down, S, or Space at low speed
  now supplies continuous reverse torque up to a 14-unit reverse-speed limit,
  doubled from 7, with stronger initial acceleration.
- Increased reverse steering authority by 50 percent while keeping yaw
  proportional to actual longitudinal motion. The car still cannot rotate in
  place, but it now develops a useful reverse turning arc promptly.
- Restricted brake-assisted rear-grip release to forward motion. Reverse and
  brake share an input, so this prevents ordinary reversing with steering from
  being misclassified as a powerslide; forward powerslides continue to work.

## 0.11

Approximate completion: 2026-08-23 18:03 BST

### Demo 8

- Replaced free drive's scalar movement with longitudinal and lateral velocity,
  tyre grip, inertial yaw rate, and velocity-aware boundary impacts. Turning
  the front wheels while stationary no longer rotates the body; vehicle yaw now
  requires actual forward or reverse motion.
- Added controllable powerslides. Brake with Space, Down, or S while steering
  above a modest road speed to release rear lateral grip; momentum continues
  along the previous trajectory while the body rotates, and grip progressively
  returns when the brake or steering is released.
- Made the travel-facing camera follow the real velocity vector, added a
  `POWER SLIDE` HUD indicator, and added slide start/end messages when debug
  event logging is enabled.

## 0.10

Approximate completion: 2026-08-23 17:51 BST

### Demo 8

- Decoupled the muddy-field camera heading from the saloon's body heading. The
  camera now follows a smoothed recent direction of travel, so steering visibly
  yaws the car relative to the view instead of rotating car and camera as one
  rigid unit.
- Made camera-heading convergence depend on wall-clock elapsed time, preserving
  the same turn-following behaviour at different requested and achieved frame
  rates. At rest the camera retains the last direction in which the car moved.

## 0.9

Approximate completion: 2026-08-23 17:42 BST

### Demo 8

- Fixed front-wheel steering in free drive. The visual steering-state update
  had accidentally been placed in rally physics, so free drive left the
  detailed model's wheel angle at zero even while the car itself turned.
- Moved the update into the free-drive physics step, increased visible steering
  lock to approximately +/-35.5 degrees, and moved the front tyres slightly
  farther outboard so their yaw is readable from the chase camera.
- Verified distinct held-left, centred, and held-right wheel geometry, smooth
  return to centre, and matching vehicle/wheel turn direction.

## 0.8

Approximate completion: 2026-08-23 17:37 BST

### Demo 8

- Reused the detailed 1970s two-door saloon model for the player's car in
  free-driving mode. Rally mode retains its lightweight player and AI models.
- Made the two front wheels yaw with free-drive left/right input while the rear
  wheels remain aligned with the body. Steering eases toward approximately
  +/-27.5 degrees and returns smoothly to centre when input is released.
- Rotated each front tyre's tread, sidewall, and hub geometry around the wheel's
  own vertical centre, so steering does not move the axle attachment points.

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
