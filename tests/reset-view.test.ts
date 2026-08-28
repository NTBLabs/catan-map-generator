import { describe, it, expect, beforeEach } from 'vitest';
import { createPanZoom } from '../src/ui/panZoom';
import { resetView } from '../src/ui/resetView';
import { useAppStore } from '../src/state/store';

// The ⟲ escape hatch must reset the WHOLE view. The regression this pins:
// after a5591b8 grouped the rotate nudges, ⟲ reads as "the reset" for the
// cluster, but it only reset pan/zoom, so on a rotated (unpanned) board it
// ran and changed nothing: a dead button in practice.

function makePanZoom() {
  return createPanZoom({
    handle: () => ({
      setCSSTransform: () => {},
      setWillChange: () => {},
      setSVGTransform: () => {},
    }),
    geometry: () => ({ viewBoxR: 6.659, boardCx: 0, boardCy: 0, pxPerUnit: 30 }),
    dev: false,
  });
}

describe('resetView (the ⟲ escape hatch)', () => {
  beforeEach(() => {
    useAppStore.setState({ rotation: 0 });
  });

  it('resets pan, zoom, AND rotation, leaving no view state dirty', () => {
    const pz = makePanZoom();
    pz.panByPixels(120, 80);
    pz.zoomByWheel(-300);
    useAppStore.setState({ rotation: 150 });

    resetView(pz, useAppStore.getState().resetRotation);

    expect(pz.getView()).toEqual({ x: 0, y: 0, scale: 1 });
    expect(useAppStore.getState().rotation).toBe(0);
  });

  it('visibly resets a rotation-only dirty view (the a5591b8 dead-button report)', () => {
    const pz = makePanZoom();
    useAppStore.getState().rotateBy(90);
    // Pan/zoom already at identity: the old pan/zoom-only reset was a no-op
    // here, which is exactly what read as a dead button.
    resetView(pz, useAppStore.getState().resetRotation);
    expect(useAppStore.getState().rotation).toBe(0);
    expect(pz.getView()).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
