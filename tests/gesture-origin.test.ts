import { describe, it, expect } from 'vitest';
import { beginsOnViewControls } from '../src/ui/gestureOrigin';

// The pan gesture must ignore drags that begin on the view-control
// cluster. The guard is ancestor-based (the cluster container), NOT keyed
// to any button class, so regroupings like a5591b8's pill wrapper (which
// renamed the nudges and nested them a level deeper) cannot silently take
// a control out from under it. These fakes mirror the real DOM chains.

type Fake = { className: string; parentElement: Fake | null; closest: (sel: string) => Fake | null };

function el(className: string, parent: Fake | null): Fake {
  const node: Fake = {
    className,
    parentElement: parent,
    closest(sel: string) {
      const cls = sel.slice(1);
      let cur: Fake | null = node;
      while (cur) {
        if (cur.className.split(' ').includes(cls)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
  };
  return node;
}

const cluster = () => el('board__view-controls', el('app__board', null));

describe('beginsOnViewControls', () => {
  it('matches a nudge nested inside the pill wrapper (the a5591b8 chain)', () => {
    const nudge = el('board__rotate-btn', el('board__rotate', cluster()));
    expect(beginsOnViewControls(nudge as unknown as EventTarget)).toBe(true);
  });

  it('matches the direct-child buttons (readout, reset view)', () => {
    const readout = el('board__btn board__btn--label', cluster());
    const reset = el('board__btn', cluster());
    expect(beginsOnViewControls(readout as unknown as EventTarget)).toBe(true);
    expect(beginsOnViewControls(reset as unknown as EventTarget)).toBe(true);
  });

  it('does not match the pan surface', () => {
    const svg = el('board-svg', el('app__board', null));
    expect(beginsOnViewControls(svg as unknown as EventTarget)).toBe(false);
  });

  it('handles null and non-element targets', () => {
    expect(beginsOnViewControls(null)).toBe(false);
    expect(beginsOnViewControls({} as EventTarget)).toBe(false);
  });
});
