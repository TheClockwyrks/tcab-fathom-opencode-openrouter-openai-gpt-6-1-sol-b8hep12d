# Fathom · Kindle

A bioluminescent maze chase in the deep ocean. Graze every plankton mote to descend, send sonar around blind corners, and leave ink between yourself and the hunters. Eating makes your light brighter and your circular window larger. It also makes you easier to find.

The Lanternjaw follows light while disguising itself as a harmless amber drifter. The eyeless Gloamfin hears your sonar and answers with its own. The Flarefish briefly illuminates the trench, then hunts whatever its flash finds.

## Run locally

Requires a current Node.js release supported by Vite (Node 22.12+ recommended).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Everything runs in the browser, with no backend, credentials, external fonts, or runtime services.

## Production

```sh
npm ci
npm run build
npm run preview
```

The complete static site is in `dist/`, with `index.html` at its root. Serve that directory directly, either at a host’s root or under a sub-path. All scripts and art resolve relative to the page.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Swim while held; release to stop |
| Space | Sonar pulse |
| Left / right Shift | Release ink |
| Escape / P | Pause or resume |
| M | Toggle sound |
| Up / down | Select a menu item |
| Enter / Space | Confirm a menu item |
| Escape | Return from the field guide or game-over screen |
| Pointer / touch | Select and confirm menus |
| Backtick | Toggle the engine’s read-only diagnostics |

Touch controls appear automatically on touch devices. Sonar and ink are unlimited, with cooldown gauges below the maze. Three reserve lives mean four attempts; eaten plankton and explored terrain survive a catch. Deeper mazes introduce more hunters and shorter sonar reach.

## Development and verification

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

The game runs on Simple 2D. Its immutable state, 120 Hz simulation, and debug poses are separate from canvas rendering. Tests run the engine over a native canvas and scripted clocks, and also exercise the render-free core. Coverage and test reports are written to `coverage/`.

- `src/game.ts` — engine registrations, asset loading, and the exported game/types.
- `src/world.ts` — maze, geometry, tile-locked travel, pathfinding, and state construction.
- `src/simulation.ts` — fixed-step sensing, hunting, effects, scoring, and progression.
- `src/debug.ts` — validated state poses and JSON snapshots, available through `engine.debug`.
- `src/menus.ts` — action-driven screens and pointer hit regions.
- `src/render.ts` — art, fog, effects, HUD, and screen presentation.
- `showcase/` — player-facing description, screenshots, and a recorded live dive.

The engine owns input, audio synthesis, asset URLs, canvas fitting, the frame loop, diagnostics, and draw-command recording. No debug handle is installed on the page.
