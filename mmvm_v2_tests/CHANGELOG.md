# Changelog

This changelog records user-visible changes to the MMVM v2 JavaScript demos.

## Unreleased

### Demo 8

- Added an Escape pause menu. A second Escape resumes the current state without
  resetting it. The explicit `R RESTART GAME` item resets all race state and
  returns to rolling attract mode with `PUSH SPACE TO PLAY`; `G` opens the
  garage, `F` starts free driving, and `Q` exits.
- Added a garage scene rendered through demo8's software rasterizer. Its camera
  automatically follows an elliptical orbit with sinusoidal vertical motion.
  Holding mouse button 1 and dragging takes direct control of orbit angle and
  camera height; automatic motion resumes after release.
- Added free driving on a fixed 90-by-68-unit muddy field with deterministic
  surface variation, puddles, boundary posts, automatic-style vehicle physics,
  and collision handling at the field boundary.
- Extended the JavaScript-only X11 test driver with named key sequences,
  button-1 drags, and timed key holds. These controls work under both Node.js
  and `js_min.exe` through `node_runner.js`.
- Added a dedicated five-character-wide menu layout for demo8's supported
  64-pixel minimum framebuffer width.
- Made demo8's bitmap text scale proportionally with the viewport. The
  320x240 presentation remains the 2x baseline, smaller displays use the 1x
  source glyph, and larger displays select a correspondingly larger integral
  scale; HUD, loading, garage, FPS, and menu layout share the same metrics.
