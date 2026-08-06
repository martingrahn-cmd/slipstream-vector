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
    this.badT = 0;          // seconds spent below the drop threshold, unbroken
    this.hitches = 0;       // consecutive frames too long to be steady state
    this.pending = null;    // a climb earned mid-race, waiting for the flag
    this.judged = 0;        // the fps reading the last decision was made on
    this.fails = new Array(maxIdx + 1).fill(0);  // times each tier failed to hold
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
  // MUST be fed the RAW frame time. The caller's `realDt` is clamped for the
  // simulation's sake and that clamp made this method's own hitch guard
  // unreachable — see the note at the call site in main.js.
  sample(dtMs, allowClimb = true) {
    if (!(dtMs > 0)) return null;
    // One long frame is a HITCH — a shader compiling, a world building, a tab
    // returning from the background — and it says nothing about how fast this
    // machine renders. Reject it outright. But TWENTY in a row is not a hitch:
    // that is five unbroken seconds of nothing but stalls, and a machine
    // genuinely rendering at 3fps has to be allowed to drop, so past the streak
    // the frames start counting (at the cap, not at their real length).
    if (dtMs > 250) {
      if (++this.hitches < 20) return null;
      dtMs = 250;
    } else this.hitches = 0;
    const dt = dtMs / 1000;
    // The hold exists to ignore the frames immediately AFTER a tier change: the
    // render targets reallocate and the bloom shaders recompile, which is
    // hundreds of milliseconds of jank caused BY the decision rather than
    // evidence for the next one. Updating the EMA above this line fed exactly
    // those frames into the average, so `ema = 1000/60` below never got the
    // clean slate its comment promises and one drop cascaded into two.
    if (this.hold > 0) { this.hold -= dt; return null; }
    this.ema += (dtMs - this.ema) * 0.06;

    const fps = 1000 / this.ema;
    if (fps < this.target - 12 && this.idx > 0) {
      // Struggling — but only act on it if it PERSISTS. A tier the machine was
      // holding a second ago is not disproved by one burst of jank the average
      // has yet to shake off, and a drop is expensive to undo (see the ceiling).
      this.badT += dt;
      if (this.badT < 0.75) return null;
      // Step down and remember that this tier did not hold.
      this.judged = fps;
      const from = this.idx--;
      // The CEILING is what makes a drop expensive to undo — it is a promise
      // not to retry this tier — so do not pay it for a tier's FIRST failure.
      // From in here, six bad seconds of browser jank and a machine that
      // genuinely cannot render the tier look exactly alike, and only one of
      // them happens twice. Dropping is still instant either way; what the
      // second failure buys is the belief that it was not a fluke.
      if (++this.fails[from] >= 2) this.ceiling = this.idx;
      this.goodT = 0;
      this.badT = 0;
      this.hold = 2.0;
      this.ema = 1000 / 60; // re-measure from scratch at the new tier
      return this.idx;
    }
    this.badT = 0;
    // Climb on "comfortably AT target", not "target plus headroom". The obvious
    // version — require target + 8 — is broken on any vsync-capped display:
    // a 60Hz panel physically cannot report 66fps, so a machine that dipped
    // once could never climb back and would sit at LOW for the rest of the
    // session. The ceiling below is what stops this from turning into hunting:
    // a tier that fails once is not retried until the 45s probe.
    if (fps > this.target - 2) {
      this.goodT += dt;
      // Judge the ceiling against what we will actually be RUNNING next race,
      // not against what is on screen now: a climb that is already parked is a
      // decision taken, so a long clean race can earn a second rung behind it
      // instead of the ceiling stalling on a tier we have already left.
      const at = this.pending ?? this.idx;
      // How hard it is to reopen a tier scales with how often it has already
      // failed HERE, and the third failure closes it for this circuit. Without
      // that, a machine which genuinely cannot hold FULL climbs back into it
      // every couple of races and drops again in the first corner, forever.
      // Three attempts is the budget: one free (the ceiling does not even move
      // on a first failure), one cheap, one expensive, then the evidence is in.
      const f = this.fails[this.ceiling + 1] || 0;
      const probe = f >= 3 ? Infinity : f >= 2 ? 60 : 20;
      if (at === this.ceiling && this.ceiling < this.maxIdx && this.goodT > probe) {
        // Sitting at the ceiling with room to spare. The machine may have freed
        // up (a browser tab closed, a laptop off battery saver), so raise the
        // ceiling and let the climb retry it. Without this a single early
        // stutter would pin the player at LOW for the rest of the session.
        //
        // This MUST stay above the `!allowClimb` return below. It used to sit
        // under it, and since the caller always passes allowClimb=false (climbs
        // are parked, never applied mid-race), the ceiling could never rise
        // once it had fallen — for the whole life of the mode. One bad minute
        // pinned the rest of the session at LOW with no way back short of
        // opening OPTIONS. Raising the ceiling changes nothing you can see; it
        // only restores the belief that a tier is worth retrying, so it is safe
        // mid-race in a way an actual climb is not.
        //
        // The probe was also 45s, which on top of the 12s climb and the parked
        // cash-in meant two full races of unbroken frames per rung.
        this.ceiling++;
        this.goodT = 0;
        return null;
      }
      if (at < this.ceiling && this.goodT > 12) {
        // Twelve unbroken seconds of headroom below a ceiling we already trust.
        if (!allowClimb) {
          this.pending = at + 1;      // earned it; cash it in at the next start
          this.goodT = 0;
          return null;
        }
        this.judged = fps;
        this.idx++;
        this.goodT = 0;
        this.hold = 3.0;
        this.ema = 1000 / 60;
        return this.idx;
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
    this.badT = 0;
    this.hitches = 0;
    this.pending = null;
  }

  // A different circuit is a different workload, and the evidence that pinned
  // the ceiling was gathered somewhere else — a city night in the rain says
  // nothing about a daylight desert. Restore the belief that the top tier is
  // reachable and let the normal climb prove it. The current tier does NOT
  // jump: the controller earns its way back up, it is not handed the ceiling.
  newWorkload() {
    // reset() clears `pending`, and a world can be rebuilt between earning a
    // climb and the race start that cashes it. Keep it: it was earned on frames
    // that were real, and the worst case is one race spent a rung too high.
    const p = this.pending;
    this.ceiling = this.maxIdx;
    this.fails.fill(0);
    this.reset(this.idx);
    this.pending = p;
  }
}
