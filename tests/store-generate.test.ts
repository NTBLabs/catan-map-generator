import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The store's generate() lifecycle: the generating flag must never strand,
// because the header status line derives from it and a stuck "Generating…"
// reads as a hang. generateMap is wrapped in a spy so single tests can force
// the failure and fallback paths without touching generation logic.
vi.mock('../src/generator/generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/generator/generate')>();
  return { ...actual, generateMap: vi.fn(actual.generateMap) };
});

import { generateMap } from '../src/generator/generate';
import { useAppStore } from '../src/state/store';
import { statusFor } from '../src/ui/status';

const generateMapMock = vi.mocked(generateMap);

function statusNow() {
  const s = useAppStore.getState();
  return statusFor({ generating: s.generating, hasMap: !!s.map, attempts: s.attempts, fellBack: s.fellBack });
}

describe('generate() lifecycle and the status line', () => {
  beforeEach(() => {
    // writeMapToUrl runs in the browser; in node a stub keeps the success
    // path identical to production instead of detouring through the catch.
    vi.stubGlobal('history', { replaceState: () => {} });
    vi.useFakeTimers();
    useAppStore.setState({ map: null, scored: null, attempts: 0, fellBack: false, generating: false });
    generateMapMock.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('idle before the first generation', () => {
    expect(statusNow().kind).toBe('idle');
  });

  it('runs generating -> done and lands the result', () => {
    useAppStore.getState().generate();
    expect(useAppStore.getState().generating).toBe(true);
    expect(statusNow().kind).toBe('generating');

    vi.runAllTimers();

    const s = useAppStore.getState();
    expect(s.generating).toBe(false);
    expect(s.map).not.toBeNull();
    expect(s.attempts).toBeGreaterThan(0);
    expect(statusNow().kind).toBe('done');
  });

  it('a throwing generation clears the flag instead of stranding "generating"', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateMapMock.mockImplementationOnce(() => {
      throw new Error('forced failure');
    });

    useAppStore.getState().generate();
    expect(statusNow().kind).toBe('generating');
    vi.runAllTimers();

    const s = useAppStore.getState();
    expect(s.generating).toBe(false);
    expect(s.map).toBeNull();
    expect(statusNow().kind).toBe('idle');
    quiet.mockRestore();
  });

  it('a fallback result reads as best-effort, not as solved or stranded', () => {
    // Produce a real map through the wrapped generator, then hand back a
    // doctored copy carrying the flags the slow scenario paths produce. The
    // generator itself is untouched.
    const genuine = generateMap({ playerCount: 4, variants: useAppStore.getState().variants });
    generateMapMock.mockImplementationOnce(() => ({ ...genuine, attempts: 5000, fellBack: true }));

    useAppStore.getState().generate();
    vi.runAllTimers();

    const s = useAppStore.getState();
    expect(s.generating).toBe(false);
    expect(s.fellBack).toBe(true);
    const st = statusNow();
    expect(st.kind).toBe('fallback');
    expect(st.text).toContain('5000');
  });

  it('drawer open state toggles through the store', () => {
    expect(useAppStore.getState().drawerOpen).toBe(false);
    useAppStore.getState().setDrawerOpen(true);
    expect(useAppStore.getState().drawerOpen).toBe(true);
    useAppStore.getState().setDrawerOpen(false);
    expect(useAppStore.getState().drawerOpen).toBe(false);
  });
});
