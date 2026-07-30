// Graphics quality tiers.
//
// The renderer is FILL-bound, not draw- or triangle-bound (see CLAUDE.md), so
// the tiers are ordered by how much screen coverage they buy back, not by how
// much geometry they remove:
//
//   1. pixel BUDGET    — not a bare pixelRatio. Cost scales with the drawing
//                        buffer AREA, and a bare ratio lets a 4K panel quietly
//                        ask for four times the work a 1080p one does. Each
//                        tier caps total pixels; the ratio is just the ceiling.
//   2. MSAA samples    — the composer's target is HalfFloat (8 bytes/px) and
//                        MSAA multiplies THAT. It is the most expensive thing
//                        in the renderer per unit of visible improvement, and
//                        it is nearly redundant once the buffer is already
//                        supersampled relative to the display.
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
    maxPixels: 1.2e6,
    samples: 0,
    // The JuicePass still RUNS at LOW — it just compiles out the 18-read radial
    // smear. The grade, the vignette and the banding dither live in that pass and
    // are the world's colour identity, not an effect; switching the whole thing
    // off made LOW flatter and open-cornered, which is a different look rather
    // than a softer one. One texture read at 1.2Mpx is not what costs LOW money.
    post: false,
    bloom: false,
    shafts: 0,
    reflect: false,
    gloss: 0.8,
    // MEASURED 2026-07-29 (FIDELITY.md §5a): the entire additive layer runs at
    // ~0.05 of one screen fill. `motes` — the knob this tier used to cut hardest,
    // to 0.3x — governs 0.001-0.013 of a fill. LOW was trading the world's
    // atmosphere for one part in a thousand of the frame. `life` is instance
    // COUNT on meshes that draw once either way, i.e. vertices, and §1 shows the
    // frame is nowhere near a triangle wall. All three go back to full: LOW is
    // the same game rendered softer, and it now actually is. The real savings
    // stay where they were measured to be — pixels, MSAA, bloom, shafts.
    life: 1,
    motes: 1,
    sparks: 1,
  },
  {
    id: 'medium',
    name: 'MEDIUM',
    blurb: 'The full look at half the pixels. Safe on unknown hardware.',
    pixelRatio: 1.0,
    maxPixels: 2.6e6,
    samples: 2,
    post: true,
    // MEDIUM gets the LOOK, not just the grade. Bloom, shafts and the wet road
    // were gated to FULL under a cost model that turned out to be wrong: the
    // expensive thing was pixelRatio x MSAA, which buys no beauty at all, while
    // these three are 4 small passes and some shader maths. Measured on a
    // 4K panel, adding them to MEDIUM costs 10.0 -> 13.2 GB/s — half of FULL,
    // and a third of what the old uncapped FULL was demanding. There was never
    // a good reason most players should see the plain version.
    bloom: true,
    shafts: 1,
    reflect: false,     // 8 ships x 2 draws + additive coverage stays FULL-only
    gloss: 1.7,         // free: shader maths on fragments already being shaded
    life: 1,            // see LOW: measured, and it was never the cost
    motes: 1,
    sparks: 1,
  },
  {
    id: 'full',
    name: 'FULL',
    blurb: 'Everything on. What the game is authored to look like.',
    // 1.5 was the old global cap, chosen when ONE setting had to be safe on
    // every machine. With MEDIUM underneath it and ADAPTIVE watching, FULL can
    // ask for the display's native resolution: on a HiDPI panel that is the
    // difference between soft neon edges and clean ones.
    pixelRatio: 2.0,
    // ~4.2 Mpx is the ceiling: measured on an M4 Mac mini, an uncapped 2.0 on a
    // 4K panel meant an 8.3 Mpx buffer which, with 4x MSAA on HalfFloat, asked
    // for ~44 GB/s of framebuffer traffic on a chip with ~120 GB/s TOTAL. It
    // ran at 20fps while MEDIUM ran at 60 — and none of that gap was the
    // effects. Cap the area and the tier is bounded on any display.
    maxPixels: 4.2e6,
    // 4x MSAA on top of a supersampled buffer is paying twice for the same
    // edges. 2x plus the downscale is indistinguishable and half the bandwidth.
    samples: 2,
    post: true,
    bloom: true,
    shafts: 1,
    reflect: true,      // every ship reflects, on every world — the FULL exclusive
    gloss: 1.7,
    life: 1,            // the busier world, as authored
    motes: 1,
    sparks: 1,
  },
  {
    id: 'ultra',
    name: 'ULTRA',
    blurb: 'Native resolution on a 4K panel. Manual only — ADAPTIVE never picks it.',
    // The one number that separates this from FULL. FULL's 4.2Mpx cap means a
    // 4K panel renders at 0.71x native and upscales: the game is SOFTEST on the
    // most expensive screens, which is backwards. 8.3Mpx is exactly 4K native.
    //
    // Why this is a separate rung rather than a bigger FULL: FULL is measured
    // at a steady 60fps on an M4 with a 4K panel, and that is the default
    // everyone lands on. Raising it risks the proven default on the strongest
    // evidence we have. This costs 8.0 GB/s of colour-buffer fill against
    // FULL's 4.0 — comfortable against ~120 GB/s of system bandwidth on paper,
    // but the composer's ping-pong and the depth buffer ride on top and are not
    // in that figure, so it wants measuring on real hardware before it becomes
    // anyone's default.
    //
    // ADAPTIVE deliberately cannot climb here (see ADAPTIVE_MAX): a tier this
    // heavy should be a choice someone makes and can immediately undo, not
    // something the controller wanders into mid-race.
    pixelRatio: 2.0,
    maxPixels: 8.3e6,
    samples: 2,
    post: true,
    bloom: true,
    shafts: 1,
    reflect: true,
    gloss: 1.7,
    life: 1,
    motes: 1,
    sparks: 1,
  },
];

export const ADAPTIVE = 'adaptive';
export const MODES = ['low', 'medium', 'full', 'ultra', ADAPTIVE];
// The highest rung ADAPTIVE is allowed to select on its own.
export const ADAPTIVE_MAX = TIERS.findIndex((t) => t.id === 'full');

// The pixelRatio a tier may actually use on a given canvas: never above the
// tier's ceiling, and never enough to blow the tier's pixel budget. This is
// what keeps FULL affordable on a 4K panel instead of quietly quadrupling the
// work — and it is a BUDGET, not a display match, so on a plain 1080p monitor
// FULL still renders above native and downscales, which is free antialiasing.
export function effectiveRatio(tier, cssW, cssH) {
  const area = Math.max(1, cssW * cssH);
  return Math.min(tier.pixelRatio, Math.sqrt(tier.maxPixels / area));
}

export function tierById(id) {
  return TIERS.find((t) => t.id === id) || TIERS[ADAPTIVE_MAX];
}

// Adaptive controller. Holds a target frame rate by stepping between the three
// real tiers, with the asymmetry that matters: drop FAST (a player suffering at
// 25fps should not suffer for long) and climb SLOW and reluctantly (a tier that
// oscillates is worse than one that is a notch too low). A tier that has
// already failed is never retried at the same confidence — the ceiling drops
// with it, so the loop converges instead of hunting.
export class Adaptive {
  constructor(target = 58, maxIdx = ADAPTIVE_MAX) {
    this.target = target;
    this.maxIdx = maxIdx;
    this.ema = 1000 / 60;   // ms per frame, exponential moving average
    this.idx = maxIdx;      // start optimistic at FULL
    this.ceiling = maxIdx;  // highest tier still believed reachable
    this.hold = 2.5;        // seconds before the first decision (let things warm up)
    this.goodT = 0;         // seconds spent comfortably above target
    this.pending = null;    // a climb earned mid-race, waiting for the flag
  }

  // Cash in a climb earned during a race. Called at the next race start.
  takePending() {
    const p = this.pending;
    this.pending = null;
    return p;
  }

  // Feed it real frame times. Returns a new tier index when it wants a change,
  // or null. Frames while the tab is throttled or a world is building are
  // rejected outright — a 400ms hitch is not evidence about steady-state speed.
  //
  // `allowClimb` is the asymmetry that matters in play: a DROP is an emergency
  // and happens the instant it is needed, mid-corner if it has to. A CLIMB is a
  // luxury, and the game changing how it looks while you are racing is worse
  // than staying a notch low — so a climb earned during a race is PARKED in
  // `pending` and the caller applies it at the next race start.
  //
  // Only ever feed this frames from an actual race. The menu is a different
  // workload — attract camera, podium canvas, DOM effects — and judging the
  // race by it is how a player who picked ADAPTIVE ended up starting at LOW.
  sample(dtMs, allowClimb = true) {
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
    // Climb on "comfortably AT target", not "target plus headroom". The obvious
    // version — require target + 8 — is broken on any vsync-capped display:
    // a 60Hz panel physically cannot report 66fps, so a machine that dipped
    // once could never climb back and would sit at LOW for the rest of the
    // session. The ceiling below is what stops this from turning into hunting:
    // a tier that fails once is not retried until the 45s probe.
    if (fps > this.target - 2) {
      this.goodT += dt;
      if (this.idx < this.ceiling && this.goodT > 12 && !allowClimb) {
        this.pending = this.idx + 1;  // earned it; cash it in at the next start
        this.goodT = 0;
        return null;
      }
      if (!allowClimb) return null;
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
    this.pending = null;
  }
}
