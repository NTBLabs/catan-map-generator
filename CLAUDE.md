# CLAUDE.md - Catan Lab

Working context for this repo. Read this first, then `PROJECT_BRIEF.md` for the
reconstructed history, the decisions behind the algorithm, and the open
questions only Nathan can close.

## SESSION CHECKLIST

Run through this before proposing or writing anything.

1. Read this file, then `PROJECT_BRIEF.md` (history, decisions, open questions).
2. Read `ARCHITECTURE.md` for the deep dive on the generator, the pan/zoom
   pipeline, and the iOS Safari quirks. Treat it as accurate up to 2026-06-01
   and stale after that: it predates the Rich vs Poor and Hot Zone scenarios,
   the port redesign, and the share dialog.
3. `git status` and `git branch -vv`. Two branches exist. `main` is the product.
   `simulator-stress-testing` holds the stress harnesses and their recorded
   outputs and is intentionally unmerged.
4. Confirm the working tree state. It was left clean on 2026-08-22 with both
   branches pushed. See "Working tree and the stress branch" below for how the
   two tracks divide.
5. `npm test` should report 31 passed and 1 skipped on `main`. The skip is the
   env-gated planner-bias harness, not a failure. On
   `simulator-stress-testing` the same command reports 31 passed and 16
   skipped, since every other harness lives there.
6. Confirm what Nathan wants to work on before proposing work. This project sat
   untouched from 2026-06-06 to 2026-08-22, so no plan in your context is
   guaranteed current.

## Standing NTB Labs rules

- **Commit only on explicit approval.** Never commit or push without Nathan
  saying so for that specific change. Proposing a commit message is fine.
  Running `git commit` unasked is not.
- **Branch invariant.** Anything committed is theoretically working. Every
  commit is backed by a verified gate: the build passes, the tests pass, and the
  specific behavior being claimed has actually been checked.
- **Branch operations.** Stay on the branch the session started on. No create,
  switch, merge, rebase, or delete without explicit approval.
- **No em dashes in any writing.** Applies to commit messages, code comments,
  docs, UI copy, and chat. Use commas, colons, parentheses, or a rewrite.
- **No `Co-Authored-By` trailers on commits.** Subject line as drafted, no
  trailer.

## What this is

A constraint-driven Settlers of Catan board generator that runs entirely in the
browser. It produces balanced base-game (3 to 4 player, 19 hex) and 5 to 6
expansion (30 hex) boards, or deliberately harsh scenario boards, and it proves
the balance claim by simulating the opening snake draft rather than by checking
shallow placement rules.

The differentiator is the analysis layer: a snake-draft fairness simulation,
per-resource health, macro resource-pair distribution, spatial pip distribution,
port hinterland strength, and a strategic-diversity gate. Other generators do
constraint checking only.

Product direction, decided 2026-06: free, ad-free fan tool under Nathan's name,
aiming to become the community-staple base-game generator. No monetization.
Catan's published IP policy bars income via advertisement on fan tools, and the
goal here is reputation, not revenue.

## Architecture map

```
src/
  game/         Domain primitives. No React, no randomness.
    types.ts        All shared types. Heavily commented; the comments carry design rationale.
    constants.ts    Board specs (BASE_BOARD, EXPANSION_BOARD), pip table, thresholds, MAX_ATTEMPTS
    coords.ts       Pointy-top axial coords, hex to pixel, intersection graph builder
    layout.ts       Empty board layout plus canonical port slot positions per board size
  generator/    Pure functions. No DOM, no React. This is the product.
    random.ts       mulberry32 seeded RNG, shuffle, pick, seedFromString
    randomize.ts    Resource placement, then two-phase number placement by candidate filtering
    constraints.ts  Hard constraint checks, run after placement
    generate.ts     The attempt loop: resolve scenario, randomize, gate, score, accept or retry
    score.ts        Spot scoring, archetypes, snake draft, health, pairs, ports, spatial. 1367 lines.
  state/
    store.ts        Zustand store. playerCount, variants, view toggles, generate(), loadFromUrl()
  ui/
    Board.tsx       Inline SVG board, pan/zoom/rotate, scenario overlays, pick overlay. 1429 lines.
    panZoom.ts      Headless pan/zoom controller. Owns the view state, both transform
                    writers, and the hold set that keeps CSS and SVG mode exclusive.
                    DOM writes are injected, so it is testable without a DOM.
    Controls.tsx    Bottom drawer, all options, share dialog, diagnostics panels. 852 lines.
    TileIcon.tsx    Tile art and port glyphs
    exportImage.ts  SVG to PNG export by copying computed styles onto a clone
    icons.tsx, app.css, theme.css
  url/
    encode.ts       Share links. v3 bit-packed wire format, v1 and v2 legacy decoders
tests/          Vitest. Unit tests plus env-gated stress harnesses
scripts/        build-og.mjs, renders public/og.svg to og.png via resvg
```

Data flow: `Controls` writes to the store, `store.generate()` calls
`generateMap()`, the result is rescored with `scoreMap()`, the store holds both
`map` and `scored`, `Board` and the diagnostics panels read from `scored`, and
`writeMapToUrl()` pushes the packed seed plus variants into the location hash.

### The generation loop, in one pass

`generateMap()` loops up to `MAX_ATTEMPTS` (5000). Each attempt:

1. `resolveChallenge()` picks the scenario kind, the target resource, and for
   Rich vs Poor the axis and rich side. Resolved before placement because Hot
   Zone has to relax the red-adjacency rule and Rich vs Poor has to bias number
   placement toward one side.
2. `randomizeMap()` places resources (no same-resource adjacency, strict with
   8 retries then a non-strict fallback), then numbers in two phases: high-yield
   numbers (5, 6, 8, 9) first with reds first, then everything else.
3. `checkHardConstraints()` rejects outright on same-resource adjacency, red
   adjacency (unless Hot Zone), triple high-yield intersections, port-type
   overcount, and whichever optional toggles are on.
4. `challengeMatches()` applies the per-scenario gates. Balanced mode requires
   resource health, port balance, and spatial pip balance. Each scenario keeps a
   deliberately different subset. The reasons are written out in the comments in
   `generate.ts` and they are load-bearing, not decoration.
5. `scoreMap()` scores every intersection and simulates the snake draft.
6. Balanced mode also requires `hasStrategicDiversity()`.
7. Accept if the snake-draft fairness stdev is at or under the threshold.

If nothing clears the threshold, the best candidate seen is returned with
`fellBack: true` and the UI shows a best-effort notice.

### Scoring, at a glance

Per intersection: `pipValue`, plus `diversityBonus` (0.5 per extra unique
resource), `portBonus` (1.0 matching, 0.3 otherwise), `synergyBonus` (1.5 each
for shared-number road and city combos, dormant under default toggles),
`scarcityBonus` (pip-yield scarcity only, weight 0.10), `roadPotentialBonus`
(0.8 for brick plus wood), `cityPotentialBonus` (0.4 for ore plus wheat),
`startingHandBonus` (0.3 per producing hex), `pairScarcityBonus` (capped at
1.0), `sameNumberPenalty` (negative), and `expansionBonus` (a z-scored reach
metric clamped to plus or minus 0.8).

The snake draft ranks round-1 picks on `firstPickValue` (total minus the road
and starting-hand bonuses, which per the rules only pay off for the second
settlement) using pair planning with a survival discount, and round-2 picks on
the full total plus a diversification term. Fairness is the stdev of per-player
two-pick totals.

Every weight in that list has a comment in `score.ts` explaining what it was
tuned against. Read the comment before changing a number.

## Conventions observed in this code

- **Comments carry the rationale.** Non-obvious constants, thresholds, and
  deliberately omitted checks are explained in place, usually with the empirical
  result that justified them. Match that density. If you change a tuned number,
  update the comment with the new evidence.
- **The generator is pure.** Nothing under `src/generator/` or `src/game/`
  touches the DOM, React, or `Math.random` directly. All randomness flows from
  the seeded `mulberry32` instance threaded through as `rng`.
- **Determinism is the contract.** A share link stores only the seed plus the
  variant flags, then regenerates the board. Any change to placement, gating, or
  RNG call order silently invalidates every previously shared URL.
- **Naming.** camelCase for functions and variables, PascalCase for types and
  React components, SCREAMING_SNAKE for module constants. Predicates read
  `hasX`, `isX`, `areX`. A diagnostic that returns the thing itself reads
  `findX`, and the paired predicate delegates to it so the UI overlay and the
  generator gate cannot drift apart (see `hasWealthGap` and
  `findWealthGapAxis`).
- **CSS is class based** with custom properties in `theme.css`. The PNG export
  depends on this: it copies computed styles onto a cloned SVG.
- **Tests.** Fast unit tests run by default. Anything that generates hundreds of
  maps is an env-gated stress harness in the same `tests/` directory, gated by
  `it.runIf(process.env.RUN_X === '1')`, with sample counts read from env vars
  with defaults, and its recorded output committed alongside as a
  `*-output.txt` file.
- **No TODO or FIXME markers anywhere in `src/`.** Parked work is described in
  prose in a comment or it does not exist.

## Run, test, deploy

```bash
npm install
npm run dev        # http://localhost:5173, host: true so a phone on the same wifi can reach it
npm run build      # tsc -b then vite build, output in dist/
npm run preview
npm test           # vitest run. Expect 31 passed, 4 skipped
npm run build:og   # re-render public/og.png from public/og.svg
```

Stress harnesses, each gated on its own env var:

```bash
RUN_PLANNER_BIAS=1 npx vitest run tests/stress-planner-bias.test.ts
RUN_NEW_FLAVORS=1 npx vitest run tests/stress-new-flavors.test.ts
RUN_PLAYER_BALANCE=1 npx vitest run tests/stress-new-flavors.test.ts
RUN_SCENARIO_TOGGLES=1 npx vitest run tests/stress-scenario-toggles.test.ts
```

The harnesses on `simulator-stress-testing` use `RUN_VIABILITY`,
`RUN_VIABILITY_CAL`, and `RUN_VIABILITY_REGEN`, plus a final-audit harness.
These take minutes, not seconds. Hot Zone at 6 players is the slowest path in
the system, roughly 1 second per accepted map.

Deploy: `.github/workflows/deploy.yml` builds on every push to `main` (Node 20,
`npm ci`, `npm run build`) and publishes `dist/` to GitHub Pages. The repo
settings Pages source must be "GitHub Actions".

The site is served at `https://catan.ntblabs.dev`, so `vite.config.ts` sets
`base: '/'` and `public/CNAME` carries the domain. `public/` is copied verbatim
into `dist/`, which is the only reason the CNAME survives a deploy. A CNAME at
the repo root would NOT be copied and the custom domain would reset on every
publish. If you ever move back to a Pages project subpath, `base` goes back to
`'/<repo-name>/'` and `public/CNAME` comes out.

The GitHub remote is `NTBLabs/catan-map-generator`. The repo was transferred
from `nathantbenke` during the 2026-06 to 2026-08 gap.

## Working tree and the stress branch

The tree is clean. Both branches are committed and pushed.

`simulator-stress-testing` is a permanent parallel track and is never merged
into `main`. Harnesses and their recorded `*-output.txt` outputs live there;
`main` stays clean. `main` merges forward into the branch when the harnesses
need to run against current code, never the other way around.

The two newest harnesses landed there on 2026-08-22 as
`Stress: scenario flavor validation + toggle cost sweep`:
`tests/stress-new-flavors.test.ts` with `new-flavors-output.txt` and
`player-balance-output.txt`, and `tests/stress-scenario-toggles.test.ts` with
`scenario-toggles-output.txt`. Both report green.

The toggle sweep left one unactioned finding: turning the three placement
toggles off makes Rich vs Poor and Hot Zone dramatically cheaper to generate, up
to 96 percent fewer attempts at 6 players, with no loss of scenario match rate.
Nothing in the code acts on that yet. See section 6 of `PROJECT_BRIEF.md`.

`bias-output.txt` is tracked on `main`, which is inconsistent with the pattern
above. Known and deliberately left. `.claude/` and `*.log` are gitignored.
