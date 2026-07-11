// Every tunable constant in the game lives here. Nothing is hardcoded elsewhere.
// Units: meters, seconds, radians (degrees noted where converted).

const deg = (d) => (d * Math.PI) / 180;

export const TUNING = {
  // ---- Longitudinal physics ----
  ACCEL: 32.0,            // m/s^2 full throttle — quick recovery after mistakes
  DRAG_K: 0.384,          // accel/drag balance -> vmax = ACCEL/DRAG_K = 83.3 m/s = 300 km/h
  COAST_K: 0.5,           // off-throttle drag coefficient
  BRAKE: 45.0,            // m/s^2
  VMAX: 32.0 / 0.384,     // 83.3 m/s
  BOOST_ACCEL: 40.0,      // m/s^2 while boosting
  BOOST_VCAP: 1.25,       // x VMAX while boosting
  BOOST_TIME: 1.2,        // s per pad (refresh, don't stack)
  SCRUB_THRESHOLD: 30.0,  // lateral g-demand (kappa*v^2) above which speed scrubs
  SCRUB_RATE: 1.0,        // m/s^2 per unit of excess demand — corners shave, never kill

  // ---- Lateral physics ----
  STEER_VD_BASE: 14.0,    // target lateral m/s at v=0
  STEER_VD_SPEED: 10.0,   // + this * speedNorm
  STEER_LAMBDA: 3.5,      // vd relaxation rate (pass 3: heavier still — the ship resists changing lateral direction)
  STEER_GRIP_MULT: 2.1,   // extra lambda when centering/counter-steering — heavy to commit, still crisp to straighten
  CENTRIFUGAL: 0.70,      // fraction of kappa*v^2 pushing outward (pass 2: more — corners push you wide, must steer)
  GRAVITY: 9.81,
  DRIFT_STEER_MULT: 1.8,  // airbrake steering multiplier
  DRIFT_LAMBDA: 2.5,      // vd relaxation while drifting (tail slides)
  DRIFT_BLEED: 4.0,       // m/s^2 speed bleed while airbraking
  DRIFT_MINI_BOOST: 8.0,  // m/s granted on releasing a >0.7s drift
  DRIFT_MIN_TIME: 0.7,

  // ---- Walls ----
  WALL_MARGIN: 1.4,       // ship half-width (1.7 with airbrakes) vs track half-width
  WALL_HARD_VD: 8.0,      // |vd| above this = hard hit
  WALL_HIT_KEEP: 0.78,    // v multiplier on hard hit
  WALL_BOUNCE: 0.2,       // vd reflection on hard hit
  WALL_SCRAPE_DECEL: 8.0,

  // ---- Hover ----
  HOVER_HEIGHT: 0.6,
  HOVER_K: 90.0,
  HOVER_C: 12.0,
  HOVER_TERRAIN_FOLLOW: 1.0, // vertical kick from track vertical curvature (airtime over crests)

  // ---- Jumps (ballistic over a track gap) ----
  JUMP_GRAVITY: 24.0,     // m/s^2 pulling the ship back down while airborne
  JUMP_LAND_TRAUMA: 0.3,  // x landing severity

  // ---- Slipstream / draft (fair catch-up: clean-air leader gets none, the
  // wake helps whoever sits in it — player and AI alike, no rubber-banding) ----
  DRAFT_RANGE: 22,        // m behind a ship that its wake reaches
  DRAFT_HALF_W: 4.2,      // m lateral half-width of the wake cone
  DRAFT_DRAG_CUT: 0.08,   // fraction of drag removed deep in the tow (terminal
                          //   speed is very sensitive to this — keep it small;
                          //   ~+6-10% top speed in a tight tow, never a free pass)
  DRAFT_ACCEL: 2.5,       // m/s^2 extra thrust at full draft (only on power)
  DRAFT_ATTACK: 5.0,      // how fast the draft factor eases in/out per second

  // ---- Input ramps ----
  STEER_RISE: 5.0,        // per second — pass 3: slower input ramp for more turn-in weight
  STEER_RELEASE: 14.0,
  THROTTLE_RISE: 8.0,
  THROTTLE_RELEASE: 10.0,

  // ---- Camera ----
  CAM_BACK_REST: 7.0,
  CAM_BACK_FAST: 9.5,
  CAM_UP_REST: 2.6,
  CAM_UP_FAST: 2.2,
  CAM_LAMBDA_LAT: 10.0,
  CAM_LAMBDA_LONG: 5.0,
  CAM_LAMBDA_VERT: 5.0,
  CAM_LAMBDA_LOOK: 10.0,
  CAM_LAMBDA_ROLL: 4.0,
  CAM_LAMBDA_FOV: 6.0,
  CAM_LOOKAHEAD: 12.0,    // meters of s ahead for look-at (at rest)
  CAM_LOOKAHEAD_FAST: 22.0, // ...lerped to this at top speed so the camera looks into the corner when fastest
  CAM_LAND_DIP: 0.5,      // meters of damped vertical settle on a jump landing
  CAM_LOOK_BLEND: 0.7,    // lookahead point vs ship pos
  CAM_LOOK_LAT: 0.2,      // x lateral velocity added to look point
  CAM_ROLL_BANK: 0.8,     // fraction of track bank
  CAM_ROLL_STEER: deg(6),
  CAM_DRIFT_SWING: 1.5,   // camera lateral offset per rad of drift angle (outside the slide)
  FOV_BASE: 66,           // tighter at rest so the speed-up swing reads bigger
  FOV_SPEED: 38,          // + this * speedNorm^1.5 — FOV is the main speed cue now (streaks removed)
  FOV_BOOST_SPIKE: 9,     // instant degrees on boost, decays over FOV_SPIKE_DECAY
  FOV_SPIKE_DECAY: 0.4,
  FOV_MAX: 108,

  // ---- Screen shake (trauma model) ----
  TRAUMA_DECAY: 1.2,
  TRAUMA_BOOST: 0.08, // a kick, not a rattle — boost feel comes from FOV/lunge/lines
  TRAUMA_HIT: 0.45,
  TRAUMA_BUMP: 0.22,      // ship-to-ship shunt — gentler than a wall, scales with closing speed
  TRAUMA_LAND: 0.3,
  TRAUMA_SCRAPE: 0.02,    // per 60Hz-frame equivalent
  TRAUMA_SCRAPE_CAP: 0.35,
  TRAUMA_SPEED_FLOOR: 0.12, // x speedNorm^2 minimum rumble
  SHAKE_POS_X: 0.15,
  SHAKE_POS_Y: 0.1,
  SHAKE_ROLL: deg(1.5),
  SHAKE_FREQ: 25,

  // ---- Hitstop ----
  HITSTOP_SCALE: 0.3,
  HITSTOP_TIME: 0.045,

  // ---- Near-miss whoosh (cosmetic feel: a doppler swish + a faint camera tug
  //  as a wall/pylon or a rival flies close past at speed — no trauma, no
  //  gameplay effect; detected read-only in the feel layer, routed via juice) ----
  NEARMISS_MIN_SN: 0.5,       // only sells speed above this speedNorm
  NEARMISS_WALL_GAP: 1.1,     // m inside the wall limit that reads as a skim
  NEARMISS_WALL_CD: 0.55,     // s before the wall whoosh can retrigger
  NEARMISS_RIVAL_DS: 4.5,     // m along-track window to count as 'alongside'
  NEARMISS_RIVAL_IN: 2.6,     // m lateral inner edge (just outside contact @2.5)
  NEARMISS_RIVAL_OUT: 6.5,    // m lateral outer edge of the near-miss band
  NEARMISS_RIVAL_CD: 0.9,     // s per-rival cooldown so one pass = one whoosh
  NEARMISS_PUNCH: 0.13,       // lateral camera tug toward the thing that flew past

  // ---- Weapons (Pass 3) ----
  // Every value identical for player and AI — weapons are combat, never catch-up.
  WEAPON_DISABLE_TIME: 1.7,  // s of cut thrust + mushy steering on hit (coast, not dead stop)
  WEAPON_TRAUMA: 0.62,       // one hard spike at impact — decay does the rest (no sustained shake)
  WEAPON_FLASH: 0.22,
  WEAPON_HITSTOP: 0.06,
  MISSILE_SPEED_REL: 25,     // m/s over the shooter's speed at launch
  MISSILE_LIFE: 5,           // s until despawn
  MISSILE_HIT_DS: 4.0,       // hit window along the track (m)
  MISSILE_HIT_DD: 2.2,       // hit window laterally (m)
  MISSILE_COOLDOWN: 0.25,    // s between shots of a salvo
  HOMING_RANGE: 90,          // lock range ahead (m)
  HOMING_D_RATE: 6,          // lateral tracking speed (m/s)
  HOMING_LIFE: 7,
  MINE_ARM: 0.5,             // s before a dropped mine is live
  MINE_LIFE: 25,
  MINE_TRIGGER_DS: 3.2,
  MINE_TRIGGER_DD: 2.2,
  WEAPON_BOOST_TIME: 1.6,    // rides the normal boostTimer pipeline
  WEAPON_SHIELD_TIME: 6.0,   // s a shield stays up before it drops on its own (or until it eats a hit)
  // Weapon pads arm EVERY empty-handed racer that crosses them (per-driver, no
  // shared pad lock — the leader can't hoard the pad). Scarcity + "the one who
  // needs it least" self-corrects via use-it-or-lose-it: a held weapon fizzles
  // if you don't fire it in time, so an offensive pickup with no target ahead
  // (typically the leader) is simply wasted. Position-blind, no rubber-banding.
  WEAPON_HOLD_TIME: 6.0,     // s an unfired held weapon lasts before it fizzles

  // ---- Boost envelope ----
  BOOST_ATTACK: 12.0,     // boostFactor per second
  BOOST_RELEASE: 3.0,

  // ---- Ship visual ----
  SHIP_ROLL_STEER: deg(34), // bank harder into the steer (visible "I'm cornering")
  SHIP_ROLL_LATG: deg(12), // per g of lateral acceleration — cornering g visibly banks the hull
  SHIP_ROLL_DRIFT: deg(45),
  SHIP_ROLL_LAMBDA: 10,
  SHIP_YAW_LEAD: deg(12),  // nose leads into the turn more
  SHIP_LEAN_LIFT: 1.1,     // raise the hull by this * |sin(roll)| so a banked wingtip doesn't clip the road
  SHIP_PITCH_THROTTLE: deg(4),
  SHIP_PITCH_BRAKE: deg(3),
  SHIP_PITCH_LAMBDA: 8,
  BOB_A1: 0.06, BOB_F1: 2.2,
  BOB_A2: 0.03, BOB_F2: 3.7,
  BOB_SPEED_KILL: 0.7,    // bob amplitude dies at speed

  // ---- Desert sun-gate set-piece ----
  // Driving INTO the sun through the Sun Gate blooms the disc + god-rays; the
  // final lap is crowned by a scripted meteor arcing across the sky.
  SUNGATE_ALIGN_LO: 0.55,   // heading·sun dot where the flare starts to bloom
  SUNGATE_ALIGN_HI: 0.94,   // ...and where it's full
  SUNGATE_FLARE_EASE: 2.6,  // per second — how fast the bloom eases in/out
  METEOR_DURATION: 2.6,     // s the last-lap fireball takes to cross the sky

  // ---- Fog / world ----
  FOG_COLOR: 0xff7a3c,
  FOG_NEAR: 60,
  FOG_FAR: 700,
  FOG_SPEED_PULL: 80,     // far -= this * speedNorm
  FOG_BOOST_PULL: 180,    // far -= this * boostFactor (tunnel on boost)

  // ---- Post ----
  VIGNETTE_BASE: 0.25,
  VIGNETTE_SPEED: 0.15,
  CHROMA_BASE: 0.0045,    // x speedNorm^2 — centre 30% is masked clear now, so edges can push harder
  CHROMA_BOOST_MULT: 1.4,
  RADIAL_SPEED: 0.026,    // x speedNorm^2 (centre stays sharp; smear ramps in only at the edges)
  RADIAL_BOOST: 0.040,    // x boostFactor
  RADIAL_CAP: 0.18,       // hard cap on the smear — picture still readable thanks to the centre mask
  FLASH_BOOST: 0.18,
  FLASH_HIT: 0.1,
  PIXEL_RATIO_CAP: 1.5,

  // (Hyperspace speed-lines removed — player feedback: distracting + motion
  //  sickness. Speed now reads via FOV, ground-rush, camera lunge and edge blur.)

  // ---- Sparks ----
  SPARK_POOL: 256,
  SPARK_HIT_COUNT: 40,
  SPARK_SCRAPE_RATE: 60,  // per second
  SPARK_GRAVITY: -20,

  // ---- Palette ----
  COL: {
    SKY_ZENITH: 0x12052e,
    SKY_UPPER: 0x3d1a78,
    SKY_MAGENTA: 0xc42b8f,
    SKY_HORIZON: 0xff7a3c,
    SKY_HOT: 0xffd23f,
    SUN_CORE: 0xffe066,
    SUN_STRIPE: 0xff477e,
    GROUND: 0x241052,
    MESA_SHADOW: 0x3a1b6b,
    MESA_LIT: 0x6b2fa0,
    MESA_RIM: 0xff8c5a,
    MOUNTAIN_FAR: 0x5c2a9d,
    TRACK: 0x1b1038,
    TRACK_BAND: 0x2a1a55,
    CENTERLINE: 0xf4f4f8,
    WARNING: 0xffe94a,
    EDGE_L: 0x00f0ff,     // cyan, left
    EDGE_R: 0xff2ec8,     // magenta, right
    WALL: 0x0d0820,
    PAD_CHEVRON: 0x7df9ff,
    PAD_BASE: 0x0033aa,
    // Weapon pads: fixed GOLD/AMBER — gameplay language like the boost-pad blue,
    // never theme-tinted, and clearly distinct from edge cyan/magenta.
    WEAPON_PAD_BASE: 0x7a3c00,
    WEAPON_PAD_GLOW: 0xffb13d,
    SHIP_HULL: 0xe8e4f0,
    SHIP_ACCENT: 0xff2e88,
    SHIP_CANOPY: 0x1a0b3d,
    ENGINE: 0x00f0ff,
    ENGINE_BOOST: 0xffffff,
    SPARK_A: 0xffd23f,
    SPARK_B: 0xff477e,
    CLOUD: 0xff9e6b,
  },

  // ---- Lighting bake ----
  SUN_DIR: [-0.4, 0.25, -1], // normalized at use

  // ---- Track geometry ----
  SLICE_STEP: 2.0,        // meters between cross-sections
  LUT_STEP: 0.5,          // meters between frame samples
  CROWN: 0.02,            // fraction of half-width
  WALL_HEIGHT: 1.2,
  WALL_LEAN: deg(10),
  BANK_FACTOR: 0.7,
  BANK_MAX: deg(32),
  BANK_V_DESIGN: 75,
  BANK_SMOOTH: 50,        // meters of gaussian smoothing on bank
  KAPPA_SMOOTH: 12,       // meters of smoothing on curvature

  // ---- Props ----
  PYLON_SPACING: 25,
  PYLON_OFFSET: 1.5,      // outside each wall
  RING_SPACING: 200,      // holo arches on straights
  RING_KAPPA_MAX: 0.0035, // "straight enough" for an arch
};

export { deg };
