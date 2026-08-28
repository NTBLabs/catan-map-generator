import { useGesture } from '@use-gesture/react';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../state/store';
import { MOBILE_QUERY, openLiftPx } from './drawerMetrics';
import { axialToPixel, hexCorner, neighbors } from '../game/coords';
import { PIP_VALUE, RED_NUMBERS } from '../game/constants';
import { findHotZoneCluster, findWealthGapAxis } from '../generator/score';
import type { Hex, Port, PortType } from '../game/types';
import { PortGlyph, TileArt } from './TileIcon';
import { createPanZoom, type PanZoom } from './panZoom';

function hexPath(hex: Hex): string {
  const pts: string[] = [];
  for (let c = 0; c < 6; c++) {
    const { x, y } = hexCorner(hex, c);
    pts.push(`${x.toFixed(4)},${y.toFixed(4)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function boundingBox(hexes: Hex[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const h of hexes) {
    for (let c = 0; c < 6; c++) {
      const { x, y } = hexCorner(h, c);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

// Axial offsets for each pointy-top hex side (where side k = edge between
// corner k and corner (k+1) % 6). Neighbor through side k is hex + delta[k].
//   side 0 = NE, 1 = E, 2 = SE, 3 = SW, 4 = W, 5 = NW
const SIDE_TO_NEIGHBOR: ReadonlyArray<{ dq: number; dr: number }> = [
  { dq:  1, dr: -1 }, // 0: NE
  { dq:  1, dr:  0 }, // 1: E
  { dq:  0, dr:  1 }, // 2: SE
  { dq: -1, dr:  1 }, // 3: SW
  { dq: -1, dr:  0 }, // 4: W
  { dq:  0, dr: -1 }, // 5: NW
];

interface PerimeterEdge {
  hexId: string;
  q: number;
  r: number;
  side: number;
  midpointX: number;
  midpointY: number;
}

/** Walk the land perimeter CW (visually: top → right → bottom → left → top)
 *  starting from the NW edge (side 5) of the top-row leftmost hex, returning
 *  every perimeter edge in order. Produces 30 edges for the base 19-hex
 *  board and 38 edges for the 5-6 expansion (3-4-5-6-5-4-3). */
function perimeterEdgesCW(hexes: Hex[]): PerimeterEdge[] {
  if (hexes.length === 0) return [];
  const byKey = new Map<string, Hex>();
  for (const h of hexes) byKey.set(`${h.q},${h.r}`, h);

  // Topmost-leftmost hex.
  let startHex = hexes[0];
  for (const h of hexes) {
    if (h.r < startHex.r || (h.r === startHex.r && h.q < startHex.q)) startHex = h;
  }

  // Pick the first perimeter side going CW from side 5 (NW). For a top-row
  // leftmost hex, side 5 (NW) is always perimeter — but the search is
  // defensive in case the starting hex shape changes.
  let startSide = 5;
  for (let i = 0; i < 6; i++) {
    const s = (5 + i) % 6;
    const d = SIDE_TO_NEIGHBOR[s];
    if (!byKey.has(`${startHex.q + d.dq},${startHex.r + d.dr}`)) {
      startSide = s;
      break;
    }
  }

  const result: PerimeterEdge[] = [];
  let curHex = startHex;
  let curSide = startSide;

  for (let safety = 0; safety < 200; safety++) {
    const a = hexCorner(curHex, curSide);
    const b = hexCorner(curHex, (curSide + 1) % 6);
    result.push({
      hexId: curHex.id,
      q: curHex.q,
      r: curHex.r,
      side: curSide,
      midpointX: (a.x + b.x) / 2,
      midpointY: (a.y + b.y) / 2,
    });

    // Find the next CW perimeter edge. Test side (curSide + 1) % 6 of curHex;
    // if it's internal (has a neighbor), step across into that neighbor and
    // continue at side ((side + 1) + 3) % 6 = (side + 4) % 6 of the neighbor
    // (the side on the neighbor at the same corner, going CW).
    let testHex = curHex;
    let testSide = (curSide + 1) % 6;
    for (let step = 0; step < 12; step++) {
      const d = SIDE_TO_NEIGHBOR[testSide];
      const neighbor = byKey.get(`${testHex.q + d.dq},${testHex.r + d.dr}`);
      if (!neighbor) break;
      testHex = neighbor;
      testSide = (testSide + 4) % 6;
    }

    curHex = testHex;
    curSide = testSide;
    if (curHex.id === startHex.id && curSide === startSide) break;
  }

  return result;
}

// Clearance (in hex units) between every land corner and the frame boundary
// at that corner's angle from center. Sized so roughly 3 wave ripples fit
// between the land's top/bottom edge and the frame (wave spacing = 0.45)
// while leaving enough room that port docks don't bleed past the frame line.
// The expansion's L/R sides naturally look more spacious than top/bottom
// because the land's middle row is wider than its top/bottom rows — this is
// a property of the land shape, not the frame.
const FRAME_MARGIN = 1.38;

/** Regular flat-top hex frame circumscribing the land, sized so every land
 *  corner has at least `margin` clearance to the frame boundary at the
 *  corner's angle from center (NOT just to the nearest hex corner). Used by
 *  BOTH the base game and the 5-6 expansion so all 6 frame sides are equal —
 *  only the seam-break pattern differs. */
function regularHexFrame(hexes: Hex[], margin: number): {
  cx: number; cy: number; landR: number; R: number; corners: [number, number][];
} {
  const { minX, maxX, minY, maxY } = boundingBox(hexes);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // For a flat-top regular hex with circumradius R, the boundary distance at
  // angle θ from center is (R·√3/2) / cos(θ − α), where α = sector midpoint
  // angle (30° + k·60°). To guarantee `margin` clearance to a land corner at
  // distance d, angle θ:
  //   d + margin ≤ (R·√3/2) / cos(θ − α)
  //   R ≥ (d + margin) · cos(θ − α) · 2/√3
  // The naive `maxLandR + margin` underestimates R for corners that land
  // close to an edge midpoint (e.g. the topmost-leftmost hex of the
  // expansion's staggered top row), causing ports to bleed off the frame.
  let R = 0;
  let landR = 0;
  const sectorRad = Math.PI / 3;
  for (const h of hexes) {
    for (let c = 0; c < 6; c++) {
      const { x, y } = hexCorner(h, c);
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > landR) landR = d;
      let a = Math.atan2(dy, dx);
      while (a < 0) a += 2 * Math.PI;
      const sector = Math.floor(a / sectorRad);
      const sideMidAngle = sector * sectorRad + sectorRad / 2;
      const offset = a - sideMidAngle;
      const required = (d + margin) * Math.cos(offset) * 2 / Math.sqrt(3);
      if (required > R) R = required;
    }
  }

  const corners: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3; // 0°, 60°, ... → flat-top corners
    corners.push([cx + R * Math.cos(angle), cy + R * Math.sin(angle)]);
  }
  return { cx, cy, landR, R, corners };
}

function seaFramePath(hexes: Hex[], margin: number): string {
  const { corners } = regularHexFrame(hexes, margin);
  return `M${corners.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' L')} Z`;
}

// Intersect a ray from origin (angle θ) with a flat-top regular hex of
// circumradius R, returning the point on the hex outline (origin-relative).
function rayToFlatTopHex(angle: number, R: number): { x: number; y: number } {
  let a = angle;
  while (a < 0) a += 2 * Math.PI;
  a = a % (2 * Math.PI);
  const sectorRad = Math.PI / 3;
  const sector = Math.floor(a / sectorRad);
  const sideMidAngle = sector * sectorRad + sectorRad / 2;
  const inradius = (R * Math.sqrt(3)) / 2;
  const r = inradius / Math.cos(a - sideMidAngle);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// 10 land-hex corners where the 5-6 expansion frame pieces meet. Positions
// were read off the perimeter-numbers debug overlay: the breaks sit "between
// edge N and edge N+1", which is the END corner of edge N = corner
// (side+1) % 6 of edge N's hex. Walking CW from the top of (3,-3), segment
// lengths go 5-5-2-5-2-5-5-2-5-2 around the 38-edge perimeter.
const BREAK_LAND_CORNERS_EXPANSION: Array<{ q: number; r: number; corner: number }> = [
  { q:  3, r: -3, corner: 0 },  // edge 5 end, ends top main (label 4)
  { q:  3, r: -1, corner: 1 },  // edge 10 end, ends TR main (label 5)
  { q:  3, r:  0, corner: 1 },  // edge 12 end, ends TR ext  (label 5)
  { q:  1, r:  2, corner: 2 },  // edge 17 end, ends R main  (label 6)
  { q:  0, r:  3, corner: 2 },  // edge 19 end, ends R ext   (label 6)
  { q: -2, r:  3, corner: 3 },  // edge 24 end, ends bottom main (label 1)
  { q: -2, r:  1, corner: 4 },  // edge 29 end, ends BL main (label 2)
  { q: -2, r:  0, corner: 4 },  // edge 31 end, ends BL ext  (label 2)
  { q:  0, r: -2, corner: 5 },  // edge 36 end, ends L main  (label 3)
  { q:  1, r: -3, corner: 5 },  // edge 38 end, ends L ext   (label 3)
];

/** 10 wavy seam lines for the 5-6 expansion water frame. Each line emanates
 *  from a specific land-hex corner outward through the water to the outer
 *  edge of the regular hex frame. The seams split the frame into 10 pieces:
 *  6 main "5-edge" sides and 4 "2-edge" extensions. */
function FrameSeamsExpansion({ hexes, margin, rotation }: {
  hexes: Hex[]; margin: number; rotation: number;
}) {
  const { cx, cy, R } = regularHexFrame(hexes, margin);

  const hexByKey = new Map(hexes.map(h => [`${h.q},${h.r}`, h] as const));

  // 10 segment labels going CW between the 10 break points. Each main "5-edge"
  // side has a distinct label 1-6; the 4 "2-edge" extensions share the label
  // of the main side they trail (so split sides read as pairs: "2,2" "3,3"
  // "5,5" "6,6"). Sequence matches BREAK_LAND_CORNERS_EXPANSION order:
  //   4 (top main) → 5 (TR main) | 5 (TR ext) → 6 (R main) | 6 (R ext) →
  //   1 (bottom main) → 2 (BL main) | 2 (BL ext) → 3 (L main) | 3 (L ext).
  // i.e. labels[i] is the SEGMENT ENDING AT break i in CW order.
  const segmentLabels = [4, 5, 5, 6, 6, 1, 2, 2, 3, 3];

  // First pass: compute each break's land-corner anchor + the outer endpoint
  // where its seam meets the frame outline. Project radially from the bbox
  // center so the seam always reaches the border (and slightly past, for
  // visual cleanness against the dark frame stroke).
  type Break = { angle: number; landX: number; landY: number; outerX: number; outerY: number };
  const breaks: Break[] = [];
  for (const spec of BREAK_LAND_CORNERS_EXPANSION) {
    const hex = hexByKey.get(`${spec.q},${spec.r}`);
    if (!hex) continue;
    const c = hexCorner(hex, spec.corner);
    const angle = Math.atan2(c.y - cy, c.x - cx);
    const onFrame = rayToFlatTopHex(angle, R);
    breaks.push({
      angle,
      landX: c.x,
      landY: c.y,
      outerX: cx + onFrame.x,
      outerY: cy + onFrame.y,
    });
  }
  if (breaks.length !== BREAK_LAND_CORNERS_EXPANSION.length) return null;

  const elems: JSX.Element[] = [];

  // Each break: seam line from land corner outward to the frame border, with
  // a numbered badge sitting on the outer end of the seam itself (not on the
  // adjacent section). Label = the segment that ENDS at this break, so two
  // breaks bracketing a split side read as the same number twice (the "2,2"
  // and "5,5" pairs visible on the frame).
  for (let i = 0; i < breaks.length; i++) {
    const b = breaks[i];
    const d = puzzleBreakPath(b.landX, b.landY, b.outerX, b.outerY);
    // Label sits ON the frame edge at the seam's outer endpoint so it reads
    // as a "wax seal" stamped at the joint between two frame pieces — the
    // dark frame stroke passes through the badge's center.
    const lx = b.outerX;
    const ly = b.outerY;
    const label = segmentLabels[i];
    elems.push(
      <g key={`seam-${i}`}>
        <path d={d} fill="none" stroke="#a9d6ec" strokeWidth={0.10} strokeLinecap="round" opacity={0.5} />
        <path d={d} fill="none" stroke="#1f4666" strokeWidth={0.055} strokeLinecap="round" />
        <g transform={`translate(${lx} ${ly}) rotate(${-rotation})`}>
          <circle r={0.24} fill="#f4e4bc" stroke="#5d462a" strokeWidth={0.025} />
          <text
            x={0} y={0} dy={0.098}
            textAnchor="middle"
            fontSize={0.28} fontWeight={900} fill="#5d462a"
          >
            {label}
          </text>
        </g>
      </g>,
    );
  }

  return <>{elems}</>;
}

function pipDots(n: number, cx: number, cy: number): JSX.Element[] {
  const count = PIP_VALUE[n] ?? 0;
  const spacing = 0.05;
  const startX = cx - ((count - 1) * spacing) / 2;
  const y = cy + 0.20;
  const isRed = RED_NUMBERS.has(n);
  return Array.from({ length: count }, (_, i) => (
    <circle
      key={i}
      className={isRed ? 'pip-dot pip-dot--red' : 'pip-dot'}
      cx={startX + i * spacing}
      cy={y}
      r={0.022}
    />
  ));
}

// Idle gap after the last wheel tick before the wheel gesture is considered
// over. This is the wheel's ONLY release signal, which is why onDrag has to
// release the hold itself when it cancels the timer.
const WHEEL_IDLE_MS = 200;
// Dev-only poll for the leaked-hold diagnostic in panZoom.ts. Covers the case
// where a hold strands and the user never touches the board again, so no
// gesture-driven check would ever run.
const STRANDED_POLL_MS = 5000;

export function Board() {
  const map = useAppStore(s => s.map);
  const scored = useAppStore(s => s.scored);
  const showBestLocations = useAppStore(s => s.showBestLocations);
  const waterFrame = useAppStore(s => s.waterFrame);
  const rotation = useAppStore(s => s.rotation);
  const rotateBy = useAppStore(s => s.rotateBy);
  const resetRotation = useAppStore(s => s.resetRotation);
  const drawerOpen = useAppStore(s => s.drawerOpen);

  // Pan/zoom uses a hybrid path: CSS transform on the outer <svg> *during* an
  // active gesture (fast bitmap composite — fine for transient blur), then
  // SVG-native transform on an inner <g> *after* the gesture ends (sharp
  // vector at the resting zoom level). The transition is invisible because
  // the math represents the same view in both modes. iOS Safari otherwise
  // keeps a stretched bitmap of the SVG layer after CSS transform — which is
  // exactly the "still blurry when zoomed in and idle" complaint we saw.
  //
  // The view state, the two transform writers, and the rule that decides which
  // mode is live all live in panZoom.ts. This file owns only the gesture
  // plumbing: event binding, rAF coalescing, and the wheel idle timer.
  // Scenario overlays — visible whenever the rolled flavor is wealthGap or
  // hotZone, regardless of analyze toggle. The whole point of these scenarios
  // is being able to SEE the contested region / wealth divide; hiding them
  // behind a toggle defeats their purpose.
  const rolledFlavor = map?.variants.challenge.rolledFlavor;
  const hotZoneCluster = useMemo(() => {
    if (!map || rolledFlavor !== 'hotZone') return null;
    return findHotZoneCluster(map.hexes);
  }, [map, rolledFlavor]);
  const wealthGapInfo = useMemo(() => {
    if (!map || rolledFlavor !== 'wealthGap') return null;
    return findWealthGapAxis(map.hexes);
  }, [map, rolledFlavor]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panZoomRef = useRef<SVGGElement>(null);
  // Cached container bounds. getBoundingClientRect() can trigger a forced
  // layout flush, so we measure once on mount + on resize and reuse it.
  const boundsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  // rAF tokens for coalescing high-frequency events. Some precision pointer
  // devices fire pointermove > 120Hz; coalescing into one transform write
  // per frame prevents main-thread saturation.
  const wheelRafRef = useRef<number | null>(null);
  const wheelIdleRef = useRef<number | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pinchRafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      boundsRef.current = { width: rect.width, height: rect.height };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { viewBox, boardCx, boardCy, viewBoxR, frameR, portEndR } = useMemo(() => {
    if (!map) return { viewBox: '-6 -6 12 12', boardCx: 0, boardCy: 0, viewBoxR: 6, frameR: 6, portEndR: 5 };
    // Square viewBox centered on the board, sized to contain the water frame
    // (regular hex circumradius R) plus any port docks that reach beyond it
    // on coastal sides. (cx, cy) is also returned so the rotation transform
    // below can pivot around the BOARD's bbox center — for the 5-6 expansion
    // the staggered rows shift the land off (0,0). viewBoxR (= R) is used by
    // the gesture math to convert pixel deltas to SVG user units.
    //
    // labelReach: when a scenario overlay is active (wealthGap or hotZone),
    // reserve extra outer band for the RICH/SPARSE/HOT ZONE badges so they
    // sit past the port reach instead of covering ports. Balanced maps and
    // other scenarios keep the original tight viewBox.
    const { cx, cy, landR, R: hexFrameR } = regularHexFrame(map.hexes, FRAME_MARGIN);
    const portReach = 2.0;
    const stroke = 0.3;
    // labelReach extends the viewBox to fit RICH/POOR badges PAST the port
    // reach, which keeps those labels clear of the ports instead of sitting
    // on top of them. Only the wealthGap scenario needs this. hotZone's HOT
    // ZONE label sits IN the water frame (not past ports), so its viewBox
    // stays the original tight size and the board doesn't shrink for that
    // scenario.
    const rolled = map.variants.challenge.rolledFlavor;
    const labelReach = rolled === 'wealthGap' ? 0.7 : 0;
    const portEnd = landR + portReach;
    const R = Math.max(hexFrameR, portEnd + labelReach) + stroke;
    return {
      viewBox: `${(cx - R).toFixed(2)} ${(cy - R).toFixed(2)} ${(2 * R).toFixed(2)} ${(2 * R).toFixed(2)}`,
      boardCx: cx,
      boardCy: cy,
      viewBoxR: R,
      frameR: hexFrameR,
      portEndR: portEnd,
    };
  }, [map]);

  // Land-corner anchors of the puzzle-piece frame seams ("water breaks"). Each
  // seam runs radially out from one of these corners to the frame border, so a
  // dock starting at the same corner must steer off it. Only relevant when the
  // water frame (and thus the seams) is shown.
  const seamCorners = useMemo(() => {
    if (!map || !waterFrame) return [] as Array<{ x: number; y: number }>;
    const specs = map.playerCount <= 4 ? BREAK_LAND_CORNERS_BASE : BREAK_LAND_CORNERS_EXPANSION;
    const byKey = new Map(map.hexes.map(hx => [`${hx.q},${hx.r}`, hx] as const));
    const pts: Array<{ x: number; y: number }> = [];
    for (const s of specs) {
      const hx = byKey.get(`${s.q},${s.r}`);
      if (hx) pts.push(hexCorner(hx, s.corner));
    }
    return pts;
  }, [map, waterFrame]);

  // Board geometry the controller reads on every write. Assigned during
  // render (not in an effect) so a regenerated map, which can change viewBoxR
  // via the wealthGap label reach, is picked up on the very next frame rather
  // than one frame late.
  const geomRef = useRef({ viewBoxR, boardCx, boardCy });
  geomRef.current = { viewBoxR, boardCx, boardCy };

  // Open-drawer lift (mobile only). With the drawer open (75dvh) the visible
  // board strip is the top quarter of the screen, and the centered fit puts
  // the entire land area below it. Shift the container up just far enough
  // that the top row of tiles clears the sheet. The shift is paired
  // top/bottom insets that PRESERVE the container height: same height means
  // same fitted scale, which keeps the pan/zoom CSS-vs-SVG mode equivalence
  // intact (an alignment change like xMidYMin would break it, because the
  // CSS transform scales about the element center). The lift amount comes
  // from the real board geometry via openLiftPx, since no constant works
  // across phone/tablet/orientation.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return;
    if (!drawerOpen || !window.matchMedia(MOBILE_QUERY).matches) {
      el.style.top = '';
      el.style.bottom = '';
      return;
    }
    const apply = () => {
      // Re-checked per resize: crossing the desktop breakpoint while open
      // must drop the lift, not keep applying phone math to the side panel.
      if (!window.matchMedia(MOBILE_QUERY).matches) {
        el.style.top = '';
        el.style.bottom = '';
        return;
      }
      const rect = el.getBoundingClientRect();
      const lift = openLiftPx({
        containerWidthPx: rect.width,
        containerHeightPx: rect.height,
        viewBoxR: geomRef.current.viewBoxR,
        // Bottom vertex of the top tile row, in user units from the board
        // center (both layouts center at cy = 0): base board top row sits at
        // y = -3 (bottom vertex -2), the expansion's at -4.5 (bottom -3.5).
        topRowBottomUnits: map && map.playerCount > 4 ? -3.5 : -2,
        viewportHeightPx: window.innerHeight,
      });
      el.style.top = `${-lift}px`;
      el.style.bottom = `calc(var(--drawer-peek) + ${lift}px)`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      el.style.top = '';
      el.style.bottom = '';
    };
  }, [drawerOpen, map]);

  // Built once and never rebuilt: it reads geometry and the DOM nodes through
  // getters, so nothing about it goes stale when the map or container changes.
  const panZoomStore = useRef<PanZoom>();
  if (!panZoomStore.current) {
    panZoomStore.current = createPanZoom({
      handle: () => {
        const svg = svgRef.current;
        const g = panZoomRef.current;
        if (!svg || !g) return null;
        return {
          setCSSTransform: v => { svg.style.transform = v; },
          setWillChange: v => { svg.style.willChange = v; },
          setSVGTransform: v => {
            if (v === null) g.removeAttribute('transform');
            else g.setAttribute('transform', v);
          },
        };
      },
      geometry: () => {
        const { viewBoxR: r, boardCx: cx, boardCy: cy } = geomRef.current;
        // Pixels-per-user-unit at the current container size.
        // preserveAspectRatio "xMidYMid meet" fits the viewBox to the SMALLER
        // dimension of the container, so min(w, h) is the relevant factor.
        const { width, height } = boundsRef.current;
        const pxPerUnit = !width || !height ? 1 : Math.min(width, height) / (2 * r);
        return { viewBoxR: r, boardCx: cx, boardCy: cy, pxPerUnit };
      },
      dev: import.meta.env.DEV,
    });
  }
  const panZoom = panZoomStore.current;

  // Cancel every pending frame and timer on unmount. Without this a queued rAF
  // or the wheel idle timer can fire against torn-down refs.
  useEffect(() => () => {
    for (const ref of [wheelRafRef, dragRafRef, pinchRafRef]) {
      if (ref.current != null) {
        window.cancelAnimationFrame(ref.current);
        ref.current = null;
      }
    }
    if (wheelIdleRef.current != null) {
      window.clearTimeout(wheelIdleRef.current);
      wheelIdleRef.current = null;
    }
  }, []);

  // Dev-only leaked-hold watchdog. A stranded hold is silent on desktop and
  // only shows up as the iOS stale-bitmap blur, so it needs an active check
  // rather than waiting to be noticed.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const id = window.setInterval(() => panZoom.checkStranded(), STRANDED_POLL_MS);
    return () => window.clearInterval(id);
  }, [panZoom]);

  useGesture(
    {
      onDrag: ({ delta: [dxPx, dyPx], first, last }) => {
        if (first) {
          // Acquire BEFORE releasing the wheel below. Reversed, releasing the
          // wheel's last hold would swap to SVG mode and the acquire would
          // immediately swap back: two wasted DOM writes for no reason.
          panZoom.acquire('drag');
          // A wheel burst's idle timer is the wheel's ONLY release. Cancelling
          // it without releasing the hold would make that release unreachable
          // and strand the board in CSS mode for the rest of the session, so
          // the two happen together or not at all.
          if (wheelIdleRef.current != null) {
            window.clearTimeout(wheelIdleRef.current);
            wheelIdleRef.current = null;
            panZoom.release('wheel');
          }
          if (wheelRafRef.current != null) {
            window.cancelAnimationFrame(wheelRafRef.current);
            wheelRafRef.current = null;
          }
        }
        // Convert finger pixel delta → SVG-unit delta so the math stays
        // consistent across the CSS ↔ SVG transform swap at gesture end.
        panZoom.panByPixels(dxPx, dyPx);
        if (dragRafRef.current == null) {
          dragRafRef.current = window.requestAnimationFrame(() => {
            dragRafRef.current = null;
            panZoom.render();
          });
        }
        if (last) {
          if (dragRafRef.current != null) {
            window.cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = null;
          }
          panZoom.release('drag');
        }
      },
      onPinch: ({ offset: [s], first, last }) => {
        if (first) panZoom.acquire('pinch');
        panZoom.setPinchScale(s);
        if (pinchRafRef.current == null) {
          pinchRafRef.current = window.requestAnimationFrame(() => {
            pinchRafRef.current = null;
            panZoom.render();
          });
        }
        if (last) {
          if (pinchRafRef.current != null) {
            window.cancelAnimationFrame(pinchRafRef.current);
            pinchRafRef.current = null;
          }
          panZoom.release('pinch');
        }
      },
      onWheel: ({ event, delta: [, dy] }) => {
        event.preventDefault();
        // Idempotent per key, so this runs unconditionally on every tick
        // rather than being guarded on the idle timer being unset. The idle
        // timer below is what releases it, ~200ms after the last tick.
        panZoom.acquire('wheel');
        panZoom.zoomByWheel(dy);
        if (wheelRafRef.current == null) {
          wheelRafRef.current = window.requestAnimationFrame(() => {
            wheelRafRef.current = null;
            panZoom.render();
          });
        }
        if (wheelIdleRef.current != null) window.clearTimeout(wheelIdleRef.current);
        wheelIdleRef.current = window.setTimeout(() => {
          wheelIdleRef.current = null;
          if (wheelRafRef.current != null) {
            window.cancelAnimationFrame(wheelRafRef.current);
            wheelRafRef.current = null;
          }
          // If a drag started during the burst it still holds CSS mode, and
          // this hands off to it instead of swapping out from under it.
          panZoom.release('wheel');
        }, WHEEL_IDLE_MS);
      },
      onDoubleClick: () => {
        // Force every hold off and snap to identity in SVG mode. Forcing, not
        // releasing: this path never acquired, so a decrement here would
        // underflow. A gesture that is still live re-asserts SVG mode when it
        // ends, which is a no-op.
        panZoom.reset();
      },
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
    },
  );

  // The "top N" highlighted spots in the Analyze overlay come from the actual
  // snake-draft simulation (`scored.fairness.picks`) rather than just sorting
  // every intersection by score. The simulator already enforces the distance-2
  // rule between settlements, so we never highlight a clump of physically
  // impossible adjacent picks.
  const topNRanked = useMemo(() => {
    if (!scored || !showBestLocations) return [];
    return scored.fairness.picks
      .map(p => scored.spots.get(p.intersectionId))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
  }, [scored, showBestLocations]);

  if (!map || !scored) {
    return <div className="app__board" ref={containerRef} />;
  }

  return (
    <div className="app__board" ref={containerRef}>
      <svg
        ref={svgRef}
        className="board-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Per-resource fill gradients add a subtle painted/depth feel
              compared to flat fills. */}
          <radialGradient id="grad-wood" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#3d8a48" />
            <stop offset="100%" stopColor="#1f5028" />
          </radialGradient>
          <radialGradient id="grad-brick" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#c2543a" />
            <stop offset="100%" stopColor="#7a2510" />
          </radialGradient>
          <radialGradient id="grad-wheat" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#f0d273" />
            <stop offset="100%" stopColor="#b88d28" />
          </radialGradient>
          <radialGradient id="grad-sheep" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#b3dca0" />
            <stop offset="100%" stopColor="#6da655" />
          </radialGradient>
          <radialGradient id="grad-ore" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#878d9b" />
            <stop offset="100%" stopColor="#3f4654" />
          </radialGradient>
          <radialGradient id="grad-desert" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#ecd49a" />
            <stop offset="100%" stopColor="#b6914f" />
          </radialGradient>
          <radialGradient id="grad-sea" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#5fb1d8" />
            <stop offset="60%" stopColor="#3f8fc0" />
            <stop offset="100%" stopColor="#26628b" />
          </radialGradient>
          {/* Unit pointy-top hex (circumradius 1) centered at origin. Every
              TileArt wraps its scene with this clip-path so art elements
              (cloud silhouettes, hill paths, sheep, etc.) can never bleed
              past the hex boundary into neighbouring tiles or the sea. */}
          <clipPath id="hex-clip">
            <polygon points="0,-1 0.8660,-0.5 0.8660,0.5 0,1 -0.8660,0.5 -0.8660,-0.5" />
          </clipPath>
        </defs>

        {/* Pan/zoom group — its `transform` attribute is set imperatively by
            exitCSSMode() after a gesture ends, giving sharp vector rendering
            at the resting zoom level. During an active gesture this group's
            transform is empty and pan/zoom is applied via CSS transform on
            the outer <svg> instead (fast bitmap composite). */}
        <g ref={panZoomRef}>
        {/* Rotation wraps the whole board (water frame + land + ports + analyze)
            so everything spins together. Pivots around the board's bbox center
            (boardCx, boardCy) so the 5-6 expansion's off-origin layout still
            stays in the viewBox under rotation. */}
        <g transform={`rotate(${rotation} ${boardCx} ${boardCy})`}>
          {/* Water frame — a sea-colored hex that sits below the land so ports
              and docks read as floating in water instead of on the red page.
              Pure visual: toggled in the controls, NOT persisted in the map. */}
          {waterFrame && (
            // No filter on this group — at 4K the water-frame filter region
            // ends up ~4000x4000px, and every transform change forces the
            // browser to re-rasterize the filtered sub-tree (or composite a
            // very large filter buffer). The drop shadow is subtle enough
            // that the loss isn't noticeable.
            <g>
              <defs>
                <clipPath id="sea-clip">
                  <path d={seaFramePath(map.hexes, FRAME_MARGIN)} />
                </clipPath>
              </defs>
              <path
                d={seaFramePath(map.hexes, FRAME_MARGIN)}
                fill="url(#grad-sea)"
                stroke="#1f4666"
                strokeWidth={0.06}
              />
              {/* Wave highlights, clipped to the sea hexagon so nothing leaks
                  into the page background. */}
              <g
                clipPath="url(#sea-clip)"
                stroke="#a9d6ec"
                strokeWidth={0.025}
                strokeLinecap="round"
                opacity={0.55}
                fill="none"
              >
                {(() => {
                  const { minX, maxX, minY, maxY } = boundingBox(map.hexes);
                  const lines: JSX.Element[] = [];
                  const left = minX - 2.0;
                  const right = maxX + 2.0;
                  for (let y = minY - 2.0; y <= maxY + 2.0; y += 0.45) {
                    const offset = (Math.sin(y * 3.1) + 1) * 0.15;
                    const segs = Math.ceil((right - left) / 0.5);
                    let d = `M ${(left + offset).toFixed(3)},${y.toFixed(3)} q 0.25,-0.08 0.5,0`;
                    for (let i = 1; i < segs; i++) d += ' t 0.5,0';
                    lines.push(<path key={`wave-${y.toFixed(2)}`} d={d} />);
                  }
                  return lines;
                })()}
              </g>
            </g>
          )}

          {/* Continuous beach band — the land perimeter is traced as a single
              closed polygon and stroked thick with sandy tones. The inner half
              of each stroke is hidden under the tile fills below; the outer
              half forms a wide visible beach where the docks attach. Two
              layered strokes give a soft outer fade + denser inner core. */}
          {(() => {
            const edges = perimeterEdgesCW(map.hexes);
            if (edges.length === 0) return null;
            const hexById = new Map(map.hexes.map(h => [h.id, h]));
            const pts: string[] = [];
            for (const e of edges) {
              const hex = hexById.get(e.hexId);
              if (!hex) continue;
              const c = hexCorner(hex, e.side);
              pts.push(`${c.x.toFixed(3)},${c.y.toFixed(3)}`);
            }
            const d = `M${pts.join(' L')} Z`;
            return (
              <g>
                <path d={d} fill="none" stroke="#e8c98a" strokeWidth={0.62} strokeLinejoin="round" strokeLinecap="round" opacity={0.65} />
                <path d={d} fill="none" stroke="#d6a861" strokeWidth={0.34} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
              </g>
            );
          })()}

          {/* Puzzle-piece seam breaks render ABOVE the beach so the seam lines
              and section-number badges sit on top of the sandy band, not
              hidden underneath. 6 breaks for base (FrameCorners) or 10 for the
              5-6 expansion (FrameSeamsExpansion). Pattern: base 5-5-5-5-5-5,
              expansion 5-2-5-5-2-5-2-5-5-2. */}
          {waterFrame && (
            map.playerCount <= 4 ? (
              <FrameCorners hexes={map.hexes} margin={FRAME_MARGIN} rotation={rotation} />
            ) : (
              <FrameSeamsExpansion hexes={map.hexes} margin={FRAME_MARGIN} rotation={rotation} />
            )
          )}

          {/* Tile fills */}
          {map.hexes.map(h => (
            <path
              key={h.id}
              d={hexPath(h)}
              fill={`url(#grad-${h.resource})`}
              stroke="#3a2916"
              strokeWidth={0.04}
            />
          ))}

          {/* Scenario overlays — UNDER-TOKEN LAYER.
              wealthGap dividing line and hotZone cluster outlines render here
              (between tile fills and resource artwork) so that the number
              tokens stay on top and remain readable. The text labels for
              these scenarios render in a SEPARATE pass below the port marks,
              positioned off-board so they never obscure gameplay. */}
          {wealthGapInfo && (() => {
            const T = 9; // line half-length in hex units; covers any board size
            const SQRT3 = Math.sqrt(3);
            const lineSpec: Record<'q' | 'r' | 's',
              { x1: number; y1: number; x2: number; y2: number }> = {
              q: { x1: -T * 0.5, y1: -T * SQRT3 / 2, x2: T * 0.5, y2: T * SQRT3 / 2 },
              r: { x1: -T, y1: 0, x2: T, y2: 0 },
              s: { x1: -T * 0.5, y1: T * SQRT3 / 2, x2: T * 0.5, y2: -T * SQRT3 / 2 },
            };
            const { axis } = wealthGapInfo;
            const spec = lineSpec[axis];
            return (
              <g className="scenario-wealthgap-line">
                <line x1={spec.x1} y1={spec.y1} x2={spec.x2} y2={spec.y2}
                      stroke="#f4e4bc" strokeWidth={0.22} opacity={0.5} strokeLinecap="round" />
                <line x1={spec.x1} y1={spec.y1} x2={spec.x2} y2={spec.y2}
                      stroke="#5d462a" strokeWidth={0.08} strokeDasharray="0.32 0.20"
                      opacity={0.95} strokeLinecap="round" />
              </g>
            );
          })()}

          {hotZoneCluster && (
            <g className="scenario-hotzone-borders">
              {hotZoneCluster.map(hexId => {
                const h = map.hexes.find(x => x.id === hexId);
                if (!h) return null;
                return (
                  <g key={`hotzone-${hexId}`}>
                    <path d={hexPath(h)} fill="none" stroke="#d4441c"
                          strokeWidth={0.18} opacity={0.35} />
                    <path d={hexPath(h)} fill="none" stroke="#d4441c"
                          strokeWidth={0.09} strokeDasharray="0.22 0.10" opacity={0.95} />
                  </g>
                );
              })}
            </g>
          )}

          {/* Resource artwork — fills most of the hex. Each scene counter-rotates
              so the trees / sheep / mountains stay upright as the board spins. */}
          {map.hexes.map(h => {
            const { x, y } = axialToPixel({ q: h.q, r: h.r });
            return <TileArt key={`art-${h.id}`} resource={h.resource} cx={x} cy={y} rotation={rotation} />;
          })}

          {/* Number tokens — placed AT the tile center (not offset) so they
              stay aligned with the resource artwork beneath them under any
              rotation. The inner counter-rotation keeps the digit + pip dots
              right-side-up for the viewer. */}
          {map.hexes.map(h => {
            if (h.number === null) return null;
            const { x, y } = axialToPixel({ q: h.q, r: h.r });
            const isRed = RED_NUMBERS.has(h.number);
            return (
              <g key={`n-${h.id}`} transform={`translate(${x} ${y}) rotate(${-rotation})`}>
                <circle
                  cx={0} cy={0} r={0.36}
                  className={isRed ? 'number-token number-token--red' : 'number-token'}
                />
                <circle
                  cx={0} cy={0} r={0.31}
                  fill="none" stroke="#9c7a3d" strokeWidth={0.012} opacity={0.7}
                />
                <text
                  x={0} y={-0.05} dy={0.119}
                  className={isRed ? 'number-text number-text--red' : 'number-text'}
                  fontSize={0.34}
                >
                  {h.number}
                </text>
                {pipDots(h.number, 0, 0)}
              </g>
            );
          })}

          {/* Ports */}
          {map.ports.map((p, idx) => (
            <PortMark
              key={`p-${idx}`}
              port={p}
              hexes={map.hexes}
              rotation={rotation}
              boardCx={boardCx}
              boardCy={boardCy}
              frameR={frameR}
              seamCorners={seamCorners}
            />
          ))}

          {/* Scenario LABELS are rendered OUTSIDE this rotation group (just
              before the panZoom group closes) so they always sit at the
              visual top / perpendicular edges of the rotated cluster +
              divider, instead of rotating with the board into arbitrary
              positions. See the labels block below the rotation group. */}

          {showBestLocations && topNRanked.length > 0 && (
            <g>
              {Array.from(scored.spots.values()).map(spot => {
                const inter = scored.graph.intersections.get(spot.intersectionId)!;
                const rank = topNRanked.findIndex(s => s.intersectionId === spot.intersectionId);
                if (rank === -1) {
                  return (
                    <g key={`badge-${inter.id}`} transform={`translate(${inter.x} ${inter.y}) rotate(${-rotation})`}>
                      <circle className="spot-badge" cx={0} cy={0} r={0.18} opacity={0.65} />
                      <text className="spot-text" x={0} y={0} dy={0.077}>
                        {spot.total.toFixed(1)}
                      </text>
                    </g>
                  );
                }
                return (
                  <g key={`rank-${inter.id}`} transform={`translate(${inter.x} ${inter.y}) rotate(${-rotation})`}>
                    <circle className="spot-rank" cx={0} cy={0} r={0.28} />
                    <circle className="spot-badge" cx={0} cy={0} r={0.22} />
                    <text className="spot-rank-text" x={0} y={-0.04} dy={0.077}>
                      {rank + 1}
                    </text>
                    <text className="spot-text" x={0} y={0.13} dy={0.056} fontSize={0.16}>
                      {spot.total.toFixed(1)}
                    </text>
                  </g>
                );
              })}
              {Array.from(scored.spots.values())
                .filter(s => s.hasRoadCombo || s.hasCityCombo)
                .map(s => {
                  const inter = scored.graph.intersections.get(s.intersectionId)!;
                  const icon = s.hasCityCombo ? '♔' : '⚒';
                  return (
                    <text
                      key={`syn-${s.intersectionId}`}
                      className="synergy-icon"
                      dy={0.077}
                      transform={`translate(${inter.x + 0.32} ${inter.y - 0.32}) rotate(${-rotation})`}
                    >
                      {icon}
                    </text>
                  );
                })}
            </g>
          )}

        </g>
        {/* Scenario LABELS — rendered OUTSIDE the rotation group so they
            always sit at the VISUAL top / perpendicular axis of the
            currently-rotated content. Inside panZoom so they still pan
            and zoom with the board. Positions are computed in screen
            (post-rotation) coordinates by applying the current rotation
            angle to the cluster geometry and dividing-line direction. */}
        {(hotZoneCluster || wealthGapInfo) && (() => {
          const rad = (rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const rotateAroundBoard = (px: number, py: number) => ({
            x: boardCx + (px - boardCx) * cos - (py - boardCy) * sin,
            y: boardCy + (px - boardCx) * sin + (py - boardCy) * cos,
          });
          return (
            <>
              {hotZoneCluster && (() => {
                const clusterHexes = hotZoneCluster
                  .map(id => map.hexes.find(h => h.id === id))
                  .filter((h): h is Hex => !!h);
                if (clusterHexes.length === 0) return null;
                // Label placement rule: take the cluster's BORDER (not centers),
                // find the highest screen-y (could be a singular vertex or
                // an edge between two vertices at the same y after rotation),
                // and center the label on that.
                //
                // Compute every cluster-hex vertex in screen coords, take
                // the minimum y, then average the x of all vertices within
                // a small tolerance of that min (which handles the "edge"
                // case where two top vertices sit at the same y).
                const vertices = clusterHexes.flatMap(h => {
                  const pts: Array<{ x: number; y: number }> = [];
                  for (let c = 0; c < 6; c++) {
                    const { x, y } = hexCorner(h, c);
                    pts.push(rotateAroundBoard(x, y));
                  }
                  return pts;
                });
                const minY = Math.min(...vertices.map(v => v.y));
                const TOP_TOL = 0.02;
                const topVertices = vertices.filter(v => v.y <= minY + TOP_TOL);
                const topLeft = Math.min(...topVertices.map(v => v.x));
                const topRight = Math.max(...topVertices.map(v => v.x));
                const centerX = (topLeft + topRight) / 2;
                // Label CENTER sits slightly BELOW the highest border point
                // (0.12 down). This shifts the label fully out of the y-range
                // of the upper-neighbour tokens (which sit at distance 0.5
                // above the border vertex, token radius 0.36, so their bottom
                // edge ends at vertex y - 0.14). With label half-height 0.22
                // and 0.12 offset, label top is at vertex y - 0.10 — fully
                // below the upper-token y range at any rotation.
                const labelY = minY + 0.12;
                return (
                  <g transform={`translate(${centerX} ${labelY})`} className="scenario-hotzone-label">
                    <rect x={-0.85} y={-0.22} width={1.7} height={0.44} rx={0.10}
                          fill="#d4441c" stroke="#5d462a" strokeWidth={0.04} opacity={0.92} />
                    <text textAnchor="middle" dy={0.085} fontSize={0.26} fontWeight={700}
                          fill="#f4e4bc" letterSpacing={0.02}>HOT ZONE</text>
                  </g>
                );
              })()}

              {wealthGapInfo && (() => {
                const SQRT3 = Math.sqrt(3);
                const perpSpec: Record<'q' | 'r' | 's', { perpX: number; perpY: number }> = {
                  q: { perpX: SQRT3 / 2, perpY: -0.5 },
                  r: { perpX: 0, perpY: 1 },
                  s: { perpX: -SQRT3 / 2, perpY: -0.5 },
                };
                const { axis, richSide } = wealthGapInfo;
                const { perpX, perpY } = perpSpec[axis];
                // Rotate the perpendicular direction by the current board
                // rotation so the labels sit on opposite ENDS of the visible
                // dividing line, not where the line was pre-rotation.
                const rotPerpX = perpX * cos - perpY * sin;
                const rotPerpY = perpX * sin + perpY * cos;
                const labelOffset = portEndR + 0.35;
                const richX = boardCx + rotPerpX * labelOffset * richSide;
                const richY = boardCy + rotPerpY * labelOffset * richSide;
                const sparseX = boardCx - rotPerpX * labelOffset * richSide;
                const sparseY = boardCy - rotPerpY * labelOffset * richSide;
                return (
                  <g className="scenario-wealthgap-labels">
                    <g transform={`translate(${richX} ${richY})`}>
                      <rect x={-0.70} y={-0.22} width={1.4} height={0.44} rx={0.10}
                            fill="#da954b" stroke="#5d462a" strokeWidth={0.04} opacity={0.95} />
                      <text textAnchor="middle" dy={0.085} fontSize={0.27} fontWeight={700}
                            fill="#5d462a" letterSpacing={0.02}>RICH</text>
                    </g>
                    <g transform={`translate(${sparseX} ${sparseY})`}>
                      <rect x={-0.65} y={-0.22} width={1.3} height={0.44} rx={0.10}
                            fill="#7b7c47" stroke="#5d462a" strokeWidth={0.04} opacity={0.92} />
                      <text textAnchor="middle" dy={0.085} fontSize={0.27} fontWeight={700}
                            fill="#f4e4bc" letterSpacing={0.02}>POOR</text>
                    </g>
                  </g>
                );
              })()}
            </>
          );
        })()}
        </g>
      </svg>
      <div className="board__view-controls">
        {/* The two nudges are one control (a pair in a shared pill); the
            degree readout doubles as the reset and disables at 0°, where
            resetting is a no-op. The pan/zoom reset is a separate concern
            and sits apart behind a wider gap. */}
        <div className="board__rotate" role="group" aria-label="Rotate board">
          <button
            className="board__rotate-btn"
            onClick={() => rotateBy(-30)}
            aria-label="Rotate counter-clockwise"
            title="Rotate 30° counter-clockwise"
          >
            ↺
          </button>
          <button
            className="board__rotate-btn"
            onClick={() => rotateBy(30)}
            aria-label="Rotate clockwise"
            title="Rotate 30° clockwise"
          >
            ↻
          </button>
        </div>
        <button
          className="board__btn board__btn--label"
          onClick={resetRotation}
          disabled={rotation === 0}
          aria-label="Reset rotation to 0°"
          title="Reset rotation to 0°"
        >
          {rotation}<span className="board__btn-degree">°</span>
          {/* The clear glyph is the non-color cue that the readout is now an
              action; at 0° it is absent and the pill is a plain readout. */}
          {rotation !== 0 && <span className="board__btn-clear" aria-hidden="true">×</span>}
        </button>
        <button
          className="board__btn board__btn--panzoom"
          onClick={() => panZoom.reset()}
          aria-label="Reset pan and zoom"
          title="Reset pan/zoom (or double-tap board)"
        >
          ⟲
        </button>
      </div>
    </div>
  );
}

// 6 land-hex corners where the canonical 5th-edition sea frame pieces meet.
// Each break sits at the corner of a corner-hex of the overall board, at
// every 5th perimeter edge (30 edges / 6 pieces). Currently base-game only.
//
// Positions are shifted one perimeter edge CCW from the original "right edge
// of the bottom-left port" anchor: each corner is now the one immediately
// before its previous position in CW traversal.
const BREAK_LAND_CORNERS_BASE: Array<{ q: number; r: number; corner: number }> = [
  { q: -2, r:  2, corner: 3 },  // bottom of bottom-left corner-hex
  { q: -2, r:  0, corner: 4 },  // bottom-left of left-middle corner-hex
  { q:  0, r: -2, corner: 5 },  // top-left of top-left corner-hex
  { q:  2, r: -2, corner: 0 },  // top of top-right corner-hex
  { q:  2, r:  0, corner: 1 },  // top-right of right-middle corner-hex
  { q:  0, r:  2, corner: 2 },  // bottom-right of bottom-right corner-hex
];

// SVG path for a puzzle-piece break: an S-shaped wavy line from the inner
// anchor (land corner) outward to the outer anchor (water frame perimeter),
// with a small interlock bump in the middle that reads as two pieces meeting.
function puzzleBreakPath(innerX: number, innerY: number, outerX: number, outerY: number): string {
  const dx = outerX - innerX;
  const dy = outerY - innerY;
  const len = Math.hypot(dx, dy) || 1;
  // Tangent perpendicular to the radial direction (along the perimeter).
  const tx = -dy / len;
  const ty = dx / len;
  const bump = Math.min(0.22, len * 0.25);
  // Two quadratic curves with opposite-side controls produce a clean S-curve;
  // the reference sketch is essentially a single sine-wave seam.
  const pt = (t: number, perp: number) => ({
    x: innerX + dx * t + tx * perp,
    y: innerY + dy * t + ty * perp,
  });
  const mid = pt(0.50, 0);
  const c1 = pt(0.28, bump);
  const c2 = pt(0.72, -bump);
  return (
    `M ${innerX.toFixed(3)},${innerY.toFixed(3)}` +
    ` Q ${c1.x.toFixed(3)},${c1.y.toFixed(3)} ${mid.x.toFixed(3)},${mid.y.toFixed(3)}` +
    ` Q ${c2.x.toFixed(3)},${c2.y.toFixed(3)} ${outerX.toFixed(3)},${outerY.toFixed(3)}`
  );
}

function FrameCorners({ hexes, margin, rotation }: { hexes: Hex[]; margin: number; rotation: number }) {
  const { cx, cy, R } = regularHexFrame(hexes, margin);
  const hexByKey = new Map(hexes.map(h => [`${h.q},${h.r}`, h] as const));
  const breaks = BREAK_LAND_CORNERS_BASE.map(spec => {
    const hex = hexByKey.get(`${spec.q},${spec.r}`);
    if (!hex) return null;
    const corner = hexCorner(hex, spec.corner);
    const angle = Math.atan2(corner.y - cy, corner.x - cx);
    return { angle, landX: corner.x, landY: corner.y };
  }).filter((b): b is { angle: number; landX: number; landY: number } => b !== null);

  if (breaks.length !== 6) return null;

  // Sort CCW (increasing angle, normalized to [0, 2π)).
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sorted = breaks.slice().sort((a, b) => norm(a.angle) - norm(b.angle));

  const elems: JSX.Element[] = [];

  // Puzzle-piece seams + numbered break labels. Each one is a wavy line from
  // the land hex corner outward through the water to the outer edge of the
  // frame, with a section number badge sitting on the outer end of the seam.
  // Labels go 1..6 CW starting from the break in the bottom area (closest to
  // SVG +y), matching the reference layout.
  for (let i = 0; i < 6; i++) {
    const b = sorted[i];
    const proj = rayToFlatTopHex(b.angle, R);
    const outerX = cx + proj.x;
    const outerY = cy + proj.y;
    const d = puzzleBreakPath(b.landX, b.landY, outerX, outerY);
    const label = i + 1;
    // Label sits ON the frame edge at the seam's outer endpoint — the dark
    // frame stroke passes through the badge so it reads as a "wax seal"
    // stamped at each piece-to-piece joint.
    const lx = outerX;
    const ly = outerY;
    elems.push(
      <g key={`break-${i}`}>
        {/* Light highlight halo so the seam stays visible against any sea tone */}
        <path d={d} fill="none" stroke="#a9d6ec" strokeWidth={0.10} strokeLinecap="round" opacity={0.5} />
        {/* Main seam line */}
        <path d={d} fill="none" stroke="#1f4666" strokeWidth={0.055} strokeLinecap="round" />
        {/* Numbered badge sitting on the outer end of the seam */}
        <g transform={`translate(${lx} ${ly}) rotate(${-rotation})`}>
          <circle r={0.26} fill="#f4e4bc" stroke="#5d462a" strokeWidth={0.03} />
          <text
            x={0} y={0} dy={0.112}
            textAnchor="middle"
            fontSize={0.32}
            fontWeight={900}
            fill="#5d462a"
          >
            {label}
          </text>
        </g>
      </g>,
    );
  }

  return <>{elems}</>;
}

function PortMark({
  port, hexes, rotation, boardCx, boardCy, frameR, seamCorners,
}: {
  port: Port; hexes: Hex[]; rotation: number;
  boardCx: number; boardCy: number; frameR: number;
  seamCorners: Array<{ x: number; y: number }>;
}) {
  const hex = hexes.find(h => h.id === port.hexId);
  if (!hex) return null;
  const a = hexCorner(hex, port.side);
  const b = hexCorner(hex, (port.side + 1) % 6);
  // A dock whose corner anchors a frame seam ("water break") must steer toward
  // the midpoint instead of radially out, or it lands right on the seam line.
  const onSeam = (corner: { x: number; y: number }) =>
    seamCorners.some(s => Math.hypot(s.x - corner.x, s.y - corner.y) < 0.12);
  const aOnSeam = onSeam(a);
  const bOnSeam = onSeam(b);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const center = axialToPixel({ q: hex.q, r: hex.r });

  // Per-hex outward normal — straight out from the coastal edge into the sea.
  // Using this (not the board-radial) keeps the docks pointing naturally
  // seaward instead of skewing sideways.
  const nx = mid.x - center.x;
  const ny = mid.y - center.y;
  const nLen = Math.sqrt(nx * nx + ny * ny) || 1;
  const ux = nx / nLen;
  const uy = ny / nLen;

  // Edge direction (corner a -> corner b) for offsetting each dock's inner edge.
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const eLen = Math.sqrt(ex * ex + ey * ey) || 1;
  const eux = ex / eLen;
  const euy = ey / eLen;

  // The ship floats straight out from the edge midpoint, well clear of the
  // docks. Start it generously out in the water, then pull it in ONLY if it
  // would otherwise poke past the frame hexagon (so it never hangs off the map
  // nor crowds a neighbour's tokens).
  const SHIP_REACH = 0.47; // worst-case ship extent from its (centered) anchor
  const sector = Math.PI / 3;
  const apothem = (frameR * Math.sqrt(3)) / 2;
  let shipDist = 1.13;
  for (let i = 0; i < 16; i++) {
    const px = mid.x + ux * shipDist - boardCx;
    const py = mid.y + uy * shipDist - boardCy;
    const pd = Math.sqrt(px * px + py * py);
    let theta = Math.atan2(py, px);
    while (theta < 0) theta += 2 * Math.PI;
    const sectorMid = Math.floor(theta / sector) * sector + sector / 2;
    const boundaryDist = apothem / Math.cos(theta - sectorMid);
    if (pd + SHIP_REACH <= boundaryDist || shipDist <= 0.72) break;
    shipDist -= 0.05;
  }
  const shipCx = mid.x + ux * shipDist;
  const shipCy = mid.y + uy * shipDist;

  // Two plank docks — one anchored at each coastal corner, offset inward toward
  // the edge midpoint, angling out toward the open water.
  // Sizes (~8% under the original — a bit bigger than the previous pass).
  const dockWidth = 0.21; // span along the coast (plank width)
  // Per-port length variance (deterministic from the port position, so it varies
  // generation-to-generation but never flickers on re-render): ±10%.
  const lenSeed = Math.sin(mid.x * 45.13 + mid.y * 9.71) * 9123.4;
  const dockLen = 0.53 * (0.9 + 0.2 * (lenSeed - Math.floor(lenSeed))); // reach out to sea
  const dockBaseOffset = 0.065; // start the dock just off the coastline
  const plankLen = 0.081; // fixed visual plank length (anchored from the tip)
  const pilingSpacing = 0.171; // fixed log spacing (anchored from the tip)

  // Is the edge bordering a given corner LAND (a hex sits across it) or open
  // water? A dock at a land-backed corner must lean inward enough to clear that
  // land/border; a corner facing open water may run nearly straight — and that
  // difference is where the safe angle variety comes from.
  const EDGE_TO_NEIGHBOR = [1, 0, 5, 4, 3, 2];
  const nbrs = neighbors(hex);
  const hexKeys = new Set(hexes.map(hx => `${hx.q},${hx.r}`));
  const edgeIsLand = (edgeSide: number) => {
    const nb = nbrs[EDGE_TO_NEIGHBOR[((edgeSide % 6) + 6) % 6]];
    return hexKeys.has(`${nb.q},${nb.r}`);
  };
  // Corner a (= corner `side`) borders edge side-1; corner b (corner side+1)
  // borders edge side+1.
  const aClosed = edgeIsLand(port.side - 1);
  const bClosed = edgeIsLand(port.side + 1);

  // Per-edge variance (deterministic: edge angle + per-port spatial hash, so two
  // neighbouring ports never match). Stable across re-renders (just geometry).
  const edgeAngle = Math.atan2(uy, ux);
  const h = Math.sin(mid.x * 12.9898 + mid.y * 78.233) * 43758.5453;
  const jitter = (h - Math.floor(h)) * Math.PI * 2; // unique 0..2π phase per port
  const dockWobble = Math.sin(edgeAngle * 2.3 + jitter) * 0.2; // shared tilt
  const dockSplay = Math.sin(edgeAngle * 3.7 + jitter * 1.5) * 0.14; // asymmetry

  // Each dock leans toward the ship (i.e. toward the edge midpoint) — `de` is the
  // along-coast component of its heading, derived from the direction to the ship,
  // so both docks angle inward like a real harbour. Converging that way also
  // pulls a dock off its corner's coast/seam. A land-backed corner gets a bit
  // more inset; a seam corner steers a touch harder to clear the radial break.
  // The mutual cap below then trims the lean only as much as needed to keep the
  // two docks' logs apart, so they stay as inward as space allows.
  const cornerDir = (corner: { x: number; y: number }, closed: boolean, sign: number, seam: boolean) => {
    const sdx = shipCx - corner.x;
    const sdy = shipCy - corner.y;
    const sl = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
    let de = (sdx / sl) * eux + (sdy / sl) * euy; // lean toward the ship/midpoint
    let inset = closed ? 0.1 : 0.05;
    if (seam) {
      inset = 0.13;
      de += 0.12 * sign; // steer harder off the radial seam line
    }
    return { de, inset };
  };
  const aSet = cornerDir(a, aClosed, 1, aOnSeam);
  const bSet = cornerDir(b, bClosed, -1, bOnSeam);
  // Add the per-port/per-dock variance, then keep within a sane cone.
  const clampDe = (de: number) => Math.max(-0.5, Math.min(0.5, de));
  let deA = clampDe(aSet.de + (dockWobble + dockSplay) * 0.6);
  let deB = clampDe(bSet.de + (dockWobble - dockSplay) * 0.6);
  // The ONLY coupling between the two docks: if both happen to lean toward the
  // midpoint (deA>0 and deB<0), pull them back just enough to keep their inner
  // tips/pilings apart. Docks that fan apart (the usual case) are never touched,
  // so each keeps its own independent angle.
  const convA = Math.max(0, deA);
  const convB = Math.max(0, -deB);
  const innerGap = 1 - aSet.inset - bSet.inset - 2 * dockWidth;
  const mutualCap = Math.max(0, (innerGap - 0.17) / dockLen);
  if (convA + convB > mutualCap) {
    const excess = convA + convB - mutualCap;
    const tot = convA + convB || 1;
    deA -= excess * (convA / tot);
    deB += excess * (convB / tot);
  }

  function makeDock(corner: { x: number; y: number }, sign: number, de: number, inset: number) {
    // Foot nudged inward along the coast toward the midpoint, off the corner.
    const footX = corner.x + eux * inset * sign;
    const footY = corner.y + euy * inset * sign;
    // Inner base point, offset further along the edge toward the midpoint.
    const inner = { x: footX + eux * dockWidth * sign, y: footY + euy * dockWidth * sign };
    // de is the along-coast heading; du keeps the dock pointing out to sea.
    const du = Math.sqrt(Math.max(0.0001, 1 - de * de));
    const tux = de * eux + du * ux;
    const tuy = de * euy + du * uy;
    // Push the whole dock out off the coastline so it sits in the water.
    const cBase = { x: footX + tux * dockBaseOffset, y: footY + tuy * dockBaseOffset };
    const iBase = { x: inner.x + tux * dockBaseOffset, y: inner.y + tuy * dockBaseOffset };
    const cOut = { x: cBase.x + tux * dockLen, y: cBase.y + tuy * dockLen };
    const iOut = { x: iBase.x + tux * dockLen, y: iBase.y + tuy * dockLen };
    const path =
      `M ${cBase.x.toFixed(3)},${cBase.y.toFixed(3)} L ${iBase.x.toFixed(3)},${iBase.y.toFixed(3)}` +
      ` L ${iOut.x.toFixed(3)},${iOut.y.toFixed(3)} L ${cOut.x.toFixed(3)},${cOut.y.toFixed(3)} Z`;
    // Plank seams are spaced a fixed length back from the seaward tip, so the
    // leftover (a half plank) lands at the foot and the planking is unchanged.
    const pt = (t: number, edge: { x: number; y: number }) => ({
      x: edge.x + tux * dockLen * t,
      y: edge.y + tuy * dockLen * t,
    });
    const nSeams = Math.max(1, Math.floor(dockLen / plankLen - 0.05));
    const planks = Array.from({ length: nSeams }, (_, i) => {
      const t = 1 - ((i + 1) * plankLen) / dockLen;
      const a = pt(t, cBase);
      const b = pt(t, iBase);
      return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
    });
    // Support pilings (log cross-sections) down both edges — three pairs anchored
    // from the seaward tip at a fixed spacing, so trimming the foot leaves their
    // spacing/alignment untouched.
    const pilings = [0, 1, 2].flatMap(m => {
      const t = 1 - (m * pilingSpacing) / dockLen;
      return [pt(t, cBase), pt(t, iBase)];
    });
    return { path, planks, pilings };
  }
  const docks = [makeDock(a, 1, deA, aSet.inset), makeDock(b, -1, deB, bSet.inset)];

  return (
    <g>
      {/* Two plank docks, angled in toward the ship */}
      {docks.map((d, di) => (
        <g key={di}>
          <path d={d.path} fill="#9c6a32" stroke="#3a2510" strokeWidth={0.017} />
          {d.planks.map((p, i) => (
            <line key={i} x1={p.ax} y1={p.ay} x2={p.bx} y2={p.by} stroke="#5d3a18" strokeWidth={0.015} />
          ))}
          {/* Support pilings — drawn as log cross-sections (a wood-toned disc
              with a darker heartwood centre) so they read correctly top-down. */}
          {d.pilings.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={0.039} fill="#7a4e23" stroke="#2a1808" strokeWidth={0.013} />
              <circle cx={p.x} cy={p.y} r={0.016} fill="none" stroke="#4a2d12" strokeWidth={0.009} />
            </g>
          ))}
        </g>
      ))}

      {/* Ship counter-rotates so its mast/flag stay upright for the viewer
          regardless of board rotation. */}
      <g transform={`translate(${shipCx} ${shipCy}) rotate(${-rotation})`}>
        <PortShip type={port.type} />
      </g>
    </g>
  );
}

// A little merchant ship rendered upright in local coordinates, with its bbox
// balanced around the origin (flag above, hull below) so the anchor sits at the
// ship's centre — this keeps its reach symmetric and small, so a ship is far
// less likely to swing its flag over a neighbouring number token. The flag
// carries the resource icon over the trade ratio, all on the one flag.
function PortShip({ type }: { type: PortType }) {
  const isGeneric = type === 'generic';
  const flagFill = isGeneric ? '#f4e4bc' : `url(#grad-${type})`;
  const label = isGeneric ? '3:1' : '2:1';
  return (
    <g>
      {/* Mast — runs the full height; a stretch of it shows bare between the
          sail and the (lowered) hull. */}
      <line x1={0} y1={0.18} x2={0} y2={-0.35} stroke="#5d3a18" strokeWidth={0.03} strokeLinecap="round" />

      {/* Sail — a billowing curve as if filled by wind (straight luff on the
          mast, bulging leech, bowed head and foot), kept balanced about the mast
          so its contents sit centred. It carries the resource icon over the
          trade ratio. For 2:1 ports the ratio sits on a parchment label that
          reads against the coloured sail; the 3:1 (generic) sail is already
          parchment, so the box would be a redundant outline — drop it and
          enlarge the text. */}
      <path
        d="M -0.17,-0.28 Q 0,-0.33 0.13,-0.26 C 0.22,-0.15 0.22,-0.01 0.13,0.08 Q 0,0.12 -0.17,0.08 Z"
        fill={flagFill} stroke="#3a2916" strokeWidth={0.02} strokeLinejoin="round"
      />
      {isGeneric ? (
        <>
          <g transform="translate(0 -0.14)">
            <PortGlyph type={type} size={0.62} />
          </g>
          <text x={0} y={0.0} dy={0.058} textAnchor="middle"
                fontSize={0.14} fontWeight={900} fill="#4a3415">{label}</text>
        </>
      ) : (
        <>
          <g transform="translate(0 -0.12)">
            <PortGlyph type={type} size={0.6} />
          </g>
          {/* The label is allowed to bleed slightly past the sail edge — reads
              fine and keeps the ratio nice and legible. */}
          <rect x={-0.17} y={0.02} width={0.34} height={0.13} rx={0.03}
                fill="#f4e4bc" stroke="#5d462a" strokeWidth={0.017} />
          <text x={0} y={0.085} dy={0.042} textAnchor="middle"
                fontSize={0.12} fontWeight={900} fill="#4a3415">{label}</text>
        </>
      )}

      {/* Hull — shorter top-to-bottom, lowered so a length of bare mast (pole)
          shows above it. */}
      <rect x={-0.24} y={0.18} width={0.48} height={0.05} rx={0.02}
            fill="#a9743a" stroke="#3a2510" strokeWidth={0.02} />
      <path d="M -0.24,0.225 L 0.24,0.225 L 0.17,0.37 Q 0,0.42 -0.17,0.37 Z"
            fill="#8a5a2b" stroke="#3a2510" strokeWidth={0.022} />
      <path d="M -0.19,0.28 Q 0,0.33 0.19,0.28" fill="none" stroke="#5d3a18" strokeWidth={0.015} />
    </g>
  );
}
