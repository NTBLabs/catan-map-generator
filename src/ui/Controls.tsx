import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGesture } from '@use-gesture/react';
import { useAppStore } from '../state/store';
import { PRODUCING_RESOURCES } from '../game/constants';
import type { ChallengeFlavor, PlayerCount, ProducingResource } from '../game/types';
import { downloadBoardImage } from './exportImage';
import { LegalNotice } from './LegalNotice';
import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  LinkIcon,
  MailIcon,
  MoreIcon,
  RedditIcon,
  ShareIcon,
  TelegramIcon,
  WhatsAppIcon,
} from './icons';

import { MOBILE_QUERY } from './openLift';

const PLAYER_COUNTS: PlayerCount[] = [3, 4, 5, 6];

const FLAVOR_LABELS: Record<ChallengeFlavor, string> = {
  none: 'None (balanced)',
  hotZone: 'Hot zone',
  wealthGap: 'Rich vs Poor',
  scarcity: 'Scarcity',
  boomOrBust: 'Boom-or-bust',
  drought: 'Drought',
  random: 'Random',
};

const FLAVOR_HELP: Record<ChallengeFlavor, string> = {
  none: 'Standard balanced map. Each resource gets at least one good number; high-yield numbers are spread across resource types.',
  scarcity: 'The target resource will have very low total yield — it stays rare all game. Pick which resource (or "Any") below.',
  boomOrBust: 'The target resource gets ~60%+ of its pips on a single number. When that number rolls, payday. When it doesn\'t, drought.',
  drought: 'At least one cluster of 3 adjacent hexes all carry low-yield numbers (2/3/11/12) — a "dead zone" you have to plan around.',
  wealthGap: 'One half of the board is RICH (every number 4+ pips), the other half is POOR. A territory war for the good side; the poor side is a slog.',
  hotZone: 'Four+ red numbers (6/8) cluster into one contested region — both the dream apex pick and the constant robber target.',
  random: 'Picks one of Scarcity / Boom-or-bust / Drought / Rich vs Poor / Hot zone at random. The Analyze view shows which one rolled.',
};

export function Controls() {
  const playerCount = useAppStore(s => s.playerCount);
  const variants = useAppStore(s => s.variants);
  const showBestLocations = useAppStore(s => s.showBestLocations);
  const showResourceHealth = useAppStore(s => s.showResourceHealth);
  const showAdvancedDiagnostics = useAppStore(s => s.showAdvancedDiagnostics);
  const waterFrame = useAppStore(s => s.waterFrame);
  const map = useAppStore(s => s.map);
  const scored = useAppStore(s => s.scored);
  const generating = useAppStore(s => s.generating);
  const attempts = useAppStore(s => s.attempts);
  const fellBack = useAppStore(s => s.fellBack);

  const setPlayerCount = useAppStore(s => s.setPlayerCount);
  const setVariants = useAppStore(s => s.setVariants);
  const setChallenge = useAppStore(s => s.setChallenge);
  const toggleShowBestLocations = useAppStore(s => s.toggleShowBestLocations);
  const toggleShowResourceHealth = useAppStore(s => s.toggleShowResourceHealth);
  const toggleShowAdvancedDiagnostics = useAppStore(s => s.toggleShowAdvancedDiagnostics);
  const toggleWaterFrame = useAppStore(s => s.toggleWaterFrame);
  const generate = useAppStore(s => s.generate);

  const showTargetPicker =
    variants.challenge.flavor === 'scarcity' || variants.challenge.flavor === 'boomOrBust';

  // Share popover: one icon button opens a small menu with "Copy link" and
  // "Save / share image". Closes on outside-click, Escape, or shortly after an
  // action so its inline feedback ("Link copied!", "Saved!") stays visible.
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  // Close on Escape. Outside-tap is handled by the scrim overlay itself (the
  // menu is portaled to <body> so it escapes the drawer's CSS transform, which
  // would otherwise anchor a fixed/absolute child to the drawer and push the
  // popover off-screen).
  useEffect(() => {
    if (!shareMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shareMenuOpen]);

  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (shareStatus === 'idle') return;
    const t = window.setTimeout(() => setShareStatus('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [shareStatus]);
  const onShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('copied');
    } catch (err) {
      console.warn('clipboard write failed', err);
      setShareStatus('failed');
    }
    window.setTimeout(() => setShareMenuOpen(false), 1200);
  };

  // Image download. Always forces a file download (never the OS share sheet) —
  // a "Download" action should just download. Status drives the bubble's
  // spinner/checkmark feedback.
  const [imageStatus, setImageStatus] = useState<'idle' | 'busy' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    if (imageStatus === 'idle' || imageStatus === 'busy') return;
    const t = window.setTimeout(() => setImageStatus('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [imageStatus]);
  const onSaveImage = async () => {
    if (imageStatus === 'busy') return;
    setImageStatus('busy');
    try {
      const seed = map?.seed;
      await downloadBoardImage({
        filename: seed !== undefined ? `catan-map-${seed.toString(36)}.png` : 'catan-map.png',
        seedLabel: seed !== undefined ? `seed: ${seed.toString(36)}` : undefined,
      });
      setImageStatus('saved');
    } catch (err) {
      console.warn('image download failed', err);
      setImageStatus('failed');
    }
    window.setTimeout(() => setShareMenuOpen(false), 1200);
  };
  // Share data. The native share sheet (below) is the primary path on mobile —
  // it reaches iMessage, Instagram, Snapchat, Discord, Slack, and iOS's
  // suggested-chats row, none of which expose a public link-intent URL. The
  // direct buttons are only for apps that DO publish a share URL (WhatsApp,
  // Telegram) plus email, and double as the desktop fallback. Built in render
  // so the URL always reflects the current map.
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareTitle = 'Catan map';
  const shareText = 'Check out this Catan map';
  const enc = encodeURIComponent;
  const shareTargets: Array<{
    key: string; label: string; href: string; Icon: typeof WhatsAppIcon;
    color?: string; blank?: boolean; ring?: boolean;
  }> = [
    { key: 'whatsapp', label: 'WhatsApp', color: '#25D366', Icon: WhatsAppIcon, blank: true,
      href: `https://wa.me/?text=${enc(`${shareText} ${shareUrl}`)}` },
    { key: 'telegram', label: 'Telegram', color: '#26A5E4', Icon: TelegramIcon, blank: true,
      href: `https://t.me/share/url?url=${enc(shareUrl)}&text=${enc(shareText)}` },
    { key: 'reddit', label: 'Reddit', color: '#FF4500', Icon: RedditIcon, blank: true,
      href: `https://www.reddit.com/submit?url=${enc(shareUrl)}&title=${enc(shareTitle)}` },
    { key: 'email', label: 'Email', color: '#2f55c7', Icon: MailIcon, ring: true,
      href: `mailto:?subject=${enc(shareTitle)}&body=${enc(`${shareText}\n\n${shareUrl}`)}` },
  ];

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const onNativeShare = async () => {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.warn('native share failed', err);
      }
    }
    setShareMenuOpen(false);
  };

  // Mobile drawer state. On phones the drawer starts closed; the user can
  // tap the handle to toggle, or drag it up/down (gesture below) to scrub the
  // open position 1:1 with the finger and snap on release. Desktop ignores
  // all of this — the side panel is always visible via the
  // @media (min-width: 900px) rule in app.css.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_QUERY).matches,
  );
  // In the store (not local state) so Board can lift its container while
  // the drawer is open; see ui/openLift.ts. Otherwise used exactly as the
  // local flag it replaced.
  const open = useAppStore(s => s.drawerOpen);
  const setOpen = useAppStore(s => s.setDrawerOpen);
  const drawerRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Whether any notice line is rendered. Drives the collapsed height: the
  // drawer swaps between the two fixed peeks in theme.css exactly once,
  // when the first notice appears (never between generations, never by
  // notice content). Published as a class on the drawer; app.css lifts it
  // to .app via :has() so the board inset follows too.
  const hasNotice =
    (fellBack && !!map) ||
    (!!map && !fellBack && attempts > 0) ||
    !!map?.variants.challenge.rolledFlavor;

  // The collapsed height ("peek") is defined ONCE, in theme.css, as
  // --drawer-peek (a fixed pixel value plus the safe-area inset). env()
  // cannot be read from JS directly, so the resolved pixel value is
  // measured off a throwaway probe element styled with the variable. The
  // probe mounts INSIDE the drawer, because the notice-state swap lives on
  // .app and a body-mounted probe would only ever see the :root default.
  // peekRef feeds ONLY the drag clamp math (closedOffset): the resting
  // collapsed position is CSS-owned (see .controls--closed in app.css) and
  // needs no JS, which is what keeps it correct while iOS Safari settles
  // its chrome. Re-measured on resize/orientation and the notice flip so
  // the next drag clamps against current numbers.
  const peekRef = useRef(106);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const measure = () => {
      const el = drawerRef.current;
      if (!el) return;
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:absolute;bottom:0;left:0;width:0;height:var(--drawer-peek);visibility:hidden;pointer-events:none;';
      el.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      if (h > 0) peekRef.current = h;
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [hasNotice]);

  const closedOffset = () => {
    const el = drawerRef.current;
    if (!el) return 0;
    return Math.max(0, el.offsetHeight - peekRef.current);
  };

  // Keep DOM transform in sync with the open/closed state. We don't use CSS
  // class transforms because the drag handler also writes to .style.transform
  // (without transition) — having a single source of truth on the inline
  // style avoids fighting CSS for the drag-snap animation.
  useLayoutEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    if (!isMobile) {
      el.style.transform = '';
      el.style.transition = '';
      return;
    }
    el.style.transition = 'transform 0.28s ease';
    // Open is a fixed, viewport-independent position. Closed is CSS-owned
    // (the .controls--closed rule), so CLEARING the inline transform hands
    // the resting position to the live calc; the transition still animates
    // the handoff because transitions ease computed-value changes wherever
    // the value comes from.
    el.style.transform = open ? 'translateY(0)' : '';
  }, [open, isMobile]);

  useGesture(
    {
      onDrag: ({ first, last, movement: [, my], velocity: [, vy], direction: [, dyDir] }) => {
        if (!isMobile) return;
        const el = drawerRef.current;
        if (!el) return;
        const closedY = closedOffset();
        const baseY = open ? 0 : closedY;
        const targetY = Math.max(0, Math.min(closedY, baseY + my));
        if (first) {
          // Disable transition for the duration of the drag so the drawer
          // tracks the finger exactly, with no easing lag.
          el.style.transition = 'none';
        }
        if (last) {
          const fastUp = vy > 0.5 && dyDir < 0;
          const fastDown = vy > 0.5 && dyDir > 0;
          const nextOpen = fastUp
            ? true
            : fastDown
              ? false
              : targetY < closedY / 2;
          el.style.transition = 'transform 0.28s ease';
          // Release-to-closed clears the inline transform: the transition
          // runs from the finger's last offset to the CSS-owned resting
          // calc, so the snap stays continuous (see .controls--closed).
          el.style.transform = nextOpen ? 'translateY(0)' : '';
          if (nextOpen !== open) setOpen(nextOpen);
        } else {
          el.style.transform = `translateY(${targetY}px)`;
        }
      },
    },
    {
      target: handleRef,
      eventOptions: { passive: false },
      drag: { filterTaps: true, axis: 'y' },
    },
  );

  const drawerOpen = !isMobile || open;

  return (
    <aside ref={drawerRef} className={`controls ${isMobile ? (open ? 'controls--open' : 'controls--closed') : ''}${hasNotice ? ' controls--has-notice' : ''}`}>
      <button
        ref={handleRef}
        type="button"
        className="controls__handle"
        aria-expanded={drawerOpen}
        aria-controls="controls-body"
        aria-label={drawerOpen ? 'Collapse options' : 'Expand options'}
        onClick={() => isMobile && setOpen(!open)}
      >
        <span className="controls__drag" aria-hidden />
        <span className="controls__handle-label">{drawerOpen ? 'Hide options' : 'Options'}</span>
      </button>

      <div id="controls-body" className="controls__body" aria-hidden={!drawerOpen}>

      <div className="controls__row controls__row--primary">
        <button className="btn btn--primary" onClick={generate} disabled={generating}>
          {generating ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Generating…
            </>
          ) : (
            'Generate map'
          )}
        </button>
        <div className="share">
          <button
            type="button"
            className="btn btn--secondary share__btn"
            onClick={() => setShareMenuOpen(o => !o)}
            disabled={!map}
            aria-haspopup="menu"
            aria-expanded={shareMenuOpen}
            aria-label="Share"
            title="Share"
          >
            <ShareIcon />
          </button>
        </div>
      </div>

      {shareMenuOpen && map && createPortal(
        <div
          className="share-overlay"
          role="presentation"
          onClick={() => setShareMenuOpen(false)}
        >
          <div
            className="share-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Share"
            onClick={e => e.stopPropagation()}
          >
            <div className="share-sheet__header">
              <span className="share-sheet__title">Share</span>
              <button
                type="button"
                className="share-sheet__close"
                onClick={() => setShareMenuOpen(false)}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="share-targets">
              <button
                type="button"
                className="share-target"
                onClick={onShare}
                aria-live="polite"
              >
                <span
                  className={`share-target__icon${shareStatus === 'copied' ? '' : ' share-target__icon--util'}`}
                  style={shareStatus === 'copied' ? { background: '#6fa84a', borderColor: '#3d6a26', color: '#fff' } : undefined}
                >
                  {shareStatus === 'copied' ? <CheckIcon /> : <LinkIcon />}
                </span>
                <span className="share-target__label">
                  {shareStatus === 'copied' ? 'Copied!' : shareStatus === 'failed' ? 'Failed' : 'Copy link'}
                </span>
              </button>

              {shareTargets.map(t => (
                <a
                  key={t.key}
                  className="share-target"
                  href={t.href}
                  {...(t.blank ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  onClick={() => setShareMenuOpen(false)}
                >
                  <span
                    className="share-target__icon"
                    style={{ background: t.color, ...(t.ring ? { border: '2px solid var(--catan-gold)' } : {}) }}
                  >
                    <t.Icon />
                  </span>
                  <span className="share-target__label">{t.label}</span>
                </a>
              ))}

              <button
                type="button"
                className="share-target"
                onClick={onSaveImage}
                disabled={imageStatus === 'busy'}
                aria-live="polite"
              >
                <span
                  className={`share-target__icon${imageStatus === 'saved' ? '' : ' share-target__icon--ghost'}`}
                  style={imageStatus === 'saved' ? { background: '#6fa84a', borderColor: '#3d6a26', color: '#fff' } : undefined}
                >
                  {imageStatus === 'busy'
                    ? <span className="spinner" aria-hidden="true" />
                    : imageStatus === 'saved'
                      ? <CheckIcon />
                      : <DownloadIcon />}
                </span>
                <span className="share-target__label">
                  {imageStatus === 'busy' ? 'Saving…'
                    : imageStatus === 'saved' ? 'Saved!'
                      : imageStatus === 'failed' ? 'Failed'
                        : 'Download'}
                </span>
              </button>

              {canNativeShare && (
                <button type="button" className="share-target" onClick={onNativeShare}>
                  <span className="share-target__icon share-target__icon--ghost">
                    <MoreIcon />
                  </span>
                  <span className="share-target__label">More</span>
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {fellBack && map && (
        <div className="notice notice--warn">
          Best-effort map after {attempts} attempts — fairness threshold not met. Try regenerating or relaxing variants.
        </div>
      )}
      {map && !fellBack && attempts > 0 && (
        <div className="notice">Solved in {attempts} attempt{attempts === 1 ? '' : 's'}.</div>
      )}
      {map?.variants.challenge.rolledFlavor && (
        <div className="notice">
          Challenge rolled: <strong>{FLAVOR_LABELS[map.variants.challenge.rolledFlavor]}</strong>
          {map.variants.challenge.rolledTarget ? ` (${map.variants.challenge.rolledTarget})` : ''}
        </div>
      )}

      <div className="controls__row">
        <span className="controls__label">Players</span>
        <div className="seg" role="radiogroup" aria-label="Player count">
          {PLAYER_COUNTS.map(n => (
            <button
              key={n}
              role="radio"
              aria-checked={playerCount === n}
              className={`seg__btn ${playerCount === n ? 'seg__btn--active' : ''}`}
              onClick={() => setPlayerCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className="toggle">
            <input type="checkbox" checked={showResourceHealth} onChange={toggleShowResourceHealth} />
            Show resource distribution
          </label>
        </div>
        <p className="help">
          Per-resource health readout (pip totals, concentration, healthy/warning/unhealthy dot) plus the simulated snake-draft fairness panel.
        </p>
        {showResourceHealth && scored && <ResourceHealthPanel />}
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className={`toggle ${playerCount > 4 ? 'toggle--disabled' : ''}`}>
            <input
              type="checkbox"
              checked={playerCount > 4 ? true : variants.includeDesert}
              disabled={playerCount > 4}
              onChange={e => setVariants({ includeDesert: e.target.checked })}
            />
            Include desert
          </label>
          {!variants.includeDesert && playerCount <= 4 && (
            <select
              className="select"
              value={variants.desertReplacement}
              onChange={e => setVariants({ desertReplacement: e.target.value as ProducingResource })}
              aria-label="Desert replacement resource"
            >
              {PRODUCING_RESOURCES.map(r => (
                // The scarcity target cannot double as the desert replacement
                // (adding a tile of a resource contradicts starving it); the
                // store reconciles the combo if it arises another way.
                <option
                  key={r}
                  value={r}
                  disabled={variants.challenge.flavor === 'scarcity' && variants.challenge.targetResource === r}
                >
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="help">
          {playerCount > 4
            ? '5–6 expansion always uses 2 deserts (the robber starts on one of them) — desert is fixed for these player counts.'
            : variants.includeDesert
              ? 'Standard rules: 1 desert (base game). The robber starts on the desert.'
              : 'Desert is swapped for the chosen resource; the extra hex gets number 4. The robber starts off-board.'}
        </p>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={variants.shufflePorts}
              onChange={e => setVariants({ shufflePorts: e.target.checked })}
            />
            Shuffle ports
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={waterFrame}
              onChange={toggleWaterFrame}
            />
            Water frame
          </label>
        </div>
        <p className="help">
          {variants.shufflePorts
            ? 'Port positions are randomized each generation.'
            : 'Ports are placed in the canonical 5th-edition arrangement from the box.'}
          {' '}
          {waterFrame
            ? 'A sea border surrounds the island so ports sit on water. Pure visual — toggles instantly without regenerating.'
            : 'No sea border — ports sit on the page background.'}
        </p>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={variants.noSameNumberAdjacent}
              onChange={e => setVariants({ noSameNumberAdjacent: e.target.checked })}
            />
            No same numbers adjacent
          </label>
        </div>
        <p className="help">
          Hexes touching each other can't share a number (e.g. two 9s next to each other). Best-effort — if the constraint can't be satisfied, the generator returns its best attempt.
        </p>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={variants.noSameNumberOnResource}
              onChange={e => setVariants({ noSameNumberOnResource: e.target.checked })}
            />
            No same number on same resource
          </label>
        </div>
        <p className="help">
          Prevents two 5s on brick or two 9s on wheat — every resource gets distinct numbers across its tiles. Best-effort.
        </p>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={variants.noMultipleRedsOnResource}
              onChange={e => setVariants({ noMultipleRedsOnResource: e.target.checked })}
            />
            Spread reds across resources
          </label>
        </div>
        <p className="help">
          Distributes 6s and 8s evenly so no resource hogs the high-yield numbers (base-game cap = 1 red per resource; 5–6 expansion = 2). Best-effort.
        </p>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <span className="controls__label">Challenge mode</span>
          <select
            className="select"
            value={variants.challenge.flavor}
            onChange={e => setChallenge(e.target.value as ChallengeFlavor)}
          >
            {(Object.keys(FLAVOR_LABELS) as ChallengeFlavor[]).map(f => (
              <option key={f} value={f}>{FLAVOR_LABELS[f]}</option>
            ))}
          </select>
          {showTargetPicker && (
            <select
              className="select"
              value={variants.challenge.targetResource}
              onChange={e => setChallenge(variants.challenge.flavor, e.target.value as ProducingResource | 'any')}
              aria-label="Target resource"
            >
              <option value="any">Any</option>
              {PRODUCING_RESOURCES.map(r => (
                // Mirror of the desert-replacement restriction above, only
                // meaningful on the base board where the desert can be off.
                <option
                  key={r}
                  value={r}
                  disabled={
                    variants.challenge.flavor === 'scarcity' &&
                    playerCount <= 4 &&
                    !variants.includeDesert &&
                    variants.desertReplacement === r
                  }
                >
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="help">{FLAVOR_HELP[variants.challenge.flavor]}</p>
        <p className="help help--note">
          Snake-draft fairness is always enforced — challenge mode makes the map harsh, not the starting positions.
        </p>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className="toggle">
            <input type="checkbox" checked={showBestLocations} onChange={toggleShowBestLocations} />
            Show best locations
          </label>
        </div>
        <p className="help">
          Overlays the snake-draft picks on the board — top-N intersections with rank rings and spot-value badges. Pure visual; doesn't affect generation.
        </p>
      </div>

      <div className="controls__group">
        <div className="controls__row">
          <label className="toggle">
            <input type="checkbox" checked={showAdvancedDiagnostics} onChange={toggleShowAdvancedDiagnostics} />
            Show advanced diagnostics
          </label>
        </div>
        <p className="help">
          Deeper analysis: adjacent-resource pair frequencies, strategic-viability bar, top-20 archetype mix, top port-economy openings, and port hinterland support.
        </p>
        {showAdvancedDiagnostics && scored && <AdvancedDiagnosticsPanel />}
      </div>

      {/* Drawer footer. Deliberately the quietest thing in the panel and
          deliberately NOT in the header: the header carries one link home to
          the studio, and this is a second destination that only a small
          fraction of visitors want. The trademark and non-affiliation line
          sits under the link at the same size: an always-visible strip was
          tried and reverted because it undid the tuned phone fit. */}
      <footer className="controls__footer">
        <a
          className="controls__source"
          href="https://github.com/NTBLabs/catan-lab"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source on GitHub
        </a>
        <LegalNotice />
      </footer>

      </div>
    </aside>
  );
}

/** Top row (per-resource pip totals + health dots) plus the bottom
 *  fairness panel (stdev/spread/mean/player bars). Gated by the
 *  "Show resource distribution" toggle. */
function ResourceHealthPanel() {
  const scored = useAppStore(s => s.scored)!;
  const fairness = scored.fairness;
  const mean = fairness.playerTotals.reduce((a, b) => a + b, 0) / fairness.playerTotals.length;
  const max = Math.max(...fairness.playerTotals, 1);

  return (
    <>
      <div className="health">
        {scored.health.map(h => {
          const shareDelta = h.expectedShare > 0
            ? (h.productionShare / h.expectedShare - 1) * 100
            : 0;
          const deltaSign = shareDelta > 0 ? '+' : '';
          return (
            <div className="health__cell" key={h.resource}>
              <div className="health__cell-head">
                <span className={`health__dot health__dot--${h.status}`} />
                {h.resource}
              </div>
              <div>{h.totalPips}p</div>
              <div style={{ opacity: 0.7 }} title="concentration on top number">
                {(h.concentration * 100).toFixed(0)}%
              </div>
              <div className="health__share" title="production share vs expected (tile-count share)">
                {deltaSign}{shareDelta.toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>

      <div className="fairness">
        <div className="fairness__row">
          <span>Stdev</span>
          <span>{fairness.stdev.toFixed(2)}</span>
        </div>
        <div className="fairness__row">
          <span>Spread</span>
          <span>{fairness.spread.toFixed(2)}</span>
        </div>
        <div className="fairness__row">
          <span>Mean</span>
          <span>{mean.toFixed(2)}</span>
        </div>
        <div className="fairness__row" title="Min roads from any picked spot to any port, per player">
          <span>Port reach</span>
          <span>
            {scored.playerPortDistance.map((d, i) =>
              `P${i + 1}:${Number.isFinite(d) ? d : '∞'}`,
            ).join(' ')}
          </span>
        </div>
        <div
          className="fairness__row"
          title="Spread between highest- and lowest-producing quadrant relative to its tile share. >1.0 = super-continent territory."
        >
          <span>Pip spread</span>
          <span style={{ color: scored.pipSpatial.spread > 1.0 ? '#c0341d' : undefined }}>
            {scored.pipSpatial.spread.toFixed(2)}
            <span style={{ marginLeft: 6, opacity: 0.6, fontSize: '0.85em' }}>
              ({scored.pipSpatial.quadrantRatios.map(r => r.toFixed(2)).join(' ')})
            </span>
          </span>
        </div>
        <div className="fairness__bars">
          {fairness.playerTotals.map((v, i) => (
            <div key={i} className="fairness__bar" style={{ opacity: 0.4 + 0.6 * (v / max) }}>
              <span className="fairness__bar-label">P{i + 1}: {v.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Deeper diagnostic panels — adjacent resource pairs, strategic
 *  viability gate, top-20 archetype mix, top port-economy openings,
 *  port hinterland support. Gated by the separate "Show advanced
 *  diagnostics" toggle so the basic resource distribution view stays
 *  uncluttered. */
function AdvancedDiagnosticsPanel() {
  const scored = useAppStore(s => s.scored)!;
  return (
    <>
      <div className="pairs">
        <div className="pairs__title">Adjacent resource pairs (obs / exp)</div>
        <div className="pairs__grid">
          {scored.pairs.map(p => (
            <div className={`pairs__cell pairs__cell--${p.status}`} key={`${p.a}-${p.b}`}>
              <span className="pairs__label">{p.a.slice(0, 2)}·{p.b.slice(0, 2)}</span>
              <span className="pairs__count">{p.observed} / {p.expected.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>

      {(() => {
        // GATE metric — board-wide structural eligibility, multi-label.
        // The strategic-diversity rejection rule uses these counts at k=5.
        const viable = scored.viableArchetypeCounts;
        const entries: Array<[string, number]> = [
          ['Expansion', viable.expansion],
          ['City Rush', viable.cityRush],
          ['Port Econ', viable.portEconomy],
          ['Dev Cards', viable.devCards],
          ['Balanced', viable.balanced],
        ];
        const K = 5;
        const meetingBar = entries.filter(([, c]) => c >= K).length;
        return (
          <div className="pairs">
            <div className="pairs__title">
              Strategic viability (k=5 bar)
              <span style={{ marginLeft: 8, opacity: 0.7 }}>
                {meetingBar} archetypes meeting
                {meetingBar < 3 ? ' ⚠' : ''}
              </span>
            </div>
            <div className="pairs__grid">
              {entries.map(([label, count]) => (
                <div
                  className={`pairs__cell pairs__cell--${count >= K ? 'normal' : 'rare'}`}
                  key={label}
                >
                  <span className="pairs__label">{label}</span>
                  <span className="pairs__count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {(() => {
        // INFORMATIONAL — top-20 composition by dominant archetype.
        // Distinct from the gate metric above: this shows which archetypes
        // dominate the highest-pip-value spots, while the gate measures
        // structural availability anywhere on the board.
        const mix = scored.archetypeMix;
        const entries: Array<[string, number]> = [
          ['Expansion', mix.expansion],
          ['City Rush', mix.cityRush],
          ['Port Econ', mix.portEconomy],
          ['Dev Cards', mix.devCards],
          ['Balanced', mix.balanced],
        ];
        return (
          <div className="pairs">
            <div className="pairs__title">
              Top-20 archetype composition
            </div>
            <div className="pairs__grid">
              {entries.map(([label, count]) => (
                <div className="pairs__cell pairs__cell--normal" key={label}>
                  <span className="pairs__label">{label}</span>
                  <span className="pairs__count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {(() => {
        // Port-economy diagnostic surface (distributional, not pass/fail).
        // Shows the top-3 strongest port openings on this map by the
        // multi-dim strength formula. Useful for spotting which ports
        // anchor real trade-economy plays vs which are just adjacent
        // to weak production.
        const top = scored.portEconomyOpenings.slice(0, 3);
        if (top.length === 0) return null;
        return (
          <div className="pairs">
            <div className="pairs__title">Top port-economy openings</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {top.map((p, i) => (
                <div
                  key={p.intersectionId}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '2px 8px',
                    marginTop: 4,
                    paddingBottom: 4,
                    borderBottom: i < top.length - 1 ? '1px dashed rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  <span style={{ opacity: 0.5, minWidth: 16 }}>{i + 1}.</span>
                  <span>strength <strong>{p.strength.toFixed(2)}</strong></span>
                  <span>port {p.portStrength.toFixed(1)}</span>
                  <span>prod {p.production.toFixed(1)}</span>
                  <span>surplus {p.surplus.toFixed(2)}×</span>
                  <span style={{ opacity: 0.55 }}>rank #{p.rank + 1}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {(() => {
        const specific = scored.ports.filter(p => p.type !== 'generic');
        if (specific.length === 0) return null;
        const max = Math.max(...specific.map(p => p.supportScore), 1);
        const min = Math.min(...specific.map(p => p.supportScore));
        const ratio = scored.specificPortSupportRatio;
        const ratioBad = ratio > 3.0;
        return (
          <div className="pairs">
            <div className="pairs__title">
              Port hinterland support
              <span style={{ marginLeft: 8, opacity: 0.7 }}>
                ratio {isFinite(ratio) ? ratio.toFixed(2) : '∞'}
                {ratioBad ? ' ⚠' : ''}
              </span>
            </div>
            <div className="pairs__grid">
              {specific.map((p, i) => {
                const status = p.supportScore === max
                  ? 'abundant'
                  : p.supportScore === min ? 'rare' : 'normal';
                return (
                  <div className={`pairs__cell pairs__cell--${status}`} key={`port-${i}-${p.type}`}>
                    <span className="pairs__label">{p.type.slice(0, 4)} 2:1</span>
                    <span className="pairs__count">{p.supportScore.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </>
  );
}
