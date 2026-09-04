# Catan Lab

A constraint-driven board generator for Settlers of Catan that runs entirely in
your browser. It produces balanced boards for 3 to 6 players, or deliberately
harsh scenario boards that bend the math in one direction. Every board is
reproducible from its seed and shareable as a short link.

Live: <https://catan.ntblabs.dev>

## What it does that other generators do not

Every generator can shuffle hexes and check the placement rules. Catan Lab
does two things past that.

**Scenarios are generation targets, not filters.** Scarcity, Boom-or-bust,
Drought, Rich vs Poor, and Hot Zone are boards built to a specific shape of
pressure, each bending the math in a named direction while keeping the rest
of the board legal. They are not random boards that happened to come out
lopsided.

**Fairness is proved, not asserted.** Balanced boards score every
intersection, simulate the opening snake draft, and are only accepted when
the simulated first two picks for every player land within a tight standard
deviation of each other. They also clear resource health, port balance,
spatial pip distribution, and strategic diversity gates. If nothing clears
the bar within the attempt budget you get the best board found and a notice
saying so, rather than a silent compromise.

## Generating a board

Pick a player count from 3 to 6. Three and four players get the 19 hex base
board, five and six get the 30 hex expansion board.

Every board, in every mode, satisfies these rules:

- No two hexes of the same resource touch.
- No two red numbers (6 and 8) touch. Hot Zone is the one scenario that relaxes
  this on purpose.
- No intersection touches three high yield numbers at once.
- No port type appears more often than the box allows.

### Options

- **Include desert.** On by default for 3 to 4 players. Turn it off and the
  desert is swapped for a resource you choose, the extra hex gets the number 4,
  and the robber starts off board. The 5 to 6 expansion always uses two deserts,
  so the toggle is fixed there.
- **Shuffle ports.** Off by default, which uses the canonical 5th edition
  arrangement from the box. On, port positions are randomized each generation.
- **Water frame.** A sea border so ports sit on water. Purely visual, toggles
  instantly, and does not change the board or the share link.
- **No same numbers adjacent.** On by default. Two touching hexes cannot share a
  number.
- **No same number on same resource.** On by default. Stops two 5s on brick or
  two 9s on wheat.
- **Spread reds across resources.** On by default. Distributes 6s and 8s so no
  single resource hogs the high yield numbers (one red per resource on the base
  board, two on the expansion).

The last three are best effort. If a constraint cannot be satisfied, the
generator returns its closest attempt rather than failing.

## Scenarios

Balanced is the default. The scenarios below trade balance for a specific kind
of pressure, and each one keeps a deliberately different subset of the balance
checks so the scenario can actually happen.

| Scenario | What the board guarantees |
| --- | --- |
| **Balanced** | The default. Full fairness, resource health, port balance, spatial pip balance, and strategic diversity checks all apply. |
| **Scarcity** | One resource is starved to 4 total pips or fewer, so it stays rare all game. Choose the resource or leave it on Any. |
| **Boom-or-bust** | One resource puts at least 60 percent of its pips on a single number. When it rolls, boom. When it doesn't, bust. |
| **Drought** | At least three mutually adjacent hexes all carry low yield numbers (2, 3, 11, 12), creating a dead zone you have to plan around. |
| **Rich vs Poor** | One of the three board axes splits the map. The rich side holds at least 65 percent of the pip mass and every numbered hex on it is worth 4 or more pips. The board draws the dividing line and labels both sides. |
| **Hot Zone** | Red numbers (6 and 8) form one connected cluster, at least four hexes on the base board and five on the expansion, spanning three or more resources. The cluster is outlined on the board. |
| **Random** | Rolls one of the five scenarios above at generation time. The Analyze view reports which one landed. |

Scarcity and Boom-or-bust let you name the target resource. The others pick
their own geometry.

## Reading the board

Three layers of analysis sit on top of the board, each behind its own toggle.

- **Best locations.** Overlays the simulated snake draft: the top ranked
  settlement spots with rank rings, spot value scores, and markers for city and
  road synergy.
- **Resource health.** Per resource pip totals, how concentrated each resource
  is on a single number, and a healthy, warning, or unhealthy verdict, alongside
  the snake draft fairness numbers.
- **Advanced diagnostics.** Adjacent resource pair distribution against
  expectation, strategic viability, the archetype mix across the top spots, the
  strongest port economy openings, and port hinterland support.

The board itself pans, pinch zooms, and rotates in 30 degree steps. Rotation is
view only and does not affect the board or the link.

## Sharing and export

- **Share link.** A link carries the seed plus the variant flags, bit packed
  into 7 bytes, which is 10 characters of base64url in the URL hash. The board
  is regenerated from those, never serialized, which is what keeps the link
  short.
- **Send to.** Copy the link, or hand it to WhatsApp, Telegram, Reddit, or
  email. On mobile the native share sheet reaches everything else, including
  iMessage, Discord, and Slack.
- **Save image.** Downloads the current board as a PNG with the seed stamped in
  the corner. It always downloads rather than routing through the share sheet,
  on desktop and on iOS alike.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle in dist/
npm run preview      # serve the production bundle locally
npm test             # run the unit tests
npm run build:og     # re-render public/og.png from public/og.svg
```

The dev server binds with `host: true`, so a phone on the same Wi-Fi can reach
it at `http://<your-machine-ip>:5173`. That is the fastest way to iterate on the
mobile UI.

## Stack

- **React 18** and **TypeScript** for the UI
- **Vite** for build and dev
- **Zustand** for state
- **@use-gesture/react** for pointer and touch gestures
- **Vitest** for the unit tests, covering the generator and the pan/zoom
  controller

The board is inline SVG. No canvas and no images in the render path, which is
what lets the PNG export clone the live board and copy computed styles onto it.

## Project layout

```
src/
  game/         Domain primitives: types, coordinates, constants, layouts
  generator/    Generation, constraints, scoring, fairness simulation
  state/        Zustand store
  ui/           React components (Board, Controls, TileIcon) and CSS
  url/          Share link encoding and decoding
tests/          Vitest unit tests, plus env-gated stress harnesses
```

The generator is pure. Nothing under `src/generator/` or `src/game/` touches the
DOM, React, or `Math.random` directly. All randomness flows from one seeded
generator threaded through as an argument, which is what makes a seed enough to
rebuild a board exactly.

## Hosting

The site is served from `catan.ntblabs.dev` by GitHub Pages. `vite.config.ts`
sets `base: '/'` because the site lives at the root of that domain.
`public/CNAME` carries the domain and is copied into `dist/` on every build,
which is what stops Pages from resetting the custom domain on each deploy.
`.github/workflows/deploy.yml` runs the tests and the build on every push to
`main` and publishes the result. A failing test blocks the deploy.

To host at a subpath instead, change `base` to `'/<repo-name>/'` and remove
`public/CNAME`.

## Architecture notes

For a deeper look at the generator, the scoring model, the pan/zoom pipeline,
and the iOS Safari quirks the mobile build had to work around, see
[ARCHITECTURE.md](./ARCHITECTURE.md).

## License

MIT, see [LICENSE](./LICENSE).

CATAN is a trademark of CATAN GmbH. This project is an unaffiliated fan
tool and is not endorsed by or associated with CATAN GmbH or Catan Studio.
All artwork here is original. See [THIRD-PARTY.md](./THIRD-PARTY.md) for
notices on embedded third-party icon assets.
