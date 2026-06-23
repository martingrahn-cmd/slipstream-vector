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
  STEER_LAMBDA: 6.0,      // vd relaxation rate (lower = more weight/inertia in the turn-in, "flying" not "adjusting")
  STEER_GRIP_MULT: 1.9,   // extra lambda when centering/counter-steering (keeps it planted despite the lower lambda)
  CENTRIFUGAL: 0.58,      // fraction of kappa*v^2 pushing outward (higher = corners need active steering, less on-rails)
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
  STEER_RISE: 7.0,        // per second — slower ramp-in so a light tap = a small move (less twitchy)
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

  // ---- Boost envelope ----
  BOOST_ATTACK: 12.0,     // boostFactor per second
  BOOST_RELEASE: 3.0,

  // ---- Ship visual ----
  SHIP_ROLL_STEER: deg(34), // bank harder into the steer (visible "I'm cornering")
  SHIP_ROLL_LATG: deg(12), // per g of lateral acceleration — cornering g visibly banks the hull
  SHIP_ROLL_DRIFT: deg(45),
  SHIP_ROLL_LAMBDA: 10,
  SHIP_YAW_LEAD: deg(12),  // nose leads into the turn more
  SHIP_PITCH_THROTTLE: deg(4),
  SHIP_PITCH_BRAKE: deg(3),
  SHIP_PITCH_LAMBDA: 8,
  BOB_A1: 0.06, BOB_F1: 2.2,
  BOB_A2: 0.03, BOB_F2: 3.7,
  BOB_SPEED_KILL: 0.7,    // bob amplitude dies at speed

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
