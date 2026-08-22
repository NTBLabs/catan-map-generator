import type { PortType, Resource } from '../game/types';

/* Each tile renders a small "scene" (a forest, a mountain range, a wheat field)
   rather than a single icon. Drawings are inline SVG paths/shapes — no external
   assets — so the bundle stays under 70 KB gzipped and everything renders crisp
   at any zoom level.
   The TileArt wrapper applies the shared `hex-clip` clip-path so no scene
   element can bleed past the hex boundary, even when the board is rotated. */

// ------------------------------------------------------- Reusable building blocks
function Tree({ x, y, scale = 1, tone = 0 }: { x: number; y: number; scale?: number; tone?: number }) {
  const palettes = [
    { dark: '#1b4a25', mid: '#256a33', light: '#3a8f45' },
    { dark: '#1f5028', mid: '#2c7036', light: '#42974d' },
    { dark: '#163d20', mid: '#22612e', light: '#357f3f' },
  ];
  const c = palettes[tone % palettes.length];
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={-0.030} y={0.04} width={0.060} height={0.13} fill="#4a2d12" />
      <polygon points="0,-0.30 -0.20,0.05 0.20,0.05" fill={c.dark} stroke="#0a1f10" strokeWidth={0.015} />
      <polygon points="0,-0.20 -0.17,0.08 0.17,0.08" fill={c.mid} stroke="#0a1f10" strokeWidth={0.015} />
      <polygon points="0,-0.08 -0.14,0.12 0.14,0.12" fill={c.light} stroke="#0a1f10" strokeWidth={0.015} />
    </g>
  );
}

function BrickStack({ x, y, scale = 1, flip = false }: { x: number; y: number; scale?: number; flip?: boolean }) {
  const stroke = '#5e1a07';
  const face = '#a13720';
  const top = '#c2543a';
  const sx = flip ? -1 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale * sx} ${scale})`}>
      <rect x={-0.18} y={-0.03} width={0.16} height={0.08} fill={face} stroke={stroke} strokeWidth={0.012} />
      <rect x={-0.02} y={-0.03} width={0.16} height={0.08} fill={face} stroke={stroke} strokeWidth={0.012} />
      <rect x={-0.10} y={0.05} width={0.16} height={0.08} fill={top} stroke={stroke} strokeWidth={0.012} />
      <rect x={0.06}  y={0.05} width={0.16} height={0.08} fill={top} stroke={stroke} strokeWidth={0.012} />
      <rect x={-0.18} y={0.13} width={0.16} height={0.08} fill={face} stroke={stroke} strokeWidth={0.012} />
      <rect x={-0.02} y={0.13} width={0.16} height={0.08} fill={face} stroke={stroke} strokeWidth={0.012} />
    </g>
  );
}

function WheatStalk({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const stroke = '#7a5520';
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <line x1={0} y1={-0.20} x2={0} y2={0.15} stroke={stroke} strokeWidth={0.025} strokeLinecap="round" />
      <ellipse cx={-0.05} cy={-0.13} rx={0.045} ry={0.030} fill="#e8c659" stroke={stroke} strokeWidth={0.012} transform="rotate(-25 -0.05 -0.13)" />
      <ellipse cx={0.05}  cy={-0.13} rx={0.045} ry={0.030} fill="#e8c659" stroke={stroke} strokeWidth={0.012} transform="rotate(25 0.05 -0.13)" />
      <ellipse cx={-0.05} cy={-0.04} rx={0.045} ry={0.030} fill="#f0d273" stroke={stroke} strokeWidth={0.012} transform="rotate(-25 -0.05 -0.04)" />
      <ellipse cx={0.05}  cy={-0.04} rx={0.045} ry={0.030} fill="#f0d273" stroke={stroke} strokeWidth={0.012} transform="rotate(25 0.05 -0.04)" />
      <ellipse cx={-0.05} cy={0.05}  rx={0.045} ry={0.030} fill="#f4dc89" stroke={stroke} strokeWidth={0.012} transform="rotate(-25 -0.05 0.05)" />
      <ellipse cx={0.05}  cy={0.05}  rx={0.045} ry={0.030} fill="#f4dc89" stroke={stroke} strokeWidth={0.012} transform="rotate(25 0.05 0.05)" />
    </g>
  );
}

function Sheep({ x, y, scale = 1, flip = false }: { x: number; y: number; scale?: number; flip?: boolean }) {
  const sx = flip ? -1 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale * sx} ${scale})`}>
      {/* legs */}
      <rect x={-0.11} y={0.07} width={0.04} height={0.10} fill="#2b2118" />
      <rect x={0.07}  y={0.07} width={0.04} height={0.10} fill="#2b2118" />
      {/* fluffy body */}
      <ellipse cx={-0.04} cy={0.02} rx={0.20} ry={0.12} fill="#f7f1e8" stroke="#3a2916" strokeWidth={0.018} />
      <circle cx={-0.16} cy={-0.05} r={0.07} fill="#f7f1e8" stroke="#3a2916" strokeWidth={0.018} />
      <circle cx={-0.04} cy={-0.10} r={0.07} fill="#f7f1e8" stroke="#3a2916" strokeWidth={0.018} />
      <circle cx={0.08}  cy={-0.08} r={0.07} fill="#f7f1e8" stroke="#3a2916" strokeWidth={0.018} />
      {/* head — slightly bigger so face features read at the smaller scenes */}
      <ellipse cx={0.20} cy={-0.02} rx={0.08} ry={0.07} fill="#2b2118" />
      <circle cx={0.24} cy={-0.05} r={0.015} fill="#f7f1e8" />
      <circle cx={0.24} cy={-0.05} r={0.007} fill="#2b2118" />
      {/* ear */}
      <ellipse cx={0.15} cy={-0.12} rx={0.035} ry={0.055} fill="#2b2118" />
      {/* small smile to make face more readable */}
      <path d="M 0.22,0.02 Q 0.25,0.04 0.27,0.01" fill="none" stroke="#f7f1e8" strokeWidth={0.008} strokeLinecap="round" />
    </g>
  );
}

function GrassTuft({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="#2c6a2c" strokeWidth={0.025} strokeLinecap="round" fill="none">
      <path d="M -0.05,0.04 L -0.04,-0.05" />
      <path d="M 0,0.04 L 0,-0.07" />
      <path d="M 0.05,0.04 L 0.04,-0.05" />
    </g>
  );
}

function Cloud({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={0} cy={0} rx={0.20} ry={0.07} fill="#eef2f5" stroke="#a5aab2" strokeWidth={0.012} />
      <circle cx={-0.10} cy={-0.04} r={0.07} fill="#eef2f5" stroke="#a5aab2" strokeWidth={0.012} />
      <circle cx={0.04} cy={-0.06} r={0.08} fill="#eef2f5" stroke="#a5aab2" strokeWidth={0.012} />
      <circle cx={0.13} cy={-0.03} r={0.06} fill="#eef2f5" stroke="#a5aab2" strokeWidth={0.012} />
    </g>
  );
}

function Bird({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="#2b2118" strokeWidth={0.018} fill="none" strokeLinecap="round">
      <path d="M -0.06,0 Q -0.03,-0.04 0,0" />
      <path d="M 0,0 Q 0.03,-0.04 0.06,0" />
    </g>
  );
}

// ------------------------------------------------------- Scene content blocks
// Each scene renders content centered at local (0, 0) — the parent TileArt
// applies translate + clip + rotation so we never have to think about hex
// boundaries here. Element extents past the hex are clipped automatically.

function WoodSceneContent() {
  return (
    <>
      <Tree x={-0.50} y={-0.05} scale={0.65} tone={0} />
      <Tree x={-0.20} y={-0.30} scale={0.85} tone={1} />
      <Tree x={0.15}  y={-0.45} scale={1.05} tone={0} />
      <Tree x={0.45}  y={-0.20} scale={0.80} tone={2} />
      <Tree x={0.55}  y={0.15}  scale={0.70} tone={1} />
      <Tree x={-0.55} y={0.30}  scale={0.75} tone={2} />
      <Tree x={-0.10} y={0.35}  scale={0.65} tone={0} />
      <Tree x={0.30}  y={0.40}  scale={0.70} tone={1} />
    </>
  );
}

function BrickSceneContent() {
  return (
    <>
      <path d="M -0.85,0.45 Q -0.50,-0.10 -0.20,0.20 Q 0.10,-0.20 0.45,0.05 Q 0.75,-0.05 0.90,0.40 Z" fill="#7d2a13" opacity={0.55} />
      <path d="M -0.85,0.55 Q -0.40,0.20 -0.05,0.45 Q 0.30,0.15 0.90,0.50 Z" fill="#621f0d" opacity={0.55} />
      <BrickStack x={-0.40} y={-0.15} scale={0.85} />
      <BrickStack x={0.05} y={-0.30} scale={1.00} />
      <BrickStack x={0.45} y={0.00} scale={0.85} flip />
      <BrickStack x={-0.10} y={0.30} scale={0.95} flip />
    </>
  );
}

function WheatSceneContent() {
  return (
    <>
      <g stroke="#a87420" strokeWidth={0.025} strokeLinecap="round" opacity={0.55}>
        <line x1={-0.85} y1={0.55} x2={0.85} y2={0.55} />
        <line x1={-0.85} y1={0.40} x2={0.85} y2={0.40} />
        <line x1={-0.85} y1={0.25} x2={0.85} y2={0.25} />
      </g>
      <WheatStalk x={-0.55} y={-0.25} scale={0.85} />
      <WheatStalk x={-0.25} y={-0.45} scale={1.00} />
      <WheatStalk x={0.08}  y={-0.50} scale={1.05} />
      <WheatStalk x={0.40}  y={-0.40} scale={0.95} />
      <WheatStalk x={0.60}  y={-0.15} scale={0.80} />
      <WheatStalk x={-0.50} y={0.05}  scale={0.90} />
      <WheatStalk x={-0.10} y={-0.05} scale={1.00} />
      <WheatStalk x={0.25}  y={0.00}  scale={0.95} />
    </>
  );
}

function SheepSceneContent() {
  return (
    <>
      {/* rolling pasture base */}
      <path d="M -0.85,0.55 Q -0.30,0.25 0.15,0.45 Q 0.55,0.20 0.90,0.55 Z" fill="#62a05a" opacity={0.6} />
      {/* grass tufts spread around */}
      <GrassTuft x={-0.65} y={0.35} scale={0.85} />
      <GrassTuft x={0.55} y={0.30} scale={0.85} />
      <GrassTuft x={-0.25} y={0.55} scale={0.75} />
      <GrassTuft x={0.30} y={0.58} scale={0.75} />
      <GrassTuft x={-0.40} y={-0.55} scale={0.75} />
      <GrassTuft x={0.40} y={-0.55} scale={0.75} />
      {/* 3 sheep at the outer corners — faces stay visible past the token.
          Plus a 4th sheep positioned so its HEAD sits behind the token
          (covered) but its fluffy white body clearly pokes out the left side. */}
      <Sheep x={-0.45} y={-0.40} scale={0.85} />
      <Sheep x={0.45}  y={-0.35} scale={0.90} flip />
      <Sheep x={-0.05} y={0.55}  scale={0.80} />
      <Sheep x={-0.40} y={0.00}  scale={0.85} />
    </>
  );
}

function OreSceneContent() {
  return (
    <>
      {/* sky details above the mountains — visible even with token in place */}
      <Cloud x={-0.40} y={-0.62} scale={0.85} />
      <Cloud x={0.35} y={-0.55} scale={0.65} />
      <Bird x={-0.05} y={-0.75} scale={1.1} />
      <Bird x={0.20} y={-0.80} scale={0.85} />
      {/* back mountain range */}
      <polygon points="-0.85,0.55 -0.55,0.05 -0.30,0.40 0.00,-0.10 0.30,0.30 0.60,-0.05 0.85,0.55"
               fill="#3a4250" stroke="#1a1e25" strokeWidth={0.018} />
      <polygon points="-0.55,0.05 -0.50,0.13 -0.45,0.20 -0.55,0.18 -0.62,0.10" fill="#f4f4f4" />
      <polygon points="0.00,-0.10 0.08,0.00 0.12,0.10 -0.02,0.05 -0.10,-0.02" fill="#f4f4f4" />
      <polygon points="0.60,-0.05 0.66,0.05 0.72,0.12 0.55,0.10 0.50,0.04" fill="#f4f4f4" />
      {/* front mountain range */}
      <polygon points="-0.85,0.55 -0.50,0.20 -0.20,0.50 0.10,0.10 0.40,0.45 0.70,0.18 0.85,0.55"
               fill="#5b6270" stroke="#1f242c" strokeWidth={0.018} />
      <polygon points="-0.50,0.20 -0.42,0.32 -0.35,0.40 -0.55,0.36 -0.60,0.28" fill="#ffffff" />
      <polygon points="0.10,0.10 0.18,0.22 0.24,0.32 0.05,0.28 -0.02,0.18" fill="#ffffff" />
      <polygon points="0.70,0.18 0.76,0.30 0.82,0.40 0.62,0.36 0.55,0.26" fill="#ffffff" />
      {/* scree pebbles along the base */}
      <circle cx={-0.30} cy={0.55} r={0.04} fill="#404858" />
      <circle cx={0.05}  cy={0.58} r={0.05} fill="#404858" />
      <circle cx={0.40}  cy={0.55} r={0.04} fill="#404858" />
    </>
  );
}

function DesertSceneContent() {
  return (
    <>
      <path d="M -0.85,0.55 Q -0.40,-0.10 0.00,0.10 Q 0.45,-0.20 0.85,0.10 L 0.85,0.55 Z" fill="#e6c98c" />
      <path d="M -0.85,0.55 Q -0.30,0.05 0.10,0.30 Q 0.55,0.00 0.85,0.35 L 0.85,0.55 Z" fill="#cba965" />
      <path d="M -0.85,0.55 Q -0.20,0.30 0.20,0.50 Q 0.55,0.25 0.85,0.55 Z" fill="#a98248" />
      <g transform="translate(0 -0.10)">
        <rect x={-0.04} y={-0.15} width={0.08} height={0.22} fill="#3d6b35" rx={0.03} />
        <rect x={-0.13} y={-0.05} width={0.05} height={0.10} fill="#3d6b35" rx={0.02} />
        <rect x={0.08}  y={-0.10} width={0.05} height={0.12} fill="#3d6b35" rx={0.02} />
        <line x1={-0.04} y1={-0.10} x2={0.04} y2={-0.10} stroke="#2c4d27" strokeWidth={0.012} />
        <line x1={-0.04} y1={-0.02} x2={0.04} y2={-0.02} stroke="#2c4d27" strokeWidth={0.012} />
      </g>
      <circle cx={0.55} cy={-0.45} r={0.10} fill="#fbd97a" stroke="#d8a230" strokeWidth={0.018} />
      <g stroke="#d8a230" strokeWidth={0.020} strokeLinecap="round">
        <line x1={0.55} y1={-0.62} x2={0.55} y2={-0.58} />
        <line x1={0.70} y1={-0.55} x2={0.66} y2={-0.51} />
        <line x1={0.40} y1={-0.55} x2={0.44} y2={-0.51} />
      </g>
      <ellipse cx={-0.45} cy={0.20} rx={0.05} ry={0.025} fill="#8a6a3c" />
      <ellipse cx={-0.30} cy={0.40} rx={0.04} ry={0.020} fill="#8a6a3c" />
    </>
  );
}

// --------------------------------------------------------------------- Exports
function sceneFor(resource: Resource): JSX.Element {
  switch (resource) {
    case 'wood':   return <WoodSceneContent />;
    case 'brick':  return <BrickSceneContent />;
    case 'wheat':  return <WheatSceneContent />;
    case 'sheep':  return <SheepSceneContent />;
    case 'ore':    return <OreSceneContent />;
    case 'desert': return <DesertSceneContent />;
  }
}

export function TileArt({
  resource, cx, cy, rotation = 0,
}: { resource: Resource; cx: number; cy: number; rotation?: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`} clipPath="url(#hex-clip)">
      <g transform={`rotate(${-rotation})`}>
        {sceneFor(resource)}
      </g>
    </g>
  );
}

// Small versions of the scene's signature element for use inside port markers.
// The caller wraps this in a counter-rotation group, so we render at (0, 0).
export function PortGlyph({ type, size = 1 }: { type: PortType; size?: number }) {
  if (type === 'generic') {
    return (
      <text
        x={0} y={0} dy={0.119 * size} textAnchor="middle"
        fontSize={0.34 * size} fontWeight={900} fill="#3a2916"
      >?</text>
    );
  }
  switch (type) {
    case 'wood':  return <Tree x={0} y={0.04} scale={1.05 * size} tone={1} />;
    case 'brick': return <BrickStack x={-0.01} y={-0.04} scale={0.9 * size} />;
    case 'wheat': return <WheatStalk x={0} y={0.02} scale={1.2 * size} />;
    case 'sheep': return <Sheep x={-0.01} y={-0.01} scale={0.82 * size} />;
    case 'ore': {
      // Symmetric, centred peak (the old one was small and offset).
      return (
        <g transform={`translate(0 -0.02) scale(${0.85 * size})`}>
          <polygon points="-0.24,0.18 0,-0.26 0.24,0.18" fill="#5b6270" stroke="#1f242c" strokeWidth={0.025} />
          <polygon points="-0.07,-0.06 0,-0.26 0.07,-0.06" fill="#ffffff" />
        </g>
      );
    }
  }
}
