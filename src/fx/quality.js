// Graphics quality tiers.
//
// The renderer is FILL-bound, not draw- or triangle-bound (see CLAUDE.md), so
// the tiers are ordered by how much screen coverage they buy back, not by how
// much geometry they remove:
//
//   1. pixelRatio      — every fragment cost scales with it. The big lever.
//   2. MSAA samples    — the composer's render target is HalfFloat; 4x samples
//                        on a 4K-ish buffer is real bandwidth on an iGPU.
//   3. additive volume — motes, sparks, trails, glow ribbons: the overdraw the
//                        budget is actually spent on.
//
// Scenery density and geometry density (SLICE_STEP, hull sections) are
// deliberately NOT tiered. They cost draws and vertices, which is the axis with
// headroom, and cutting them would make a weak machine look like a different,
// emptier, blockier game rather than the same game rendered softer.
//
// ADAPTIVE is the fourth option rather than a fifth tier: it picks one of the
// three real tiers from measured frame time and keeps picking.

export const TIERS = [
  {
    id: 'low',
    name: 'LOW',
    blurb: 'For integrated graphics and old laptops.',
    pixelRatio: 0.75,
    samples: 0,
    post: false,        // skip the JuicePass entirely — one full-screen pass saved
    motes: 0.3,
    sparks: 0.5,
  },
  {
    id: 'medium',
    name: 'MEDIUM',
    blurb: 'Balanced. The safe default on unknown hardware.',
    pixelRatio: 1.0,
    samples: 2,
    post: true,
    motes: 0.7,
    sparks: 0.8,
  },
  {
    id: 'full',
    name: 'FULL',
    blurb: 'Everything on. What the game is authored to look like.',
    pixelRatio: 1.5,
    samples: 4,
    post: true,
    motes: 1,
    sparks: 1,
  },
];

export const ADAPTIVE = 'adaptive';
export const MODES = ['low', 'medium', 'full', ADAPTIVE];

export function tierById(id) {
  return TIERS.find((t) => t.id === id) || TIERS[2];
}

// Adaptive controller. Holds a target frame rate by stepping between the three
// real tiers, with the asymmetry that matters: drop FAST (a player suffering at
// 25fps should not suffer for long) and climb SLOW and reluctantly (a tier that
// oscillates is worse than one that is a notch too low). A tier that has
// already failed is never retried at the same confidence — the ceiling drops
// with it, so the loop converges instead of hunting.
export class Adaptive {
  constructor(target = 58, maxIdx = TIERS.length - 1) {
    this.target = target;
    this.maxIdx = maxIdx;
    this.ema = 1000 / 60;   // ms per frame, exponential moving average
    this.idx = maxIdx;      // start optimistic at FULL
    this.ceiling = maxIdx;  // highest tier still believed reachable
    this.hold = 2.5;        // seconds before the first decision (let things warm up)
    this.goodT = 0;         // seconds spent comfortably above target
  }

  // Feed it real frame times. Returns a new tier index when it wants a change,
  // or null. Frames while the tab is throttled or a world is building are
  // rejected outright — a 400ms hitch is not evidence about steady-state speed.
  sample(dtMs) {
    if (!(dtMs > 0) || dtMs > 250) return null;
    this.ema += (dtMs - this.ema) * 0.06;
    const dt = dtMs / 1000;
    if (this.hold > 0) { this.hold -= dt; return null; }

    const fps = 1000 / this.ema;
    if (fps < this.target - 12 && this.idx > 0) {
      // Struggling. Step down and remember that this tier did not hold.
      this.idx--;
      this.ceiling = this.idx;
      this.goodT = 0;
      this.hold = 2.0;
      this.ema = 1000 / 60; // re-measure from scratch at the new tier
      return this.idx;
    }
    if (fps > this.target + 8) {
      this.goodT += dt;
      if (this.idx < this.ceiling && this.goodT > 12) {
        // Twelve unbroken seconds of headroom below a ceiling we already trust.
        this.idx++;
        this.goodT = 0;
        this.hold = 3.0;
        this.ema = 1000 / 60;
        return this.idx;
      }
      if (this.idx === this.ceiling && this.ceiling < this.maxIdx && this.goodT > 45) {
        // Sitting at the ceiling with room to spare for three quarters of a
        // minute. The machine may have freed up (a browser tab closed, a laptop
        // off battery saver), so raise the ceiling and let the climb retry it.
        // Without this a single early stutter would pin the player at LOW for
        // the rest of the session.
        this.ceiling++;
        this.goodT = 0;
      }
    } else if (fps < this.target) {
      this.goodT = 0;
    }
    return null;
  }

  // A settings change or a track load invalidates the measurement.
  reset(idx = this.idx) {
    this.idx = idx;
    this.ema = 1000 / 60;
    this.hold = 2.5;
    this.goodT = 0;
  }
}
