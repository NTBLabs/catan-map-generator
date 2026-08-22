# PROJECT_BRIEF.md - Catan Lab

Reconstructed history and current state, assembled 2026-08-22 from git history,
the code itself, and the surviving project memory files. Written so a planning
session can pick this project up cold.

**Read the labels.** Every claim here is marked:

- **FACT** means it is recorded in a commit, in the code, or in a committed
  output file. It can be verified by looking.
- **INFERRED** means it is a reading of the evidence. The evidence is named so
  the inference can be checked or overturned.

Anything the evidence cannot settle is in OPEN QUESTIONS at the end.

---

## 0. Provenance of this document

**FACT.** The development conversations for this project no longer exist. The
Claude Code session directory for this repo
(`~/.claude/projects/d--Personal-Projects-Catan-Map-Generator/`) contains only
the current session transcript plus a `memory/` subdirectory. No transcripts
survive for any prior session. A sweep of all session directories, the global
`.claude.json` and its backups, `~/.claude/plans/`, `file-history/`, `sessions/`,
and the wider user profile found no transcript keyed to this repo or to any
prior path for it.

**FACT.** The approved implementation plan is also gone. The memory file
`reference_catan_plan.md` points at
`C:\Users\icanh\.claude\plans\i-m-wanting-to-create-whimsical-gem.md`. That file
does not exist anywhere on disk.

**FACT.** What survived: six memory files (dated 2026-05-25 to 2026-06-06), the
full git history on two branches, `ARCHITECTURE.md`, `README.md`, the committed
stress-harness outputs, and an unusually dense layer of rationale comments in
the source.

**INFERRED.** The transcripts were pruned by routine retention cleanup rather
than lost in a move. Evidence: the `memory/` subdirectory under the current path
key survived with files dated 2026-05-25 onward, so the path key itself is not
new, and `~/.claude/.last-cleanup` is stamped today. The prompt's premise that
the repo moved is not contradicted by anything found, but nothing found supports
it either.

**Practical consequence.** The comments in `score.ts`, `generate.ts`, and
`randomize.ts` are now the primary record of why the algorithm is shaped the way
it is. They are unusually complete, including calibration tables and rejected
alternatives. Treat them as documentation of record, not as ordinary comments.

---

## 1. Timeline

**FACT.** 22 commits on `main`, 2026-05-28 through 2026-06-06. 7 commits on
`simulator-stress-testing`, 2026-05-31 through 2026-06-01. No tags. Remote is
`https://github.com/nathantbenke/Catan-Map-Generator.git`, `origin/main` is level
with local `main`.

### Phase 1: foundation and shipping (2026-05-28 to 05-29)

| SHA | Date | Message |
| --- | --- | --- |
| `aff334c` | 05-28 | Initial commit: Catan map generator (33 files, 6785 insertions) |
| `e9e9822` | 05-28 | Match base path to actual GitHub repo casing |
| `c863cd8` | 05-28 | Shorten share URLs by ~96% via seed-only encoding |
| `5b3fd42` | 05-29 | Bit-pack share URLs to 10 chars (v3 wire format) |
| `8a45c5d` | 05-29 | Rename to lowercase repo + SEO/OG + v3 packed wire format |

**INFERRED.** The whole app arrived in one commit, which means the initial
build predates the git history. Evidence: 6785 insertions across 33 files
including tests, CI workflow, LICENSE, and a written ARCHITECTURE.md. The lost
plan file is the likely source. Everything in Phase 1 after that is deployment
and shareability polish, done within 24 hours, which reads as getting a working
thing live before improving it.

### Phase 2: algorithm depth (2026-05-30 to 06-01)

| SHA | Date | Message |
| --- | --- | --- |
| `4f0e397` | 05-30 | Added copy link flag + algorithm improvements |
| `ce587c3` | 05-30 | Algo-Improvements: port fairness, trading distribution, high-yield pip distribution, resource-pairings, archetypes (868 insertions) |
| `805bf5b` | 05-31 | Added Survival-Discounted Planning |
| `e6e78cb` | 05-31 | Algo-Improvements: scarcity bonus refactor + spread strategy option |
| `30086ce` | 05-31 | Diversity gate: structural eligibility (k=5) + port-economy diagnostic |
| `b7420cc` | 05-31 | Snake-draft: stabilize R1 discount baseline (F: floor 0.20, slope 0.10) |
| `189f4c4` | 06-01 | Fix build: add @types/node so tests can reference process.env |
| `d52d55a` | 06-01 | Add cityPotentialBonus for ore+wheat asymmetry + remove impossible bonus |

Running in parallel on `simulator-stress-testing`:

| SHA | Date | Message |
| --- | --- | --- |
| `261d96d` | 05-31 | Stress test + outputs |
| `e45f77b` | 05-31 | Add test results for scarcity bonus / pip-yield investigations |
| `195a7a5` | 05-31 | Stress: archetype viability investigation + reorg |
| `84c903e` | 05-31 | Stress: discount tuning + F validation harnesses |
| `cbd84b7` | 06-01 | Stress: synergy dormancy investigation + cityPotentialBonus sweep + regen validation |
| `7145d36` | 06-01 | Merge branch 'main' into simulator-stress-testing |
| `332cd78` | 06-01 | Audit testing before prod ship |

**FACT.** The reflog shows tight branch ping-pong on 05-31 and 06-01: an
investigation lands on the stress branch, a tuning change lands on `main`
minutes later. `b7420cc` on `main` at 18:21:04 is followed by a branch checkout
at 18:21:15.

**INFERRED.** This is a deliberate two-track method: measure on the branch,
ship the tuned constant to `main`, keep the harness and its recorded output out
of the product history. The branch was never merged and appears not to have been
intended for merging. Evidence: 25 files unique to the branch, all of them test
harnesses and `*-output.txt` transcripts, plus a merge in the other direction
(`main` into the branch) to keep the harnesses running against current code.

**FACT.** The branch ends at a full audit reporting GREEN across balanced
baseline, snake-draft positional bias, challenge modes, and variant edge cases,
with the literal verdict line "Overall: GREEN - SHIP" (`final-audit-output.txt`
at `332cd78`).

### Gap and a visual detour (2026-06-01 to 06-03)

**FACT.** No commits between 06-01 21:57 and 06-03 20:53. The commit that ends
the gap, `2004eb1`, is "Redesign ports: harbour ship + plank docks with
geometry-aware angling", 289 insertions and 103 deletions across 2 files, all
rendering.

**INFERRED.** The algorithm work was considered finished at the audit, and
attention moved to how the board looks. This is the pivot point from engine to
product.

### Phase 3: scenarios, sharing, and then silence (2026-06-05 to 06-06)

| SHA | Date | Message |
| --- | --- | --- |
| `2b90fcf` | 06-05 | Add Rich vs Poor + Hot Zone scenarios with on-board overlays (11 files, 572 insertions) |
| `557268b` | 06-06 12:03 | Resource-balance guards for Rich vs Poor + Hot Zone scenarios |
| `bf36884` | 06-06 12:27 | Split resource distribution + advanced diagnostics into separate toggles |
| `27b992f` | 06-06 12:35 | Bias high-yield spread by per-tile rate in Rich vs Poor + Hot Zone |
| `7d79ab8` | 06-06 14:23 | Add share dialog with native share sheet, messaging shortcuts, and PNG export (758 insertions) |
| `4592b06` | 06-06 15:23 | Refine share dialog into a polished icon grid |
| `35297b1` | 06-06 15:28 | Make Download always force a file download |
| `13f79ee` | 06-06 19:08 | Reorder scenario dropdown: Hot zone and Rich vs Poor first |

**FACT.** The memory file recording the no-monetization decision is stamped
2026-06-06 13:01, which falls between `bf36884` (12:27) and `7d79ab8` (14:23).

**INFERRED.** The product-direction conversation happened mid-session on the
last working day, and the share dialog built immediately afterward is the first
thing done under the new framing. Evidence: the decision memory names
discoverability and word of mouth as the optimization target, and the very next
commit is a mobile share sheet aimed at group chats.

**FACT.** No commits after 2026-06-06 19:08. 77 days of silence to 2026-08-22.

**INFERRED.** The stop was not a failure state. The last commit is a two-line
dropdown reorder, the test suite passes, the build succeeds, and the tree
contains green validation runs. Everything points to a natural pause with the
project in a shippable condition, not an abandoned debugging session. The
untracked scenario-toggle finding (section 6) is the one loose thread.

---

## 2. Current capabilities, traced from the code

**FACT** for this whole section unless marked otherwise.

**Boards.** Base game at 3 to 4 players (19 hexes, 9 ports) and the 5 to 6
expansion at 5 to 6 players (30 hexes, 11 ports). Board specs, including the
canonical 5th edition port ordering, live in `constants.ts`. The expansion
always carries 2 deserts and the UI disables the desert toggle there, with a
defensive override in `randomize.ts`.

**Placement.** Resources are placed first with a no-same-resource-adjacency
rule, strict for up to 8 attempts then a non-strict fallback, followed by a
defensive count check against the tile bag. Numbers are placed in two phases,
high-yield (5, 6, 8, 9) first with reds first because they carry the tightest
adjacency constraint, then the rest.

**Always-on hard constraints.** No same-resource adjacency, no red adjacency
(6 or 8 touching 6 or 8, relaxed only for Hot Zone), no three mutually adjacent
high-yield hexes at one intersection, no more of any 2:1 port type than the
board spec allows.

**Optional constraints, all on by default.** No same numbers adjacent, no same
number twice on one resource, spread reds across resources (the cap is derived
as `ceil(totalReds / resourceCount)`, which is 1 on the base board and 2 on the
expansion).

**Scenarios.** Six, all reachable from the UI dropdown in this order: None
(balanced), Hot zone, Rich vs Poor, Scarcity, Boom-or-bust, Drought, Random.
Scarcity and Boom-or-bust take a target resource or "Any". Random rolls one of
the five non-balanced kinds per attempt.

- *Scarcity*: target resource total pips at or below 4.
- *Boom-or-bust*: target concentration at or above 0.6 with total pips at least 5.
- *Drought*: at least one triangle of three mutually adjacent low-yield hexes.
- *Rich vs Poor*: one of the three hex axes carries at least 65 percent of board
  pips, and every numbered hex on the rich side is 3 pips or better. Number
  placement is biased toward the chosen axis at generation time, and deserts are
  kept off the rich side.
- *Hot zone*: a connected cluster of red numbers, minimum 4 on the base board
  and 5 on the expansion, spanning at least 3 distinct producing resources.

Nothing is built but hidden. Every scenario in the type union is in the
dropdown, and every dropdown entry is implemented.

**Balance gating.** In balanced mode a candidate must pass resource health, port
hinterland balance, spatial pip distribution, and the strategic-diversity gate,
then land at or under a per-player-count fairness stdev of 0.6, 0.65, 0.75, or
0.8. Scenario modes use a flat 1.0 and each keeps a deliberately chosen subset
of the structural checks.

**Analysis surfaced in the UI.** Snake-draft pick overlay with rank rings and
spot values, per-resource pip totals with healthy / warning / unhealthy status,
snake-draft fairness bars, per-player port distance, spatial pip spread by
quadrant, resource-pair frequency versus expectation, strategic-viability counts
per archetype, top-20 archetype mix, the top three port-economy openings, and
per-port hinterland support. These sit behind two toggles, "Show resource
distribution" and "Show advanced diagnostics", split apart in `bf36884`.

**Sharing.** The location hash carries a 7 byte, 10 character base64url payload:
version nibble, 32 bit seed, player count, and every variant flag. The board is
regenerated from that, not transmitted. v1 and v2 JSON formats still decode.

**Export.** PNG download with the seed stamped on it, produced by cloning the
live SVG, copying a whitelist of computed style properties onto the clone, and
rasterizing through canvas. Plus a native share sheet on mobile and direct
WhatsApp, Telegram, Reddit, and email targets.

**View.** Pinch zoom, drag pan, 30 degree rotation steps, and a water frame
toggle. Pan and zoom use a hybrid path, CSS transform during the gesture and an
SVG-native transform at rest, which is a deliberate iOS Safari trade-off
recorded in project memory. Do not revert it.

**Verified state as of 2026-08-22.** `npm test` reports 31 passed and 4 skipped.
`npm run build` succeeds, producing 266.68 kB of JS (85.73 kB gzipped) and
12.19 kB of CSS.

---

## 3. Decisions, with the evidence for each

**D1. Fairness is measured by simulating the draft, not by counting pips.**
FACT: `simulateSnakeDraft()` in `score.ts` plays out a full snake order, blocks
the distance-2 neighbourhood after each pick, and reports the stdev of
per-player two-pick totals. INFERRED: this is the intended differentiator
against other generators, which check placement rules only. Evidence: the
product-direction memory names the snake-draft fairness engine first in its list
of differentiators.

**D2. Two fairness thresholds, strict for balanced and loose for scenarios.**
FACT: `FAIRNESS_THRESHOLD_BALANCED` is 0.6 / 0.65 / 0.75 / 0.8 by player count,
`FAIRNESS_THRESHOLD` is 1.0 for every count. FACT, from the comment: 0.65 at 4
players puts the max-minus-min spread around 1.5, which matched the intended
feel of an even map.

**D3. Round-1 planning is survival discounted.** FACT: the planner scores a
round-1 spot as its standalone value plus the best compatible round-2 spot
multiplied by `max(0.20, 1 - picksUntilR2 * 0.10)`. FACT: the comment records
the calibration, a 600 map controlled-seed regeneration, with the resulting
last-player advantage at 1.36 / 2.01 / 2.00 / 2.83 percent for 3 to 6 players,
and names slope as the load-bearing parameter with floor anywhere in 0.20 to
0.25 being equivalent. FACT: a small tail-risk regression at 4 players was
accepted as the price of compressing bias at 5 and 6.

**D4. The tile-count half of the scarcity bonus was switched off, not deleted.**
FACT: `DEFAULT_SCARCITY_CONFIG` is `{ tileWeight: 0, pipWeight: 0.10 }`, and the
comment records why: the tile bag is fixed by the rulebook so tile count is not
strategic scarcity, and the term amplified a structural advantage for the
3-tile resources into roughly 50 percent top-spot dominance. Removing it cut
brick and ore dominance to about 37 percent with no regression on acceptance,
fairness, or attempts. INFERRED: it was left as a config knob rather than
deleted so the experiment can be re-run. Nothing on `main` sets it today.

**D5. `cityPotentialBonus` is 0.4, deliberately not symmetric with the 0.8 road
bonus.** FACT, from the comment: strict symmetry at 0.8 overcorrected and made
cityRush the dominant top-1 archetype at 45 percent versus expansion at 39
percent for 4 players. At 0.4, cityRush top-1 share rises from 19 to 33 percent
at 4 players and 14 to 27 percent at 6, with expansion still the most common
apex.

**D6. The strategic-diversity gate was rebuilt around structural eligibility.**
FACT: the gate requires at least 3 archetypes with at least 5 board-wide
eligible spots each, using multi-label structural predicates with no quality
threshold. FACT, from the comment: the previous top-20 dominant-archetype check
was observationally broken for port economy, whose average top-20 count at 6
players was 0.10, because coastal spots touch 1 or 2 hexes instead of 3 and
structurally cannot reach the top 20 by total. FACT: k=5 came from an empirical
knee in the viability curve, measured by the harnesses added in `195a7a5`.
INFERRED: the underlying principle, stated in the comments as a "tiered-intent
model", is that eligibility is structural, quality is observable, and gating
stays separate from valuation. That phrasing appears in several comments and
reads as a rule Nathan settled on, not a local choice.

**D7. Each scenario keeps a different subset of the structural checks, and the
omissions are documented individually.** FACT, from `generate.ts`: Hot Zone
skips the per-resource pip-variance check because the variance check broke it at
6 players (77 percent fallback, 24 percent match), and requires cluster
diversity of 3 rather than 4 because 4 caused 79 percent fallback. Rich vs Poor
skips the port-balance check because with fixed ports at 6 players it rejected
on port geometry unrelated to the scenario. Scarcity, Boom-or-bust, and Drought
skip both structural checks because starving or concentrating a resource is
their whole identity.

**D8. Scenario mode changes the high-yield spread strategy.** FACT: balanced
mode uses `byCount`, Rich vs Poor and Hot Zone use `byRate`, and the three
resource-starving scenarios use `off`. FACT, from the comment: `byRate`
equalizes high-yield rate per tile so the 3-tile resources are not
proportionally starved when the cluster steals the high numbers.

**D9. Rich vs Poor requires the rich side to be uniformly rich.** FACT: every
numbered hex on the rich side must be 3 pips or better, with the dividing line
exempt. FACT, from the comment: concentration alone produced visually muddy maps
with a sprinkle of low numbers on the rich side. FACT: this is only achievable
because the axis is chosen before placement and placement biases toward it.

**D10. Share links carry a seed, not a board.** FACT: `packV3` writes a version
nibble, the 32 bit seed, player count, and the variant flags into 7 bytes.
Decoding calls `generateMap()` again. INFERRED consequence, and the single most
important constraint on future work: any change to placement order, gating, or
RNG consumption silently changes what an old link renders. There is no version
stamp on the algorithm itself, only on the wire format.

**D11. The enum order in the wire format is frozen.** FACT, from the comment:
`wealthGap` and `hotZone` are appended at indexes 5 and 6 rather than inserted
alphabetically, because older URLs encoded the earlier indexes, and a seventh
flavor past index 7 overflows the 3 bit field and needs a schema bump.

**D12. Generation is deferred one tick so the spinner can paint.** FACT, from
`store.ts`: `setTimeout(..., 0)` wraps the generate call because Hot Zone at 6
players blocks for roughly 1.3 seconds and React would otherwise batch the
spinner state into the same frame as the freeze.

**D13. Cities and Knights was explicitly deferred, not forgotten.** FACT, from
the comment in `constants.ts`: the expansion tile distribution notes that Cities
and Knights swaps to 7 wheat and 5 sheep, "but that is a separate variant, defer
until needed".

---

## 4. Dead ends and abandoned approaches

**A1. `hasSettlementCombo`.** FACT, from the comment in `score.ts`: removed in
2026-06 because an intersection touches at most 3 hexes, so requiring brick,
wood, wheat, and sheep at one corner is mathematically impossible. This is the
"remove impossible bonus" half of `d52d55a`.

**A2. Three stress harnesses deleted in `195a7a5`.** FACT, from that commit
message: `stress-scarcity-regen`, `stress-scarcity-validation`, and
`stress-spread-investigation` were removed because they depended on APIs
"reverted from production", along with their `regen-output.txt`,
`scarcity-output.txt`, and `spread-output.txt`. FACT: the APIs they named,
`ScarcityConfig`, `DEFAULT_SCARCITY_CONFIG`, and `SpreadHighYieldMode`, are
still present in `main` today. INFERRED: the harnesses were removed, the hooks
were kept, and nothing on `main` currently exercises either hook.

**A3. The top-20 dominant-archetype diversity gate.** Superseded by D6. The
metric survives as `archetypeMix`, used for UI display only, with a comment
warning it is not the gate.

**A4. The tile-count scarcity term.** Superseded by D4. Reachable only by
passing a custom `scarcityConfig`.

**A5. Shared-number road and city synergy bonuses are dormant.** FACT, from the
comment: with `noSameNumberAdjacent` and `noSameNumberOnResource` both on, the
shared-number setup is forbidden, so both bonuses fire on 0 percent of spots.
FACT: they were kept deliberately as forward-compatible elite signals for a
future config that relaxes those constraints, at zero cost today.

**A6. A perimeter-numbers debug overlay.** INFERRED: `Board.tsx` line 196 refers
to port positions that "were specified by the user via the perimeter-numbers
debug overlay". No such overlay exists in the code. It was a temporary
development tool, used to author the expansion port slot table, then removed.

---

## 5. Dead code, stubs, and orphaned config

Each item below is FACT as to its state. The reading of intent is INFERRED.

| Symbol | State | Likely intent |
| --- | --- | --- |
| `isResourceHealthySoft` (`score.ts`) | Exported, zero callers anywhere | Written for Hot Zone, whose comment says the strict health checks all break it. Superseded by the cluster-diversity-only approach in `generate.ts`. Live alternative if Hot Zone gating is revisited. |
| `hasHotZone` (`score.ts`) | Called only by the two untracked stress tests | Production uses `findHotZoneCluster` because it needs the cluster for the overlay. The predicate is the older, simpler form. |
| `readMapFromUrl` (`encode.ts`) | Exported, zero callers | `App.tsx` reads the hash itself and calls `loadFromUrl`. Leftover from an earlier wiring. |
| `playerPortDistanceSpread` (`ScoredMap`) | Computed, never rendered | The per-player array next to it is rendered. The spread summary was presumably meant as a gate or a headline number and never wired. |
| `hexIntersections` (`IntersectionGraph`) | Built, zero consumers | Reverse index built for a lookup nothing performs. |
| `MIN_PIPS_PER_RESOURCE` (`constants.ts`) | Exported, zero readers | A per-player-count pip floor (6 / 7 / 9 / 10). `isResourceHealthy` ignores its `playerCount` argument, which is named `_playerCount`, and uses a hardcoded 1.7 pips-per-tile rule instead. This is the clearest orphaned tunable in the codebase. |
| `GenerateOptions.scarcityConfig` | Plumbed, no caller on `main` | Experiment hook, see A2. |
| `GenerateOptions.spreadHighYieldMode` | Plumbed, no caller on `main` | Experiment hook, see A2. Note it is honored only in balanced mode; scenarios override it. |
| `FAIRNESS_THRESHOLD` | Read, but 1.0 at every player count | Shaped as a per-count table for a per-count tuning that never happened. |
| v1 and v2 wire decoders (`encode.ts`) | Live, decode-only | Backward compatibility for links shared before 2026-05-29. |

---

## 6. The one open loop from the last session

**FACT.** The untracked `tests/stress-scenario-toggles.test.ts` sweeps the three
placement toggles against Rich vs Poor and Hot Zone. Its recorded output shows,
at 6 players, that turning off `noSameNumberAdjacent` cuts attempts by 86
percent for Rich vs Poor and 94 percent for Hot Zone, with 100 percent scenario
match retained and per-player balance unchanged. Turning all three off reaches
92 and 96 percent. At 4 players, Hot Zone is the exception: two combinations
that drop `noSameNumberAdjacent` slightly worsen the per-player delta.

**FACT.** The harness comment states its purpose as identifying combinations
that "are candidates for forced defaults in scenario mode".

**FACT.** No code acts on this. The toggles are still user controlled and still
default to on in every mode.

**INFERRED.** This was the work in flight when the project stopped. It is the
natural first item for the next session, and it is a decision rather than an
implementation task: forcing toggles off in scenario mode trades a placement
guarantee the user asked for against generation cost the user never sees.

---

## 7. Documentation state

**FACT.** `ARCHITECTURE.md` (12 sections, last touched 2026-06-01) and
`README.md` (last touched 2026-06-06) both predate or omit the two newest
scenarios. Neither mentions Rich vs Poor or Hot Zone. `README.md` lists only
Scarcity, Boom-or-bust, Drought, and Random as the challenge modes.
`ARCHITECTURE.md` section 9 illustrates URL sharing with a v2 example even
though v3 shipped on 2026-05-29, and section 10 describes the test suite as one
file. Everything else in both documents matches the code.

---

## 8. OPEN QUESTIONS

These are the things the code and the history cannot answer. They are ordered by
how much downstream work they block.

1. **Hosting and repo visibility.** The 2026-06 direction memory says the repo
   should go private and hosting should move off GitHub Pages to a custom domain
   on a free tier. Today the repo is public, deploy is the GitHub Pages workflow,
   and `vite.config.ts` pins `base: '/catan-map-generator/'`. Did any of that
   move in the 77 day gap? Is a domain registered? A private repo breaks the
   current Pages setup, so this decision gates the deploy path.

2. **The project name.** The prompt for this reconstruction calls it "Catan
   Lab". `package.json`, `README.md`, and the in-app header all say "Catan Map
   Generator". The portfolio plan calls it "Catan Lab Generator". Which name is
   the product name, and does it change before or after the hosting move?

   **Answered 2026-08-22.** The product name is **Catan Lab**, singular. Not
   "Catan Labs", not "Catan Map Generator", not "Catan Lab Generator". It was
   applied to every user-facing surface: the page title, all Open Graph and
   Twitter tags, the JSON-LD name, the OG image headline, the in-app header,
   and the PNG export watermark. The name change came after the hosting move,
   which was itself resolved the same day (see question 1).

   The repository name does **not** change and stays
   `NTBLabs/catan-map-generator`. The npm package name in `package.json` stays
   `catan-map-generator` to match it. Renaming the repo would break the GitHub
   Pages path that existing share links resolve through, and every link Nathan
   has already sent out is a permanent URL.

3. **The scenario-toggle finding.** Section 6. Force the toggles off in scenario
   mode, expose a "fast mode", or leave it as documented behavior?

4. **Branch invariant wording.** `CLAUDE.md` states it as: stay on the branch
   the session started on, no branch operations without approval, and every
   commit backed by a verified gate. The second half is taken verbatim from the
   ntblabs-website plan. Confirm this matches what you mean by the rule across
   NTB Labs repos, or restate it and it will be corrected everywhere.

5. **The stress branch.** `simulator-stress-testing` has been unmerged since
   2026-06-01 and `main` has moved 9 commits past the merge base. Is it a
   permanent parallel track (keep rebasing it forward), an archive (tag it and
   stop), or should the harnesses come onto `main` behind their env gates?
   Related: the two untracked scenario harnesses in the tree belong to whichever
   answer you give, and `bias-output.txt` is currently tracked on `main` in
   contradiction of the pattern.

6. **Is 5 to 6 expansion support considered done?** It is fully implemented and
   audited, but it is also where every gating exception lives: Hot Zone at 6
   players is the slowest path, several checks are relaxed specifically for it,
   and the desert toggle is force-disabled. Is expansion a first-class mode or
   a supported-but-secondary one?

7. **Seafarers, Cities and Knights, and the feature gap.** The direction memory
   names no PNG export and no Seafarers or Cities and Knights as the known gaps
   versus commercial competitors. PNG export shipped on 2026-06-06, which closes
   one. `constants.ts` explicitly defers Cities and Knights. Are the expansions
   on the roadmap at all, or is best-in-class base game the deliberate scope?

8. **Was there ever a user other than you?** Nothing in the repo indicates the
   tool has been shared, played with, or given feedback on. Whether real games
   have been played on generated boards changes how much weight the tuning
   numbers should carry against play feel.
