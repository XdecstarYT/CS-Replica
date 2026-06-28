# Metropolis — a mobile city builder

An original, touch-first city-building game inspired by the *Cities: Skylines*
genre. It runs entirely in a mobile (or desktop) web browser — no install, no
build step, no engine download.

> **Note on scope.** This is **not** a copy of *Cities: Skylines 2*. That game
> is a large, proprietary 3D title owned by Colossal Order / Paradox Interactive,
> and reproducing it exactly is neither legal nor technically possible in a web
> page. *Metropolis* is an independent game that captures the core *ideas* of the
> genre — zoning, road-driven growth, RCI demand, services, and a city budget —
> in a lightweight form that plays well on a phone.

## Play

Open `index.html` in any modern browser, or serve the folder and visit it on
your phone (same Wi‑Fi):

```bash
# from the repo root
python3 -m http.server 8000
# then on your phone, browse to  http://<your-computer-ip>:8000
```

Add it to your home screen (Safari/Chrome → "Add to Home Screen") for a
full-screen, app-like experience.

## How to play

1. **Roads first.** Buildings only grow on zoned tiles next to a road.
2. **Zone** Residential (green), Commercial (blue), and Industrial (yellow)
   land by dragging along your roads.
3. Citizens move in based on **demand** — the R/C/I bars on the left.
   Residents want jobs; shops want customers; industry wants workers.
4. **Services** (power, water, police, fire, health, schools, parks) raise land
   value and happiness within their radius. Buildings need power/water to grow.
5. Keep an eye on the **budget** (top-left). Services charge weekly upkeep;
   taxes scale with population and happiness. Don't go bankrupt.

### Controls (touch & mouse)
- **Drag** an empty area to pan; **pinch** / **mouse wheel** to zoom.
- Pick a tool from the bottom bar, then **tap or drag** on the map to build.
- **Demolish** removes roads, zones and service buildings.
- Tap the **play/pause** chip (top-right) to change game speed.
- The **☰ menu** has Save / Load / New City / Help. The city autosaves every
  30 seconds to your browser's local storage.

## Project layout

```
index.html        markup + HUD
css/style.css     mobile-first styling, safe-area aware
js/config.js      tunable constants, tile types, building definitions
js/grid.js        map data model + terrain generation
js/simulation.js  economy: coverage, RCI demand, growth, budget
js/render.js      top-down canvas renderer + camera
js/input.js       pointer/touch: pan, pinch-zoom, drag-paint
js/ui.js          HUD, panels, toasts
js/game.js        main controller, game loop, save/load
```

## Tech

Vanilla JavaScript + HTML5 Canvas. No dependencies, no bundler. Designed to be
read and modified easily.

## License / assets

All code and visuals here are original. Building "art" is drawn procedurally
with canvas primitives and emoji icons — no third-party game assets are used.
