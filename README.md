# Catan Lab

A constraint-driven map generator for Settlers of Catan. Produces balanced boards by default, or harsh "challenge" boards that bend the math in a specific direction (scarcity of a resource, boom-or-bust concentration, low-yield dead zones). Every map is reproducible from its seed and shareable via URL.

Live: <https://catan.ntblabs.dev>

## What it does

- **Generate balanced base-game or 5–6 expansion boards.** Snake-draft fairness is enforced — the simulated first two picks for every player land within a tight standard deviation of each other.
- **Enforce the standard Catan placement rules** as hard constraints (no same numbers adjacent, no multiple reds on a resource, etc.) with per-rule toggles.
- **Optional challenge modes:**
  - *Scarcity*: pick a resource that stays starved all game.
  - *Boom-or-bust*: pick a resource whose pips concentrate on a single number.
  - *Drought*: produces a cluster of three adjacent low-yield hexes you have to plan around.
  - *Rich vs Poor*: one half of the board is rich (every number token worth 4+ pips), the other half is poor. The board draws the dividing line and labels both sides.
  - *Hot zone*: red numbers (6/8) cluster into one contested region, at least four connected hexes on the base board and five on the 5–6 expansion. The cluster is outlined on the board.
  - *Random*: picks one of the five above at generation time. The Analyze view reports which one rolled.
- **Shareable URLs.** A link carries a seed plus the variant flags, bit-packed into 7 bytes, and the board is regenerated from them rather than serialized. That is what keeps the hash to 10 characters. It also makes determinism a hard contract: any change to placement, gating, or RNG call order silently invalidates every link ever shared.
- **Image export / share.** Save the current board as a PNG (with the seed stamped on it), or — on mobile — push it straight to the native share sheet to drop into a group chat.
- **Annotation overlays.** Toggle a snake-draft top-N pick visualization (rank rings + spot-value scores + city/road synergy markers) and a per-resource health readout (pip totals, concentration percentage, healthy/warning/unhealthy status).
- **Mobile-first UI.** Bottom drawer drags 1:1 with your finger and snaps to open/closed on release. The board itself supports pinch-zoom and drag-pan, with a hybrid CSS+SVG transform pipeline that stays sharp at rest and stays smooth during gestures.

## Stack

- **React 18** + **TypeScript** for UI
- **Vite** for build/dev
- **Zustand** for state
- **@use-gesture/react** for pointer/touch gestures
- **Vitest** for the unit tests, covering the generator and the pan/zoom controller
- The board is rendered as inline SVG — no canvas, no images.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle in dist/
npm run preview      # serve the production bundle locally
npm test             # run the unit tests
```

Vite dev server is bound to `host: true`, so you can reach it from your phone on the same Wi-Fi at `http://<your-machine-ip>:5173` — useful when iterating on the mobile UI.

## Project layout

```
src/
├── game/             # Game-domain primitives: types, coordinates, constants, layouts
├── generator/        # Map generation, constraints, scoring, fairness simulation
├── state/            # Zustand store
├── ui/               # React components (Board, Controls, TileIcon) + CSS
└── url/              # URL encode/decode for shareable maps
tests/                # Vitest unit tests, plus env-gated stress harnesses
```

## Hosting

The site is served from the custom domain `catan.ntblabs.dev` by GitHub Pages. `vite.config.ts` sets `base: '/'` because the site lives at the root of that domain. `public/CNAME` carries the domain and is copied into `dist/` on every build, which is what stops Pages from resetting the custom domain on each deploy. The included `.github/workflows/deploy.yml` builds on every push to `main` and publishes the result.

To host at a subpath instead, change `base` to `'/<repo-name>/'` and remove `public/CNAME`.

## Architecture notes

For a deeper dive into how the generator, scoring, and rendering work — and notes on the iOS Safari quirks the mobile build had to navigate — see [ARCHITECTURE.md](./ARCHITECTURE.md).

## License

MIT — see [LICENSE](./LICENSE).

Catan is the trademark of Catan Studio / KOSMOS. This project is an unaffiliated fan tool.
