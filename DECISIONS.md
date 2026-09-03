# DECISIONS.md - Catan Lab

Decisions taken and loops left open, newest first. This file records the
*reasoning*, not the change. `PROJECT_BRIEF.md` § 3 holds the older
algorithm-era decisions and § 8 holds the product-level open questions; this
file picks up where those leave off.

---

## 2026-08-22 - Pan/zoom mode ownership is a keyed hold set

**Decided.** CSS mode is held by a `Set<'drag' | 'pinch' | 'wheel'>` in
`src/ui/panZoom.ts`, not a boolean and not a counter. See `ARCHITECTURE.md` § 6
for the mechanism and the bug it fixes.

**Why a set and not a counter.** A counter can underflow, and an underflowed
counter never returns to zero, which strands the board in CSS mode permanently.
That is silent on desktop and surfaces only as the iOS stale-bitmap blur the
mode swap exists to prevent, so it is a worse bug than the one being fixed. A
set makes the hazard unrepresentable rather than something each call site has
to avoid by hand. It also lets the reset paths clear outright, which is the
correct move for a path that never acquired.

The specific trap: the wheel's idle timer is the wheel's *only* release. The
drag handler cancels that timer when a drag starts, so it has to release the
wheel's hold in the same block or the release becomes unreachable.

**Why the controller was extracted from `Board.tsx`.** So the ownership rules
can be tested in plain node. The alternative was `jsdom`, which would have made
the central regression test a bet on how faithfully jsdom models `PointerEvent`
and pointer capture, which is precisely the machinery `@use-gesture` depends
on. Behavior and the CSS↔SVG equivalence math are unchanged by the move.

---

## OPEN: pinch accumulator is never synced with wheel-driven scale

**Status: open, not scheduled. Do not fold into an unrelated change.**

`@use-gesture`'s pinch recognizer keeps its own `offset` accumulator. Nothing
reconciles it with `scale` when the wheel changes it, so a wheel zoom followed
by a pinch snaps to whatever scale the *last pinch* ended on.

On Windows this is reachable with one input device: a precision-touchpad pinch
emits `wheel` with `ctrlKey: true`, and `@use-gesture`'s pinch takes exactly
that path (`modifierKey` defaults to `ctrlKey`). So a trackpad pinch fires both
`onPinch` and `onWheel` for the same event, each writing `scale` from a
different source.

The mode half of that collision is already fixed: `onPinch` and `onWheel` take
distinct holds, so neither one's end-timer can strip CSS mode while the other
is live. **The scale half is untouched.**

Deliberately left open because it needs a design call that has not been made:
either sync the pinch accumulator on every wheel-driven scale change (via
`useGesture`'s `from` option), or route all zoom through a single recognizer
and drop the other. Different mechanism, different symptom (a snap at gesture
*start*, not a jump mid-drag), so it wants its own diagnostic pass.

---

## OPEN (2026-09-02): pending amendment to /legal for the board counter or any analytics beacon

**Status: pending, not applied. Do not publish ahead of the feature.**

The Privacy section on `/legal` states the current fact: the app makes zero
automatic requests to any external origin, sets no cookies, and sends nothing
anywhere. That section must stay accurate at every commit, so the text below
is NOT on the page yet. Apply it in the same commit that ships the board
counter or any analytics beacon, replacing the Privacy section of
`src/ui/LegalPage.tsx` and bumping the "Last updated" line. The replacement
text follows verbatim.

```markdown
When the board counter or any analytics beacon ships, replace the Privacy
section of /legal with the following in the same commit, and update the
"Last updated" date:

## Privacy

Catan Lab runs in your browser. There is no account and no login, and the
boards you generate are never sent anywhere. Board configurations are
encoded in the share URL itself, so a link you share contains the board and
nothing about you.

The site keeps a running count of how many boards have been generated in
total. When you generate one, the app sends a single anonymous signal that
increments that counter. It carries no board data, no identifier, and
nothing about you, and no per-visitor record is kept.

The site also uses privacy-preserving visitor analytics that set no cookies
and collect no personal data.

No personal information is collected from anyone using this site,
regardless of age.
```
