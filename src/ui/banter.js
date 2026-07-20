// Rival banter comms-feed. Turns combat + overtake events into a corner stack
// of speaker chips: the rival's generated expression face + accent colour + a
// short trash-talk line + a comms blip. The PLAYER never speaks (you don't
// taunt yourself) — only the AI rivals. Text-first; voice is a later upgrade.
//
// Model (see pilot-expression-lab.html, the blueprint): every reaction routes
// to ONE of 3 buckets — GLAD (gloat) / ARG (angry) / NEUTRAL — and each bucket
// picks a line from the speaker's own voice bank. The face is the generated
// <slug>-<bucket> portrait (glad/arg), falling back to the profile portrait.
import { pilotSlug } from '../worlds/teams.js';

// Per-driver line banks, keyed by bucket. Distinct voices — the seed table from
// the lab. Expand freely; a driver can have as many lines as you like.
// EXPORTED: the voice lab (pilot-expression-lab.html) auditions these lines and
// tools/generate-voices.mjs batch-generates one audio clip per line — ONE
// source of truth, so generated audio always matches what the feed shows.
export const LINES = {
  'JUNO VEX': {
    glad: ["Rookie? Watch again.", "First blood to the kid.", "Blink and you missed it.", "Sheet music, remember?", "Golden. Every time.", "Was that your best line?", "The prodigy has teeth."],
    arg: ["That the best you've got?", "Cheap. I'll answer it.", "You woke the rookie up.", "Mistake. Yours.", "I don't blink — you will.", "Noted. And returned."],
  },
  'KAIDE SORO': {
    glad: ["Efficient.", "Down. Predictable.", "Calm hands win.", "No wasted motion.", "That's the difference.", "Rebuilt for exactly this."],
    arg: ["Unnecessary.", "I felt nothing.", "You'll want that back.", "Recorded.", "Patience. Then payback.", "A poor decision."],
  },
  'MERIDIAN BLUE': {
    glad: ["Calculated.", "The math was against you.", "Predictable trajectory.", "Probability favored me.", "Simple geometry.", "Optimal, as modeled."],
    arg: ["That wasn't in the model.", "Statistical anomaly.", "Recalculating. You still lose.", "An error — I correct errors.", "Variance. Temporary."],
  },
  'SOL ANARA': {
    glad: ["Gracefully done.", "A pleasure, as always.", "Grace wins races.", "After you — no, after me.", "Three titles for a reason.", "Watch the line, darling."],
    arg: ["...how rude.", "Apologies. This ends now.", "You'll regret the discourtesy.", "Composure, Sol.", "That was beneath you."],
  },
  'VOSS KRAIT': {
    glad: ["Prey.", "Taste the asphalt.", "Down you go.", "I was already past you.", "The hunt's over.", "Marked. Hunted. Finished.", "You slowed. Fatal."],
    arg: ["...you'll bleed for that.", "Now it's personal.", "The hunter turns.", "Run. It won't help.", "I don't forget prey."],
  },
  'KIRA NOX': {
    glad: ["Target neutralized.", "Probability: you lose.", "Overtake logged.", "You are inefficient.", "Zero lap-time wasted.", "Outcome: expected."],
    arg: ["Anomaly detected.", "That won't compute twice.", "Err—err—rebooting.", "Recalculating your defeat.", "Threat logged."],
  },
  'LYRA STORM': {
    glad: ["HAH! Gotcha!", "Wheee — down you go!", "Love this thing!", "Catch me, slowpoke!", "That boost pad's MINE!", "Sent it! No regrets!"],
    arg: ["Aw, come ON—", "Okay okay, now I'm mad!", "You'll pay for that! ...eventually!", "Rude! Fun, but rude!", "Game ON, jerk!"],
  },
  'ECHO TANE': {
    glad: ["Saw it coming.", "Read and struck.", "From above.", "Mapped this hours ago.", "Predicted. Executed.", "The launch was always mine."],
    arg: ["Didn't see that. Won't happen twice.", "Adjusting the map.", "Noted. Recalculated.", "A variable — I hate variables.", "You'll be predictable soon."],
  },
};

const GAP = 1.1;        // s minimum between chips (pacing)
const TTL = 3.7;        // s a chip stays up
const PILOT_CD = 4.0;   // s before the same rival can speak again
const MAX_QUEUE = 3;

export class BanterFeed {
  constructor(feedEl, audio) {
    this.el = feedEl;
    this.audio = audio;
    this.enabled = true;
    this.race = null;
    this.playerPhys = null;
    this._queue = [];
    this._cool = 0;                 // time until the next chip may show
    this._pilotCd = new Map();      // pilot name -> cooldown left
    this._chips = [];               // {node, t}
  }

  // Called on every field rebuild — learn the roster + who the player is.
  configure(race, playerPhys) {
    this.race = race;
    this.playerPhys = playerPhys;
    this.reset();
  }

  reset() {
    this._queue.length = 0;
    this._cool = 0;
    this._pilotCd.clear();
    for (const c of this._chips) c.node.remove();
    this._chips.length = 0;
    if (this.el) this.el.innerHTML = '';
  }

  setEnabled(on) { this.enabled = on; if (!on) this.reset(); }

  // Resolve a ShipPhysics to its pilot. Returns null for the player (they never
  // speak) or anything not on the grid.
  _rival(phys) {
    if (!this.race || phys === this.playerPhys) return null;
    const r = this.race.racers && this.race.racers.find((x) => x.phys === phys);
    if (!r) return null;
    return { name: r.seat.pilot, accent: r.accentCss, slug: pilotSlug(r.seat.pilot) };
  }

  // ---- event entry points (called from main.js) --------------------------
  weaponHit(e) {
    // Who reacts, in which mood: an AI gloats when THEY tag you; an AI seethes
    // when YOU (or another AI) tag them. Never position-aware.
    if (e.victimIsPlayer) this._say(this._rival(e.shooter), 'glad', 'HIT');
    else this._say(this._rival(e.victim), 'arg', 'HIT');
  }

  shieldSave(e) {
    if (e.shooterIsPlayer) this._say(this._rival(e.victim), 'glad', 'BLOCKED'); // their shield ate your shot
    else this._say(this._rival(e.shooter), 'arg', 'BLOCKED');                    // their shot bounced off you
  }

  // aiAhead: true = the rival just passed the player (gloat); false = the player
  // just passed the rival (seethe).
  overtake(rivalPhys, aiAhead) {
    this._say(this._rival(rivalPhys), aiAhead ? 'glad' : 'arg', aiAhead ? 'OVERTAKE' : 'PASSED');
  }

  // ---- queue / pacing ----------------------------------------------------
  _say(rival, bucket, tag) {
    if (!this.enabled || !rival) return;
    if ((this._pilotCd.get(rival.name) || 0) > 0) return; // this rival is on cooldown
    const bank = (LINES[rival.name] && LINES[rival.name][bucket]) || null;
    if (!bank || !bank.length) return;
    // Keep the line's INDEX so the generated clip (slug/bucket-i) matches the
    // exact line shown. Render-path randomness (Math.random) is allowed here.
    const idx = Math.floor(Math.random() * bank.length);
    this._queue.push({ rival, bucket, tag, line: bank[idx], idx });
    if (this._queue.length > MAX_QUEUE) this._queue.shift(); // drop the stalest
  }

  update(dt) {
    if (!this.enabled) return;
    if (this._cool > 0) this._cool -= dt;
    for (const [k, v] of this._pilotCd) { const n = v - dt; if (n <= 0) this._pilotCd.delete(k); else this._pilotCd.set(k, n); }

    if (this._cool <= 0 && this._queue.length) {
      const item = this._queue.shift();
      this._render(item);
      this._cool = GAP;
      this._pilotCd.set(item.rival.name, PILOT_CD);
    }

    // expire visible chips
    for (let i = this._chips.length - 1; i >= 0; i--) {
      const c = this._chips[i];
      c.t += dt;
      if (c.t >= TTL && !c.leaving) {
        c.leaving = true;
        c.node.classList.add('leaving');
        setTimeout(() => c.node.remove(), 320);
        this._chips.splice(i, 1);
      }
    }
  }

  _render({ rival, bucket, line, tag, idx }) {
    const s = rival.slug;
    // generated expression face -> profile fallback (png then jpg at each step)
    const img = `<img alt="" src="assets/pilots/${s}-${bucket}.png"`
      + ` onerror="if(this.dataset.s==='2'){this.remove()}`
      + `else if(this.dataset.s==='1'){this.dataset.s='2';this.src='assets/pilots/${s}.jpg'}`
      + `else{this.dataset.s='1';this.src='assets/pilots/${s}-${bucket}.jpg'}">`;
    const node = document.createElement('div');
    node.className = 'banter-chip';
    node.style.setProperty('--pa', rival.accent);
    node.innerHTML = `<div class="bc-face">${img}</div>`
      + `<div class="bc-spine"><div class="bc-top"><span class="bc-name">${rival.name}</span>`
      + `<span class="bc-tag">${tag}</span></div><div class="bc-line">${line}</div></div>`
      + `<div class="bc-led"></div>`;
    this.el.appendChild(node);
    this._chips.push({ node, t: 0, leaving: false });
    while (this._chips.length > MAX_QUEUE) {
      const old = this._chips.shift();
      old.node.remove();
    }
    if (this.audio) {
      // The VO now keys its own squelch open/closed; only fall back to the bare
      // comms chirp when there's no clip to play (so we never double-blip).
      const spoke = this.audio.playVoice && this.audio.playVoice(rival.slug, bucket, idx);
      if (!spoke && this.audio.commsBlip) this.audio.commsBlip();
    }
  }
}
