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
    scrubCount: 210,      // low desert bushes near the track
    roadside: 'tufts',    // stage-2 near-band kit: dry grass + pebbles
    roadsideCount: 560,
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
    flora: 'palms',
    floraCount: 180,
    rockCount: 160,
    scrubCount: 95,       // low coastal scrub on the sandbars
    roadside: 'marina',   // stage-2 near-band kit: weathered mooring posts
    roadsideCount: 240,
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
      cloudAmp: 0.35,
    },
    fog: 0xd668a8,
    ground: 0x1e1a38,     // lifted asphalt
    mesaLit: 0x3c3568,    // tower blocks catch the evening light
    mesaShadow: 0x262048,
    mesaRim: 0xff9fd0,
    warm: 0xc6ceff,       // cool blue-hour highlight
    mountainFar: 0x2e2658,
    rock: 0x342c54,
    trackBase: 0x161630,
    trackBand: 0x242444,
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
    roadside: 'street',   // stage-2 near-band kit: barrier blocks + lit vents
    roadsideCount: 420,
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
};
