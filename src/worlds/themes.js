// One theme per world: palette + scenery parameters. Track surface neon
// (cyan left / magenta right) and boost pad colors stay IDENTICAL across
// worlds on purpose — they are gameplay language, not set dressing.
//
// Rule of the art direction: fog color === sky horizon color, always.
// That single constraint is what melts the geometry into the backdrop.
//
// Style switches: mesaStyle 'rocks'|'towers', mountainStyle 'peaks'|'towers',
// flora 'cacti'|'palms'|null.

export const THEMES = {
  desert: {
    id: 'desert',
    name: 'SUNSET MESA',
    music: 'sunset',
    grade: { contrast: 1.05, saturation: 1.14 },   // bright late afternoon — open, warm
    // Bloom threshold rides the world's ambient brightness: a bright sky sits
    // near the threshold already, so lift it or the whole frame hazes over.
    bloom: { threshold: 0.95, strength: 0.42, shafts: 0.55 },  // low sun through the gate — the strongest shafts in the game
    adGlow: 0.32,
    // LIGHT PASS (Martin: world 1 too dark): lifted from near-night dusk to a
    // BRIGHT late afternoon — blue-violet sky, sandy warm ground, red-rock
    // mesas. The synthwave sun/stripes + violet accents keep the identity.
    sky: {
      zenith: 0x3a55c4,   // clear blue overhead (was near-black)
      upper: 0x8672e0,    // light violet
      band: 0xe87ab8,     // soft magenta haze
      horizon: 0xffa25e,  // light warm horizon
      hot: 0xffe27a,
      sunCore: 0xffec8f,
      sunStripe: 0xff6a92,
      cloud: 0xffc99a,
      sunSize: 0.17,
      sunStripes: 1.0,
      starLevel: 1.0,     // daylight — no stars
      cloudAmp: 0.3,
      event: 'planet',    // the sister planet reads as a pale day-moon now
    },
    fog: 0xffa25e,
    ground: 0xd0a068,     // warm sand (was dark purple)
    groundB: 0xe2bc84,    // light dune band
    mesaLit: 0xe08a56,    // sunlit red rock
    mesaShadow: 0x9a5a86, // violet-magenta shadow side — the synthwave tell
    mesaRim: 0xffc27a,
    warm: 0xffedc4,       // bright golden daylight highlight
    mountainFar: 0xc084c8, // light violet ridges melting into the haze
    rock: 0xb87a58,
    trackBase: 0x241448,  // the ROAD stays dark so the neon edges read
    trackBand: 0x342058,
    mesaStyle: 'rocks',
    mesaMax: 190,
    // Stage-1 world identity: composition knobs (see world-uplift plan).
    // horizonMask: angular windows that thin/boost the far-mountain rings —
    // a directed horizon instead of an even ring. ang in radians around the
    // track centroid; density 0..1 keeps that fraction; hScale scales height.
    horizonMask: [
      { ang: 0.12, span: 0.42, density: 0 },            // keep the skyline window clear
      { ang: 3.26, span: 1.1, density: 1, hScale: 1.45 }, // the great mesa wall opposite the city
      { ang: 1.7, span: 0.8, density: 0.45 },            // thinner flanks — open dune horizon
      { ang: -1.0, span: 0.55, density: 0.5 },
    ],
    // The world icon: a colossal free-standing rock arch on the SUN azimuth,
    // so the striped disc sits inside the opening most of the lap.
    landmark: { type: 'sunGate', dist: 430, scale: 1 },
    monumentZones: true,   // cluster the buttes into monument valleys + leave EMPTY dune flats
    rockCut: true,         // one canyon pass-through per lap — compression, then release toward the sun
    archMax: 22,          // ribbed arches over the long desert straights
    mountainStyle: 'ridges',   // jagged connected ridge strips — a third silhouette language
    farCount: 44,
    groundStyle: 'dunes',
    // Ground relief. Long lazy dunes, the tallest in the game — the desert is
    // the one world whose whole identity is the shape of the sand.
    terrain: { amp: 26, freq: 0.0034, octaves: 3 },
    wind: 1.15,           // open desert — the strongest breeze in the game
    scrubCount: 210,      // low desert bushes near the track
    roadside: 'tufts',    // stage-2 near-band kit: dry grass + pebbles
    roadsideCount: 560,
    dustDevils: 3,        // stage-4 ambient life: wandering sand columns
    flora: 'cacti',
    floraCol: 0x3f7a5c,   // sage-green cacti — pops against the bright sand
    floraCount: 120,
    rockCount: 340,
    billboardEvery: 220,
    searchlights: false,
    city: true,
    cityFar: true,         // a distant megacity glittering in the sunset haze on
                           // the skyline window — pushed out, hazed, warm-crowned,
                           // and (like all scenery) kept clear of the racing line
    drones: 8,             // near the gantry only — the desert sky belongs to the raptors
    birds: true,
    birdCol: 0x2a1440,     // raptors: deep dusk silhouettes circling the Sun Gate
    ambient: { color: 0xd8b06a, mode: 'dust' },   // drifting sand motes
  },

  tropic: {
    id: 'tropic',
    name: 'PALM COAST',
    music: 'coast',
    grade: { contrast: 1.10, saturation: 1.12 },   // bright, crisp daylight
    bloom: { threshold: 0.92, strength: 0.46, shafts: 0.34 },  // high daylight sun casts short
    adGlow: 0.0,                                    // daytime — signage isn't lit
    sky: {
      zenith: 0x0d3470,
      upper: 0x1565b8,
      band: 0x2ec4b6,     // turquoise haze over the lagoon
      horizon: 0xffb85c,
      hot: 0xffe99a,
      sunCore: 0xffde59,  // golden-hour sun
      sunStripe: 0xff8c42,
      cloud: 0xffffff,    // bright trade-wind clouds
      sunSize: 0.19,
      sunStripes: 1.0,
      starLevel: 0.999,   // still daylight — almost no stars
      cloudAmp: 0.42,
      cloudPuff: 2.6,     // wide cumulus banks, not thin dusk streaks
    },
    fog: 0xffb85c,
    ground: 0x0e8f86,     // the lagoon itself
    waterB: 0x19b8a2,     // wave-band second tone
    sand: 0xe8d8a8,       // island beaches
    mesaLit: 0x3fae6b,    // jungle islets
    mesaShadow: 0x1e6b4f,
    mesaRim: 0xffd98a,    // sun-kissed ridges
    warm: 0xfff2d0,       // bright golden-hour daylight highlight
    mountainFar: 0x2e8fa3,
    rock: 0x8f7a52,       // sandbars and driftwood rock
    trackBase: 0x12262e,
    trackBand: 0x1d3c48,
    mesaStyle: 'islands',
    mesaMax: 150,
    // Open OCEAN over the sun half (mountains removed — water meets sky at
    // golden hour), island ridge on the other side.
    horizonMask: [
      { ang: -1.93, span: 1.25, density: 0 },  // pure sea horizon (sun azimuth)
      { ang: 1.21, span: 1.6, density: 1, hScale: 1.1 }, // the island chain behind you
    ],
    // The world icon: a banded lighthouse silhouetted at the edge of the open
    // sea, slow rotating beam + a strip of cream resort towers further along.
    landmark: { type: 'lighthouse', ang: -1.15, dist: 385 },
    archMax: 14,          // a few light coastal arches
    mountainStyle: 'peaks',
    farCount: 26,         // distant isles dotting the horizon
    groundStyle: 'water',
    // Low sandbars and islets; the lagoon itself is water and stays flat.
    terrain: { amp: 9, freq: 0.0055, octaves: 3 },
    wind: 1.35,           // sea breeze off the lagoon — the palms carry it
    flora: 'palms',
    // Palms now grow on the islands' sand rings instead of being scattered off
    // the racing line (which, on a world whose ground IS the lagoon, stood them
    // in open water). Concentrated on the bigger half of the islands, so the
    // count buys density on the islands that have palms at all — one instanced
    // draw either way. 340 still read as a sparse handful per island; a palm
    // island should look overgrown, and this costs vertices on a mesh already
    // being drawn, not a draw call.
    floraCount: 760,
    rockCount: 160,
    scrubCount: 95,       // low coastal scrub on the sandbars
    roadside: 'marina',   // stage-2 near-band kit: weathered mooring posts
    roadsideCount: 240,
    sails: 4,             // stage-4 ambient life: sailboats on the far lagoon
    billboardEvery: 320,
    searchlights: false,
    city: false,
    drones: 46,
    ambient: { color: 0xeafff6, mode: 'spray' },  // sea spray sparkle
    birds: true,
  },

  city: {
    id: 'city',
    name: 'NEON SPRAWL',
    music: 'sprawl',
    grade: { contrast: 1.08, saturation: 1.10 },   // blue hour — moody but readable
    bloom: { threshold: 0.74, strength: 0.62, shafts: 0.20 },  // night city: let the neon bleed, barely any sun
    adGlow: 0.55,                                   // signage still blazes
    // LIGHT PASS (Martin: world 3 too dark): dead-of-night -> BLUE HOUR. The
    // sky keeps real light in it, the smog and towers lift two stops, and the
    // neon still owns the scene — night identity, readable picture.
    sky: {
      zenith: 0x1a2658,   // deep evening blue (was near-black)
      upper: 0x33427e,
      band: 0x5e4a9e,
      horizon: 0xd668a8,  // brighter city glow
      hot: 0xff9fd0,
      sunCore: 0xf5f0ff,  // the moon stays
      sunStripe: 0xbcb8d9,
      cloud: 0x584a80,    // lighter smog banks
      sunSize: 0.09,
      sunStripes: 0.0,
      starLevel: 0.992,   // light pollution
      cloudAmp: 0.42,
      cloudPuff: 3.2,     // smog BANKS lit from below by the city, not thin streaks
                          // — at puff 1.0 the layer was too narrow to read at all
                          // and the blue hour had nothing in it above the towers
    },
    fog: 0xd668a8,
    // SECOND LIGHT PASS (Martin, again: "ser inte staden lite mörk ut också?").
    // The first one lifted the SKY, and the sky was never the problem. Measured
    // over the press kit with the HUD bands masked out: city mean luma 39
    // against tropic's 71 and desert's 98, and 62% of the frame under luma 24 —
    // 72% on Grid Lock. What fills a racing frame is the ROAD and the GROUND,
    // and both were sitting at luma 25-31, so two thirds of the picture carried
    // no information at all. The tower faces were the third offender: an unlit
    // side at 38 makes a building a silhouette even when it is right next to
    // you. These are the surfaces, lifted; the neon, the rim and the grid glow
    // are untouched, so the contrast the world is built on is unchanged.
    ground: 0x2f2a55,     // lifted asphalt
    mesaLit: 0x544b8a,    // tower blocks catch the evening light
    mesaShadow: 0x342c62,
    mesaRim: 0xff9fd0,
    warm: 0xc6ceff,       // cool blue-hour highlight
    mountainFar: 0x3d3474,
    rock: 0x453a70,
    trackBase: 0x232342,
    trackBand: 0x35355e,
    // The walls and the road's underside flank the ribbon down the whole lap
    // and are the single largest dark area in a city frame. Lift them toward
    // the city's own ground so they read as structure at night instead of as
    // two black wedges. See wallColour() in track/trackMesh.js.
    wallLift: 0.62,
    gridGlow: 0xff2ec8,   // street grid shining through the asphalt
    mesaStyle: 'towers',
    mesaMax: 92,
    horizonMask: [
      { ang: 0.12, span: 0.5, density: 0 },              // the skyline window — nothing competes
      { ang: 3.26, span: 1.3, density: 1, hScale: 1.15 }, // industrial ridge behind the track
    ],
    // The world icon: THE SPIRE — one supertall anchoring the skyline
    // hierarchy (built inside buildCity, marked here for readability).
    landmark: { type: 'spire' },          // downtown blocks — the canyon rows carry the near field
    archMax: 40,          // dense industrial tunnel ribs over the straights
    mountainStyle: 'towers',
    farCount: 46,
    groundStyle: 'grid',
    flora: null,
    floraCount: 0,
    rockCount: 0,
    // A city floor is graded flat. Just enough to stop the plane reading as a
    // plane where it meets the towers.
    terrain: { amp: 4, freq: 0.0070, octaves: 2 },
    wind: 0.8,            // sheltered by the towers
    // Street lighting along the ribbon — masts, arms over the road, warm heads
    // and a soft cone each, evenly spaced because the RHYTHM is what reads at
    // 250 km/h. Warm white on purpose: never the cyan/magenta pair.
    trackLamps: { every: 44, col: 0xffdcae, height: 9.5, glow: 0.34 },
    roadside: 'street',   // stage-2 near-band kit: barrier blocks + lit vents
    roadsideCount: 420,
    blimp: true,          // stage-4 ambient life: an ad blimp rounding the skyline
    billboardEvery: 130,  // ads everywhere
    searchlights: true,
    canyon: true,         // tower rows lining the track
    sprawl: true,         // low blocks filling the middle distance
    traffic: true,        // light streams flowing along the avenues
    overheads: true,      // sign gantries over the road
    city: true,
    drones: 64,
    ambient: { color: 0x9fb4ff, mode: 'rain' },   // neon rain streaks
    skyTraffic: true,     // aircars crossing the skyline
    bridges: true,        // elevated highways crossing over the track
  },

  frost: {
    id: 'frost',
    name: 'FROSTFALL RIDGE',
    music: 'frost',
    grade: { contrast: 1.07, saturation: 0.96 },   // cold dusk — crisp, slightly drained
    bloom: { threshold: 0.78, strength: 0.58, shafts: 0.30 },  // dusk + aurora: generous halo, a moon casts softly
    adGlow: 0.0,
    sky: {
      zenith: 0x060a26,   // deep polar night
      upper: 0x0e1c46,
      band: 0x1e3a68,     // ice-blue haze band
      horizon: 0x6a4a92,  // violet dusk glow at the rim
      hot: 0xffd9ec,      // last pale pink of the sun
      sunCore: 0xeaf4ff,  // a MOON, not a sun — small, pale, no stripes
      sunStripe: 0xbcd0ee,
      cloud: 0x93a8cc,
      sunAz: [0.62, -0.78],
      sunSize: 0.055,
      sunStripes: 0.0,
      starLevel: 0.962,   // hard polar starfield
      cloudAmp: 0.22,
      cloudPuff: 1.3,
      event: 'aurora',    // the northern lights — build all race, own the zenith
    },
    fog: 0x2a3a5e,        // cold blue haze
    ground: 0xc7d4e8,     // moonlit snowpack
    groundB: 0xa7b9d6,    // wind-drift bands (sastrugi read via the dune shader)
    warm: 0xdfe9ff,       // moonlight 'warm' highlight — actually the coldest light
    sand: 0xdde8f6,
    mesaLit: 0xb2c4e0,    // snowbound peaks, lit side
    mesaShadow: 0x44548e, // deep blue shadow — the synthwave tell, frozen
    mesaRim: 0xeef4ff,    // ice-glare rims
    warmCrown: 0xffffff,
    mountainFar: 0x33487e,
    rock: 0x8ca4c6,       // ice boulders
    trackBase: 0x1a1640,  // the ROAD stays dark so the neon edges read
    trackBand: 0x2a2258,
    mesaStyle: 'rocks',
    mesaMax: 175,
    horizonMask: [
      { ang: 0.62, span: 0.9, density: 1, hScale: 1.5 },  // the RIDGE itself — a glacier wall under the moon
      { ang: -1.6, span: 0.7, density: 0.4 },             // open tundra window (aurora breathing room)
      { ang: 2.6, span: 0.8, density: 0.7 },
    ],
    landmark: { type: 'spire', dist: 430, scale: 1.1 },   // a colossal ice spire on the moon azimuth
    monumentZones: true,  // peak clusters with truly empty snowfields between
    rockCut: true,        // an ice-pass through the ridge — compression, then the aurora floods back
    archMax: 18,
    mountainStyle: 'ridges',
    farCount: 42,
    groundStyle: 'dunes', // the dune shader IS the snow shader: drift bands + sastrugi ripples
    // Snow drifts: sharper crests than sand, hence the ridge term.
    terrain: { amp: 17, freq: 0.0048, octaves: 3, ridge: 0.55 },
    wind: 0.7,            // cold, heavy air — the spruce barely shrugs
    scrubCount: 0,
    flora: 'pines',
    floraCol: 0x274842,   // frost-dark spruce green
    floraCount: 170,
    rockCount: 240,
    roadside: 'poles',    // stage-2 near-band kit: orange snow-marker stakes + drift humps
    roadsideCount: 320,
    dustDevils: 2,        // stage-4 ambient life: SNOW devils
    devilCol: 0xe4edf8,
    sculptures: 5,        // ice statues of race ships on pedestals — the world honours the sport
    skiers: 8,            // tiny figures carving slalom on the far snowfields
    huts: 6,              // ice-fishing huts on the lake, warm windows glowing
    billboardEvery: 260,
    searchlights: false,
    city: false,
    drones: 6,
    birds: false,
    ambient: { color: 0xffffff, mode: 'snow' },   // falling snow
  },
};
