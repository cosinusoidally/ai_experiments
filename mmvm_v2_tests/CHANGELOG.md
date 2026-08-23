# Changelog

This changelog records user-visible feature progress for the MMVM v2
JavaScript demos.

Versions are deliberately simple `0.x` progress releases, not semantic
versions. Every completed new feature or user-visible feature update advances
the point release by one (`0.1`, `0.2`, `0.3`, and so on). The major version
remains `0` for this development series.

## 0.28

Approximate completion: 2026-08-23 23:30 BST

### Demo 8 runner and NativeCompiler

- Added recursively compiled native function dependencies through explicit
  `function.nativeCompile.dependencies` name-to-function maps. Dependencies may
  declare further dependencies; the compiler handles nested, self-recursive,
  and mutually recursive graphs without returning through interpreted
  JavaScript at call boundaries.
- Added native `return` statements, internal stack arguments, left-to-right
  argument evaluation, relative native call fixups, and support for helpers
  with more than eight arguments. The external root retains its existing
  eight-argument FFI/specialization contract.
- Emit each specialized graph into one owned executable mapping. Destroying the
  compiled root releases every dependency together; macro-assembly dumps now
  show function labels and native calls, and each variant records its emitted
  function count.
- Added `native_compiler_dependencies_test.js`, compatible with Node.js and
  `js_min.exe`. The native run validates seven recursively collected functions,
  nested calls, mutual recursion, nine internal arguments, return values,
  evaluation order, destruction, and declaration errors. Existing Demo 8
  single-function rasterizers continue to initialize and pass their comparison
  test unchanged.

## 0.27

Approximate completion: 2026-08-23 23:00 BST

### Demo 8

- Removed the 0.24 car-local quadrant culling in full. The complete body shell,
  both sides and ends, all window panes and trim, front and rear details, and
  all four complete wheels are submitted at every camera angle. The depth
  buffer is again the sole visibility authority for the detailed saloon.
- Identified the underlying scratch-mesh regression: `project()` caches its
  result on a world-point object for the current frame. Reusing a mutable point
  without invalidation made later wheels reuse the back-left wheel's projected
  coordinates, explaining why only that tread remained visible.
- Added explicit projection-cache invalidation to every mutable car and wheel
  point transformation. Quad, box, window, and wheel scratch objects can now be
  reused without changing geometry or screen coordinates.
- Retained only topology-preserving wheel work: precomputed circle values,
  shared segment endpoints, 29 rather than 50 point transforms per wheel, and
  allocation-free scratch rings. At 320x240 with a 20 FPS limit, representative
  measurements reached about 15.5 FPS in free drive and 14.0-14.3 FPS in the
  garage with the complete model restored.

## 0.26

Approximate completion: 2026-08-23 22:30 BST

### Demo 8

- Restored all four complete wheel assemblies at every camera angle. Each now
  always submits its full double-sided tread ring, outside sidewall, and hub;
  the depth buffer handles occlusion by the carved body shell.
- Removed the remaining far-diagonal wheel and far-side disc culls because
  open arches, narrow tyres, and steering made them visibly discontinuous at
  oblique views. Retained precomputed circle values, shared ring vertices,
  scratch-object reuse, and the reduction from 50 to 29 point transforms per
  wheel.

## 0.25

Approximate completion: 2026-08-23 22:15 BST

### Demo 8

- Restored the complete double-sided tyre tread rings. The 0.24 generic
  back-face test could reject visible tread because wheel-side orientation and
  front-wheel steering change a tread quad's apparent winding.
- Retained the safe wheel optimizations: precomputed circle values, shared
  segment vertices, reusable scratch rings, reduced point transformations, and
  rejection of only the far-diagonal wheel.

## 0.24

Approximate completion: 2026-08-23 22:00 BST

### Demo 8

- Added object-space visibility selection to the detailed saloon. The renderer
  no longer submits its permanently hidden floor, far body side, far end,
  opposite glass, trim, lamps, or bumper to projection, clipping, and the
  z-buffer. Box details similarly submit only their top, near side, and near
  end faces; the visible model and texture resolution are unchanged.
- Corrected an initially over-aggressive two-wheel view-dot cull. Open wheel
  arches expose a third wheel at oblique angles, so the final rule rejects only
  the far diagonal wheel. Near-side sidewalls and hubs remain detailed, while
  the far-side exposed wheel submits its visible tread without a hidden outward
  face.
- Precomputed the eight-segment wheel circle, reused adjacent ring vertices,
  enabled back-face rejection on the opaque tread, and changed the wheel mesh
  to reuse preallocated scratch points. Each visible wheel now needs 29 rather
  than 50 local-to-world point transformations and creates no ring arrays or
  point objects during a frame.
- At 320x240 with a 20 FPS limit under `js_min.exe`, representative free-drive
  samples improved from about 14.1-14.4 FPS to 19.3-19.4 FPS, with individual
  intervals and the on-screen counter reaching the 20 FPS cap. Representative
  garage views improved from about 13.3-13.6 FPS to approximately 18 FPS. A
  runtime compiled-native -> JavaScript -> hand-ASM -> compiled-native cycle
  completed successfully after the changes.

## 0.23

Approximate completion: 2026-08-23 21:30 BST

### Demo 8

- Replaced coarse flat-color window subdivision with proper per-pixel texture
  mapping on all six panes of the detailed saloon in garage and free-drive
  modes. Each pane is two textured triangles sharing the normal depth buffer.
- Derived sky coordinates at the transformed window vertices from camera view
  vectors and reflected pane normals. The rasterizer perspective-corrects them
  by interpolating `u/z`, `v/z`, and `1/z`, then performs explicitly
  nearest-neighbour sampling from the wrapping procedural sky texture.
- Compiled the hot `windowTextureTriangleJS` bounding-box/edge/depth/texture
  loop through NativeCompiler. There is no hand-generated machine code. The
  complete car uses 12 textured window triangles instead of the discarded
  36-quad approximation.
- Changed the deterministic cloud synthesis to four anisotropy-compensated
  octaves with square high-frequency billows. The visible sky now forms compact
  mottled cloud banks rather than horizontal wisps, and the 512x64 texture has
  enough local detail to produce dense window reflections.
- At 320x240, the final build measured about 14.1-14.4 FPS in free drive and
  13.3-13.6 FPS through representative garage views. Procedural texture
  generation measured about 1.9-2.0 seconds and total initialization about
  3.4-3.7 seconds under `js_min.exe`.

## 0.22

Approximate completion: 2026-08-23 20:50 BST

### Demo 8

- Added a deterministic procedurally generated cloudy grey skybox texture to
  free-drive mode. Three wrapping value-noise octaves create layered slate,
  silver, and blue-grey clouds in a 512x64 in-memory panorama; no bitmap asset
  is stored or loaded.
- Mapped camera heading and horizontal field of view into the wrapping texture,
  with the vertical texture scaled to the pitched ground-plane horizon.
- Replaced an initial 2048x128 interpreted generation and per-row FFI design
  with the compact texture and a one-call nearest-neighbour blitter compiled
  from `freeDriveSkyboxBlitJS` by the existing NativeCompiler. At 320x240,
  texture generation fell from about 10.9 seconds to about 1.4 seconds and total
  initialization measured about 2.9-3.0 seconds.
- An A/B run at 320x240 found approximately 14.4-15.1 FPS with the sky enabled
  and 14.8-15.0 FPS with its draw call disabled. The sky pass therefore had no
  measurable effect on the existing free-drive rendering ceiling.

## 0.21

Approximate completion: 2026-08-23 20:25 BST

### Demo 8

- Added suspension-style body roll to the detailed saloon in free-drive mode.
  The roll target comes from the tyre model's actual lateral acceleration, so
  it depends on speed, grip, and sliding rather than steering input alone.
- Added a damped roll spring with a roughly +/-6.9-degree normal target and
  +/-8-degree safety limit. The sprung shell, glass, trim, lights, and bumpers
  tilt around a low longitudinal axis while the wheels remain upright.
- Converted every box-shaped detail on the saloon to the same rolled local-body
  transform, preventing the bonnet, boot, roof, lamps, or bumpers from becoming
  detached while the body leans.

## 0.20

Approximate completion: 2026-08-23 20:05 BST

### Demo 8

- Replaced the detailed saloon's solid lower body box with a body shell whose
  side-panel triangles are built around four real semicircular wheel openings.
  No body triangles are emitted inside those openings.
- Removed the external wheel-arch lips introduced in 0.19 and added recessed
  dark inner liners connected directly to the cut edges of the body shell.
- Returned all four thin 0.11-unit tyres to equal +/-0.80 wheel centres. The
  tyres are tucked nearly flush with the body again while the carved openings
  provide clearance for visible front steering. The 0.33-unit arch radius sits
  around the 0.32-unit tyre radius and meets the top of the lower shell without
  inverted or overlapping side-panel strips.

## 0.19

Approximate completion: 2026-08-23 19:45 BST

### Demo 8

- Corrected the equal-track wheel adjustment so it does not embed the detailed
  saloon's tyres in its solid body shell. Both axles now use wheel centres at
  +/-0.91: the front returns to its original clearance and the rear moves out to
  match it.
- Retained the thin 0.11-unit tread, visible front steering, and equal front and
  rear protrusion.
- Added body-coloured upper wheel-arch lips which visibly overlap the tyre edges,
  preventing the tyres from appearing to cut through the box-shaped side panels.

## 0.18

Approximate completion: 2026-08-23 19:28 BST

### Demo 8

- Moved the detailed saloon's front wheel centres inboard from +/-0.91 to
  +/-0.80, matching the rear axle. All four straight-ahead 0.11-unit tyres now
  have outer faces at approximately +/-0.855 and sit nearly flush with the body;
  the front wheels no longer protrude farther than the rear wheels.
- Retained visible front steering through the existing wheel-yaw geometry and
  travel-facing camera: during a turn, body yaw exposes the steered tyres without
  requiring an artificially wider front track.

## 0.17

Approximate completion: 2026-08-23 19:25 BST

### Demo 8

- Halved the detailed saloon tyre tread again, from 0.22 to 0.11 total
  simulation units. The tyres are now approximately 69 percent narrower than
  their original 0.36-unit form while retaining the 0.64-unit diameter.
- Moved the rear wheel centres slightly inboard from +/-0.83 to +/-0.80 so their
  outer faces sit nearly flush with the body. Retained the established +/-0.91
  front centres so the much thinner front tyres remain visible when steering,
  without restoring their former toy-like width.

## 0.16

Approximate completion: 2026-08-23 19:11 BST

### Demo 8

- Made the source-compiled native i386 triangle-half rasterizer the default at
  startup. F2 still retains all three implementations and now cycles from the
  default through JavaScript reference, hand-written ASM, and back to compiled
  native for direct correctness and performance comparisons.
- Reduced the detailed saloon tyre tread from 0.36 to 0.22 total simulation
  units, approximately 39 percent. Kept the 0.64-unit diameter, hubs, axle
  positions, and independently steerable front-wheel geometry unchanged.

## 0.15

Approximate completion: 2026-08-23 19:03 BST

### Demo 8

- Replaced the brake-held powerslide switch with a two-axle vehicle model.
  Front and rear slip velocities now generate independent lateral tyre forces
  and yaw torque, and `POWER SLIDE` is derived from measured lateral motion and
  yaw rather than control state.
- Made the rally saloon rear-wheel drive. Braking at forward speed transfers
  load away from the rear axle for a short-lived grip loss; after brake release,
  rear drive consumes part of the slipping tyres' traction budget so reapplied
  throttle can sustain the slide. Lifting power restores rear grip, while front
  tyre force makes countersteering arrest the yaw.
- Added hysteresis to physical slide detection, retained ordinary powered
  cornering and reverse steering, and preserved stationary and perimeter
  behavior. A high-speed full-throttle turn can also induce power oversteer
  without braking, as expected for rear-wheel drive.
- Expanded the checkerboard from 160-by-128 to 200-by-160 units to provide
  useful runoff for slide testing. Changed its squares from 16 to 20 units,
  keeping visible geometry cost bounded through the existing frustum rejection.

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
