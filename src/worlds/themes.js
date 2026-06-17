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
    sky: {
      zenith: 0x12052e,
      upper: 0x3d1a78,
      band: 0xc42b8f,
      horizon: 0xff7a3c,
      hot: 0xffd23f,
      sunCore: 0xffe066,
      sunStripe: 0xff477e,
      cloud: 0xff9e6b,
      sunSize: 0.17,
      sunStripes: 1.0,
      starLevel: 0.985,
      cloudAmp: 0.22,
    },
    fog: 0xff7a3c,
    ground: 0x241052,
    groundB: 0x33186b,    // dune-band second tone
    mesaLit: 0x6b2fa0,
    mesaShadow: 0x3a1b6b,
    mesaRim: 0xff8c5a,
    warm: 0xffd9a0,       // sun-facing highlight tint — warm sunset gold
    mountainFar: 0x5c2a9d,
    rock: 0x3a1b6b,
    trackBase: 0x1b1038,
    trackBand: 0x2a1a55,
    mesaStyle: 'rocks',
    mesaMax: 150,
    mountainStyle: 'peaks',
    farCount: 30,
    groundStyle: 'dunes',
    scrubCount: 170,      // low desert bushes near the track
    flora: 'cacti',
    floraCount: 80,
    rockCount: 260,
    billboardEvery: 220,
    searchlights: false,
    city: true,
    drones: 40,
    ambient: { color: 0xd8b06a, mode: 'dust' },   // drifting sand motes
  },

  tropic: {
    id: 'tropic',
    name: 'PALM COAST',
    music: 'coast',
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
    mesaMax: 110,
    mountainStyle: 'peaks',
    farCount: 9,          // open ocean horizon — just a few distant isles
    groundStyle: 'water',
    flora: 'palms',
    floraCount: 140,
    rockCount: 70,
    billboardEvery: 320,
    searchlights: false,
    city: false,
    drones: 34,
    ambient: { color: 0xeafff6, mode: 'spray' },  // sea spray sparkle
    birds: true,
  },

  city: {
    id: 'city',
    name: 'NEON SPRAWL',
    music: 'sprawl',
    sky: {
      zenith: 0x05030f,
      upper: 0x140b2e,
      band: 0x3a1b5e,
      horizon: 0xc93b8e,  // the city's own glow
      hot: 0xff8fc0,
      sunCore: 0xf5f0ff,  // a pale full moon
      sunStripe: 0xbcb8d9,
      cloud: 0x3d2b5e,    // smog banks
      sunSize: 0.09,
      sunStripes: 0.0,
      starLevel: 0.992,   // light pollution
      cloudAmp: 0.35,
    },
    fog: 0xc93b8e,
    ground: 0x0b0717,     // asphalt sprawl
    mesaLit: 0x231c44,    // tower blocks along the track
    mesaShadow: 0x120d28,
    mesaRim: 0xff8fc0,    // catch the city glow on the edges
    warm: 0xb9c2ff,       // cool moonlit highlight — it's night, not sunset
    mountainFar: 0x1a1133,
    rock: 0x1f1838,
    trackBase: 0x101020,
    trackBand: 0x1c1c36,
    gridGlow: 0xff2ec8,   // street grid shining through the asphalt
    mesaStyle: 'towers',
    mesaMax: 70,          // downtown blocks — the canyon rows carry the near field
    mountainStyle: 'towers',
    farCount: 34,
    groundStyle: 'grid',
    flora: null,
    floraCount: 0,
    rockCount: 0,
    billboardEvery: 130,  // ads everywhere
    searchlights: true,
    canyon: true,         // tower rows lining the track
    sprawl: true,         // low blocks filling the middle distance
    traffic: true,        // light streams flowing along the avenues
    overheads: true,      // sign gantries over the road
    city: true,
    drones: 52,
    ambient: { color: 0x9fb4ff, mode: 'rain' },   // neon rain streaks
    skyTraffic: true,     // aircars crossing the skyline
    bridges: true,        // elevated highways crossing over the track
  },
};
