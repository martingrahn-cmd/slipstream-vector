// Portal adapter (CrazyGames) — the whole file is inert unless the page
// carries window.SV_PORTAL, which ONLY tools/package-portal.mjs injects.
// The GitHub Pages build never sets it, so every call here no-ops there by
// construction, and the portal build degrades to the same no-ops if the SDK
// fails to load (offline QA, ad blockers, --verify's blocked network) —
// a missing SDK must never cost the game anything but the ads.
//
// What the portal gets, and why:
//   - loading/gameplay events: the telemetry their full-launch review reads
//   - happytime(): wins and records, their "player is having a moment" signal
//   - midgame ad on the results board (never in gameplay), audio suspended
//     through the ad via the callbacks
//   - save mirroring: every sv-* localStorage key is copied into their data
//     module (account-synced when the player is logged in) at natural save
//     points, and restored at boot — trophies, records and ghosts follow the
//     player across devices, which localStorage alone cannot do. The same
//     hole a private window showed us: STATUS.md 2.6m.
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

class Portal {
  constructor() {
    this.sdk = null;      // set only when init found a live, enabled SDK
    this._inited = false;
  }

  get active() { return !!this.sdk; }

  async init() {
    if (this._inited || !window.SV_PORTAL) return;
    this._inited = true;
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = SDK_URL;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
        setTimeout(rej, 8000);   // a hung CDN must not hold the game hostage
      });
      const sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (!sdk) return;
      await sdk.init();
      if (sdk.environment === 'disabled') return;
      this.sdk = sdk;
      await this.restoreSaves();
    } catch (e) { /* no SDK, no portal features — the game itself is whole */ }
  }

  loadingStart() { try { if (this.sdk) this.sdk.game.loadingStart(); } catch (e) { /* never fatal */ } }
  loadingStop() { try { if (this.sdk) this.sdk.game.loadingStop(); } catch (e) { /* never fatal */ } }
  gameplayStart() { try { if (this.sdk) this.sdk.game.gameplayStart(); } catch (e) { /* never fatal */ } }
  gameplayStop() { try { if (this.sdk) this.sdk.game.gameplayStop(); } catch (e) { /* never fatal */ } }
  happytime() { try { if (this.sdk) this.sdk.game.happytime(); } catch (e) { /* never fatal */ } }

  // Midgame ad on the results board. onMute/onUnmute bracket the ad so the
  // caller can suspend the AudioContext — their QA checks game audio is
  // silent under an ad. Resolves whatever happens; an adError is just "no ad".
  midgameAd(onMute, onUnmute) {
    return new Promise((res) => {
      if (!this.sdk) return res(false);
      try {
        this.sdk.ad.requestAd('midgame', {
          adStarted: () => { try { onMute(); } catch (e) { /* keep the ad flow alive */ } },
          adFinished: () => { try { onUnmute(); } catch (e) { /* ditto */ } res(true); },
          adError: () => { try { onUnmute(); } catch (e) { /* ditto */ } res(false); },
        });
      } catch (e) { try { onUnmute(); } catch (e2) { /* ditto */ } res(false); }
    });
  }

  // ---- save mirroring ------------------------------------------------------
  // Generic over the sv- prefix: no per-key registry to drift out of date
  // when a new record/trophy key lands. An index key lists what was mirrored,
  // because the data module has no enumeration.
  async pushSaves() {
    if (!this.sdk) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sv-')) keys.push(k);
      }
      for (const k of keys) this.sdk.data.setItem(k, localStorage.getItem(k));
      this.sdk.data.setItem('sv-keys', JSON.stringify(keys));
    } catch (e) { /* sync is a bonus, never a blocker */ }
  }

  async restoreSaves() {
    if (!this.sdk) return;
    try {
      const idx = this.sdk.data.getItem('sv-keys');
      if (!idx) return;
      for (const k of JSON.parse(idx)) {
        const v = this.sdk.data.getItem(k);
        // The account copy fills gaps; a fresh local value wins (the player
        // just made it on THIS device — don't clobber it with cloud history).
        if (v !== null && v !== undefined && localStorage.getItem(k) === null) {
          localStorage.setItem(k, v);
        }
      }
    } catch (e) { /* sync is a bonus, never a blocker */ }
  }
}

export const portal = new Portal();
