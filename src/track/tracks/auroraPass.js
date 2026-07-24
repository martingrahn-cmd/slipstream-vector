// World 4 (FROSTFALL RIDGE), track 1: start flat-out across a frozen lake,
// switchback climb to the ridge crest, a split around the ice monolith at the
// summit, a crevasse jump on the descent shoulder, then a corkscrew down the
// glacier and an ice chicane back onto the lake. High-speed and exposed up
// top, committed and technical on the way down.
export const AURORA_PASS = {
  id: 'aurora-pass',
  name: 'Aurora Pass',
  world: 'frost',
  laps: 3,
  points: [
    { x: 0, y: 2, z: 300, width: 16 },     //  0 start/finish on the lake ice
    { x: 0, y: 2, z: 150, width: 15 },     //  1 | lake straight (boost chain)
    { x: 5, y: 2, z: 0, width: 15 },       //  2 | flat out
    { x: 20, y: 3, z: -150, width: 14 },   //  3 lake shore — the lift begins
    { x: 80, y: 8, z: -260, width: 12 },   //  4 first climb ramp
    { x: 170, y: 14, z: -320, width: 9 },  //  5 switchback 1 — PINCH
    { x: 260, y: 20, z: -280, width: 9 },  //  6 switchback 2 — PINCH
    { x: 320, y: 26, z: -190, width: 12 }, //  7 climbing shoulder
    { x: 360, y: 32, z: -80, width: 14 },  //  8 ridge gain — opens up
    { x: 380, y: 34, z: 40, width: 16 },   //  9 THE CREST — fast and exposed
    { x: 390, y: 34, z: 170, width: 19 },  // 10 split around the ice monolith
    { x: 380, y: 33, z: 300, width: 19 },  // 11 lanes run the crest in parallel
    { x: 350, y: 32, z: 410, width: 15 },  // 12 merge — crest end
    { x: 290, y: 30, z: 480, width: 12 },  // 13 summit corner
    { x: 200, y: 28, z: 510, width: 11 },  // 14 descent begins (jump ahead)
    { x: 110, y: 24, z: 490, width: 13 },  // 15 descent shoulder — CREVASSE
    { x: 40, y: 18, z: 430, width: 14 },   // 16 landing run
    { x: -60, y: 14, z: 400, width: 10 },  // 17 glacier sweeper — tightens
    { x: -160, y: 10, z: 430, width: 12 }, // 18 glacier field
    { x: -260, y: 8, z: 390, width: 14 },  // 19 wide glacier run (corkscrew)
    { x: -320, y: 6, z: 290, width: 15 },  // 20 rolling down the tongue
    { x: -330, y: 4, z: 170, width: 13 },  // 21 rollout
    { x: -290, y: 3, z: 60, width: 8 },    // 22 ice chicane left — PINCH
    { x: -220, y: 2, z: -10, width: 8 },   // 23 ice chicane right — PINCH
    { x: -150, y: 2, z: 60, width: 12 },   // 24 back toward the lake
    { x: -135, y: 2, z: 230, width: 14 },  // 25 onto the ice, climbing past the line
    { x: -95, y: 2, z: 375, width: 15 },   // 26 wide arc north of it
    { x: -35, y: 2, z: 405, width: 16 },   // 27 monotonic fall onto the grid
  ],
  boostPads: [
    { cp: 0.6, d: 4 },    // lake risk line: a chain by the right wall
    { cp: 1.2, d: 4 },
    { cp: 1.8, d: 4 },
    { cp: 8.2, d: 0 },    // ridge gain
    { cp: 9.6, d: -8 },   // SPLIT fast lane: pads down the west side
    { cp: 10.4, d: -8 },
    { cp: 11.2, d: -8 },
    { cp: 13.6, d: 0 },   // descent entry
    { cp: 16.5, d: 0 },   // landing run
    { cp: 21.4, d: 0 },   // glacier rollout
    { cp: 23.5, d: 0 },   // chicane exit
    { cp: 25.6, d: 3 },   // run home, near the right wall
  ],
  weaponPads: [
    { cp: 2.5, d: -3 },
    { cp: 7.6, d: 3 },
    { cp: 12.4, d: -3 },
    { cp: 17.5, d: 3 },
    { cp: 24.6, d: -3 },
  ],
  splits: [
    // The ice monolith on the crest: west (left) is shorter + boosted but
    // walled by the island; east is the open safe line with the view.
    { from: 9.3, to: 11.7, gap: 4.5, fast: -1 },
  ],
  features: [
    // The crevasse: a jump where the descent shoulder drops away.
    { type: 'jump', cp: 14.6, gap: 20, lift: 10 },
    // A corkscrew down the glacier tongue on the way home.
    { type: 'corkscrew', from: 19.0, to: 20.4, turns: 1, dir: 1 },
  ],
};
