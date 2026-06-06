// Board → PNG export / native share.
//
// The board is rendered as inline SVG, but its number tokens, pip dots, spot
// badges, etc. are styled through CSS *classes* (see app.css) that resolve CSS
// custom properties from :root. A bare XMLSerializer dump would therefore lose
// every class-based fill/stroke/font. To get a faithful capture we:
//   1. deep-clone the live <svg>,
//   2. reset the pan/zoom transform so the whole board is framed (rotation is
//      kept — that's a deliberate part of what the user sees),
//   3. walk the original + clone in parallel and copy a whitelist of *computed*
//      style properties onto the clone as inline styles (this also resolves the
//      var(--…) references to concrete colours automatically),
//   4. give the clone explicit pixel dimensions + an opaque background,
//   5. rasterize via an <img> → <canvas> → PNG blob.
//
// Everything is self-contained (no external fonts/images), so the canvas never
// gets tainted and toBlob() works even on iOS Safari.

const WATERMARK = 'Catan Map Generator';

// Presentation properties worth carrying over. Deliberately excludes width /
// height / transform / transform-origin / will-change so the clone's own
// attributes drive sizing and the reset transform stands.
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'letter-spacing',
  'paint-order',
] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface CaptureOptions {
  /** Longest output edge in pixels. Default 1600 (crisp for chat/social). */
  maxEdgePx?: number;
  /** Opaque background behind the board. Default matches the app page (deep red). */
  background?: string;
  /** Small label stamped bottom-left, e.g. the seed. Omitted if undefined. */
  seedLabel?: string;
  /** Watermark stamped bottom-right. Default WATERMARK; pass '' to suppress. */
  watermark?: string;
}

function findBoardSvg(): SVGSVGElement {
  const svg = document.querySelector<SVGSVGElement>('svg.board-svg');
  if (!svg) throw new Error('Board SVG not found — generate a map first.');
  return svg;
}

/** Render the current board to a PNG Blob. */
export async function captureBoardPng(opts: CaptureOptions = {}): Promise<Blob> {
  const { maxEdgePx = 1600, background = '#ac2c07' } = opts;
  const watermark = opts.watermark ?? WATERMARK;

  const live = findBoardSvg();
  const clone = live.cloneNode(true) as SVGSVGElement;

  // Reset pan/zoom: the only direct <g> child of the svg is the pan/zoom group
  // (Board.tsx writes its transform imperatively). Dropping it reframes the
  // full board. Any leftover CSS transform on the svg element itself is cleared
  // too (it can hold a transform mid-gesture, though export runs at rest).
  clone.removeAttribute('style');
  clone.style.transform = 'none';
  const panZoom = clone.querySelector(':scope > g');
  if (panZoom) panZoom.removeAttribute('transform');

  // Copy computed styles from the live tree onto the clone (1:1 by document
  // order — cloneNode preserves order). querySelectorAll('*') excludes the root
  // svg, which keeps its viewBox/attributes untouched.
  const liveEls = live.querySelectorAll<SVGElement>('*');
  const cloneEls = clone.querySelectorAll<SVGElement>('*');
  for (let i = 0; i < liveEls.length; i++) {
    const computed = window.getComputedStyle(liveEls[i]);
    const target = cloneEls[i];
    if (!target) continue;
    let inline = '';
    for (const prop of STYLE_PROPS) {
      const val = computed.getPropertyValue(prop);
      if (val && val !== 'normal') inline += `${prop}:${val};`;
    }
    if (inline) target.setAttribute('style', inline);
  }

  // viewBox → output dimensions.
  const vb = (clone.getAttribute('viewBox') ?? '0 0 100 100').split(/\s+/).map(Number);
  const [minX, minY, vbW, vbH] = vb;
  const scale = maxEdgePx / Math.max(vbW, vbH);
  const outW = Math.round(vbW * scale);
  const outH = Math.round(vbH * scale);
  clone.setAttribute('width', String(outW));
  clone.setAttribute('height', String(outH));
  clone.setAttribute('xmlns', SVG_NS);

  // Opaque background rect, inserted as the first paintable child.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(minX));
  bg.setAttribute('y', String(minY));
  bg.setAttribute('width', String(vbW));
  bg.setAttribute('height', String(vbH));
  bg.setAttribute('fill', background);
  clone.insertBefore(bg, clone.firstChild);

  // Watermark (bottom-right) + optional seed (bottom-left), in viewBox units so
  // they scale with the board. paint-order:stroke gives a subtle outline so the
  // text stays legible over either sea or land.
  const pad = vbW * 0.022;
  const fontSize = vbW * 0.026;
  const stamp = (text: string, x: number, anchor: 'start' | 'end') => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(minY + vbH - pad));
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
    t.setAttribute('font-size', String(fontSize));
    t.setAttribute('font-weight', '700');
    t.setAttribute('fill', '#f4e4bc');
    t.setAttribute('fill-opacity', '0.85');
    t.setAttribute('paint-order', 'stroke');
    t.setAttribute('stroke', '#5d462a');
    t.setAttribute('stroke-width', String(fontSize * 0.12));
    t.setAttribute('stroke-opacity', '0.55');
    t.textContent = text;
    return t;
  };
  if (watermark) clone.appendChild(stamp(watermark, minX + vbW - pad, 'end'));
  if (opts.seedLabel) clone.appendChild(stamp(opts.seedLabel, minX + pad, 'start'));

  // Serialize → data URL (more reliable than blob: URLs for canvas draw on iOS).
  const svgText = new XMLSerializer().serializeToString(clone);
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);

  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to rasterize board SVG.'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.fillStyle = background; // belt-and-suspenders behind the SVG bg rect
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Canvas toBlob returned null.');
  return blob;
}

export type ShareResult = 'shared' | 'downloaded';

/** Share the board image via the native share sheet when files are supported
 *  (mobile), otherwise trigger a file download. Returns which path was taken;
 *  resolves to null if the user cancels the share sheet. */
export async function shareOrSaveBoard(opts: CaptureOptions & { filename?: string } = {}): Promise<ShareResult | null> {
  const blob = await captureBoardPng(opts);
  const filename = opts.filename ?? 'catan-map.png';
  const file = new File([blob], filename, { type: 'image/png' });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Catan map', text: 'Generated with Catan Map Generator' });
      return 'shared';
    } catch (err) {
      // User dismissed the sheet — not an error worth surfacing.
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      // Fall through to download on any other share failure.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
