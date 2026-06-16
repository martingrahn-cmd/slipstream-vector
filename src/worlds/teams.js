// Four racing teams: visual variant + two liveries + driver personality +
// SHIP STATS (WipEout-style strengths/weaknesses). The stats apply to the
// ship — player and AI alike get the team's ship. Drivers never cheat:
// difficulty only changes driver skill, never physics. No rubber-banding.
//
// stats: vmax = top speed multiplier, accel = thrust multiplier,
//        steer = lateral authority multiplier. Trade-offs roughly balance.
// bars: 0-5 display values for the menu (speed / thrust / handling).

export const TEAMS = [
  {
    id: 'vektor',
    name: 'VEKTOR',
    fullName: 'Vektor Dynamics',
    pilots: ['JUNO VEX', 'KAIDE SORO'],
    variant: { scaleX: 1.0, scaleZ: 1.0, finScale: 1.0, bellScale: 1.0 },
    skill: { corner: 0.0, line: 0.0, boost: 0.0 },
    stats: { vmax: 1.0, accel: 1.0, steer: 1.0 },
    bars: { speed: 3, thrust: 3, handling: 3 },
    blurb: 'The all-rounder. No habits to unlearn.',
    liveries: [
      { hull: 0xe8e4f0, accent: 0xff2e88 }, // white / magenta
      { hull: 0x232038, accent: 0x00f0ff }, // gunmetal / cyan
    ],
  },
  {
    id: 'halcyon',
    name: 'HALCYON',
    fullName: 'Halcyon Raceworks',
    pilots: ['MERIDIAN BLUE', 'SOL ANARA'],
    variant: { scaleX: 0.86, scaleZ: 1.12, finScale: 0.7, bellScale: 0.95 },
    skill: { corner: 0.01, line: 0.03, boost: -0.06 },
    stats: { vmax: 0.985, accel: 1.02, steer: 1.13 },
    bars: { speed: 2, thrust: 3, handling: 5 },
    blurb: 'Carves corners like they owe it money.',
    liveries: [
      { hull: 0xfff3e0, accent: 0xffb13d }, // cream / amber
      { hull: 0x1d3c48, accent: 0x7df9ff }, // deep teal / ice
    ],
  },
  {
    id: 'razorback',
    name: 'RAZORBACK',
    fullName: 'Razorback Velocity',
    pilots: ['VOSS KRAIT', 'KIRA NOX'],
    variant: { scaleX: 1.14, scaleZ: 0.92, finScale: 1.12, bellScale: 1.05 },
    skill: { corner: 0.035, line: -0.025, boost: 0.0 },
    stats: { vmax: 1.03, accel: 0.95, steer: 0.92 },
    bars: { speed: 5, thrust: 2, handling: 2 },
    blurb: 'Fastest thing on the straights. Pray for the corners.',
    liveries: [
      { hull: 0x241019, accent: 0xff3d2e }, // black / red
      { hull: 0xd8e2e8, accent: 0x16101e }, // silver / black
    ],
  },
  {
    id: 'novasurge',
    name: 'NOVASURGE',
    fullName: 'NovaSurge Industries',
    pilots: ['LYRA STORM', 'ECHO TANE'],
    variant: { scaleX: 1.0, scaleZ: 0.88, finScale: 1.3, bellScale: 1.28 },
    skill: { corner: -0.02, line: -0.01, boost: 0.1 },
    stats: { vmax: 0.99, accel: 1.14, steer: 0.96 },
    bars: { speed: 2, thrust: 5, handling: 3 },
    blurb: 'Launches out of every corner. Lives for the pads.',
    liveries: [
      { hull: 0x3a1b6b, accent: 0xffe066 }, // violet / gold
      { hull: 0xe8e4f0, accent: 0x3fae6b }, // white / jungle green
    ],
  },
];

// Player callsigns to pick from.
export const CALLSIGNS = [
  'VANTA', 'KESTREL', 'MIRAGE', 'ZERO-G', 'PULSAR',
  'STRIX', 'ONYX', 'COMET', 'RIFT', 'AURELIA',
];

// The 7 AI seats around the player's chosen seat.
export function aiRoster(playerTeam, playerLivery) {
  const seats = [];
  for (let t = 0; t < TEAMS.length; t++) {
    for (let l = 0; l < 2; l++) {
      if (t === playerTeam && l === playerLivery) continue;
      seats.push({ team: TEAMS[t], livery: l, pilot: TEAMS[t].pilots[l] });
    }
  }
  return seats;
}
