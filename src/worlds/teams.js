// Four racing teams: visual variant + one signature livery PER PILOT
// (liveries[0/1] = the team's first/second driver, hard-tied) + personality +
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
    variant: { scaleX: 1.0, scaleZ: 1.0, finScale: 1.0, bellScale: 1.0, arch: 'pronghorn' },
    skill: { corner: 0.0, line: 0.0, boost: 0.0 },
    stats: { vmax: 1.0, accel: 1.0, steer: 1.0 },
    bars: { speed: 3, thrust: 3, handling: 3 },
    blurb: 'The all-rounder. No habits to unlearn.',
    liveries: [
      // JUNO VEX — pearl-gold hull, rose accent, magenta→GOLD iridescent rim
      // (rookie gold). Trim: deep plum panelling grounds the pale hull.
      { hull: 0xf3eddc, accent: 0xff4f9d, glow: 0xff7ab0, rim: 0xffd24d, accent2: 0xffd24d, irid: true, trim: 0x5c2647, bellyTint: 0x2c1a30 },
      // KAIDE SORO — near-black aubergine hull, electric-violet accent, and a
      // COLD ICE counterpoint: the rim banks violet→ice so the dark twin isn't
      // one hue in eight shades, with ice-blue panel lines cutting the black.
      { hull: 0x231a30, accent: 0xb14dff, glow: 0xb14dff, rim: 0x7ce8ff, accent2: 0x7ce8ff, irid: true, trim: 0x2e7f9e, bellyTint: 0x0e0820 },
    ],
  },
  {
    id: 'halcyon',
    name: 'HALCYON',
    fullName: 'Halcyon Raceworks',
    pilots: ['MERIDIAN BLUE', 'SOL ANARA'],
    variant: { scaleX: 0.86, scaleZ: 1.12, finScale: 0.7, bellScale: 0.95, arch: 'manta',
      // Manta build tuned in the ship editor (Martin, livery A) — applied
      // team-wide so both Halcyon drivers share the same chassis.
      tune: { bodyW: 1.12, tipSize: 1.33, tipRaise: 1.88, tipX: -0.26, tipZ: 0.17, engX: 0.62, engY: 0.1, engZ: 2.44, engR: 0.17, canY: 0.25, canZ: -0.19, canW: 0.29, canH: 0.26, canL: 0.68 } },
    skill: { corner: 0.01, line: 0.03, boost: -0.06 },
    stats: { vmax: 0.985, accel: 1.02, steer: 1.13 },
    bars: { speed: 2, thrust: 3, handling: 5 },
    blurb: 'Carves corners like they owe it money.',
    liveries: [
      // MERIDIAN BLUE — porcelain hull, true azure accent (bluer than the cyan
      // road edge) with a HOT ORANGE counterpoint: complementary trim and a
      // blue→amber irid rim, so the mathematician reads as more than one blue.
      { hull: 0xe9eef3, accent: 0x2f8bff, glow: 0x4da3ff, rim: 0x8fd0ff, accent2: 0xff9a3c, irid: true, trim: 0xff6a1e, bellyTint: 0x14304a },
      // SOL ANARA — deep NAVY hull, CHAMPION GOLD engines and a gold→champagne
      // rim, with jade kept as a thin pinstripe on the panel lines. The teal
      // hull + jade accent + mint rim she used to wear made her the ship that
      // was "just green in eight shades"; now the green is a signature, not a
      // wash, and three titles read as navy-and-gold from across the grid.
      { hull: 0x101a3a, accent: 0xffc24d, glow: 0xffc24d, rim: 0xffe9b0, accent2: 0xffe9b0, irid: true, trim: 0x33e3b0, bellyTint: 0x060a1c },
    ],
  },
  {
    id: 'razorback',
    name: 'RAZORBACK',
    fullName: 'Razorback Velocity',
    pilots: ['VOSS KRAIT', 'KIRA NOX'],
    variant: { scaleX: 1.14, scaleZ: 0.92, finScale: 1.12, bellScale: 1.05, arch: 'delta',
      // Delta build tuned in the ship editor (Martin, livery A) — applied
      // team-wide so both Razorback drivers share the same chassis.
      tune: { wingSpan: 0.82, wingLen: 0.89, engX: 0.72, engY: -0.15, engZ: 2.6, engR: 0.24, finH: 1.17, finZ: -0.23, finLen: 1.29, canY: 0.08, canZ: -0.69, canW: 0.24, canH: 0.15, canL: 0.9 } },
    skill: { corner: 0.035, line: -0.025, boost: 0.0 },
    stats: { vmax: 1.03, accel: 0.95, steer: 0.92 },
    bars: { speed: 5, thrust: 2, handling: 2 },
    blurb: 'Fastest thing on the straights. Pray for the corners.',
    liveries: [
      // VOSS KRAIT — predator near-black hull, blood-red accent (darkest ship
      // on the grid) with BONE panelling and a red→bone irid rim: war paint on
      // a hunter, not a single wash of red.
      { hull: 0x180b0d, accent: 0xff2a1c, glow: 0xff3a1f, rim: 0xff5a30, accent2: 0xe8dcc4, irid: true, trim: 0xbfae90, bellyTint: 0x060203 },
      // KIRA NOX — chrome shell, amber-orange accent, ice-white mirror irid rim
      // (the AI). Trim: deep gunmetal-blue circuitry lines under the chrome.
      { hull: 0xd8dfe6, accent: 0xff8a1e, glow: 0xffa030, rim: 0x9fe6ff, accent2: 0xeaf6ff, irid: true, trim: 0x24506e, bellyTint: 0x2a2e34 },
    ],
  },
  {
    id: 'novasurge',
    name: 'NOVASURGE',
    fullName: 'NovaSurge Industries',
    pilots: ['LYRA STORM', 'ECHO TANE'],
    variant: { scaleX: 1.0, scaleZ: 0.88, finScale: 1.3, bellScale: 1.28, arch: 'twinboom' },
    skill: { corner: -0.02, line: -0.01, boost: 0.1 },
    stats: { vmax: 0.99, accel: 1.14, steer: 0.96 },
    bars: { speed: 2, thrust: 5, handling: 3 },
    blurb: 'Launches out of every corner. Lives for the pads.',
    liveries: [
      // LYRA STORM — electric-violet hull (brightened so it reads violet and
      // not brown under the warm key), lemon-gold accent (reckless boost-gold),
      // HOT PINK trim and a gold→pink irid rim: three loud colours, like her.
      { hull: 0x4a2597, accent: 0xffe23a, glow: 0xffcf2a, rim: 0xffee8c, accent2: 0xff4fa8, irid: true, trim: 0xe0338c, bellyTint: 0x150a33 },
      // ECHO TANE — pearl hull, acid-green accent, and DEEP INDIGO as the
      // counterweight: indigo engines (the twinboom's bells are the biggest
      // colour mass on the ship), indigo panel lines and an acid→indigo rim, so
      // the signal-green reads as a signal instead of drowning in more green.
      { hull: 0xe4e0ec, accent: 0x8ef23a, glow: 0x6b4cf0, rim: 0xd8ff8a, accent2: 0x5b3ce0, irid: true, trim: 0x3b2a8c, bellyTint: 0x161320 },
    ],
  },
];

// Driver bios — short, characterful, F-Zero roster flavour. Keyed by pilot name.
export const PILOT_BIOS = {
  'JUNO VEX': "Vektor's golden rookie. Reads a racing line like sheet music and never blinks first.",
  'KAIDE SORO': 'Half man, half rebuilt after the Sprawl crash. The calmest hands on the grid.',
  'MERIDIAN BLUE': 'Pilots by mathematics, not nerve. Has never scrubbed a millimetre off an apex.',
  'SOL ANARA': 'Three-time champion who came back for the love of it. Grace at 300 km/h.',
  'VOSS KRAIT': "Doesn't overtake — he hunts. Brake markers are for prey.",
  'KIRA NOX': 'A racing AI in a chrome shell. Zero fear, zero mercy, zero lap-time wasted.',
  'LYRA STORM': 'Lives one boost pad ahead of disaster and grins the whole way down.',
  'ECHO TANE': 'Reads the whole circuit from above before the lights go green. Strikes on the launch.',
};

// name -> portrait asset slug (drop a PNG at assets/pilots/<slug>.png).
export function pilotSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

// The 7 AI seats around the player's chosen DRIVER. The player races AS one of
// their team's two named pilots (playerPilot index), so that seat is skipped;
// every other named driver fills the grid in their signature livery.
export function aiRoster(playerTeam, playerPilot) {
  const seats = [];
  for (let t = 0; t < TEAMS.length; t++) {
    for (let l = 0; l < 2; l++) {
      if (t === playerTeam && l === playerPilot) continue;
      seats.push({ team: TEAMS[t], livery: l, pilot: TEAMS[t].pilots[l] });
    }
  }
  return seats;
}
