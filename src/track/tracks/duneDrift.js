// World 1 (Sunset Mesa), track 3: the SPEEDWAY. Wide banked sweeps, two long
// fork straights and only one real chicane — the pack stays glued together
// and the race is a slipstream war. A jump off the dune ridge and a corkscrew
// on the western sweep keep the lap honest. Contrast: Sunset Circuit flows,
// Mesa Run twists — Dune Drift is pure pace.
export const DUNE_DRIFT = {
  id: 'dune-drift',
  name: 'Dune Drift',
  world: 'desert',
  laps: 3,
  points: [
    { x: 0, y: 2, z: 340, width: 18 },     //  0 start/finish
    { x: 0, y: 2, z: 180, width: 18 },     //  1 | front straight (chain)
    { x: 0, y: 3, z: 20, width: 20 },      //  2 | widest point — four abreast
    { x: 10, y: 4, z: -140, width: 18 },   //  3 |
    { x: 60, y: 6, z: -280, width: 17 },   //  4 turn 1 sweeps in
    { x: 170, y: 8, z: -360, width: 16 },  //  5 apex 1 — banked
    { x: 300, y: 9, z: -370, width: 16 },  //  6 exit
    { x: 410, y: 8, z: -310, width: 17 },  //  7 short chute
    { x: 470, y: 6, z: -190, width: 18 },  //  8 turn 2 sweep
    { x: 480, y: 4, z: -60, width: 19 },   //  9 back straight — SPLIT 1
    { x: 470, y: 3, z: 80, width: 19 },    // 10 fork around the rock outcrop
    { x: 440, y: 3, z: 210, width: 18 },   // 11 merge
    { x: 390, y: 4, z: 320, width: 16 },   // 12 turn 3 entry
    { x: 290, y: 6, z: 390, width: 14 },   // 13 the only chicane complex
    { x: 200, y: 7, z: 360, width: 9 },    // 14 chicane L — PINCH
    { x: 130, y: 8, z: 400, width: 9 },    // 15 chicane R — PINCH
    { x: 40, y: 9, z: 420, width: 14 },    // 16 exit — the dune ridge ahead
    { x: -70, y: 10, z: 400, width: 15 },  // 17 JUMP off the ridge
    { x: -180, y: 8, z: 360, width: 16 },  // 18 landing
    { x: -280, y: 6, z: 290, width: 16 },  // 19 turn 4 sweep (corkscrew)
    { x: -350, y: 5, z: 180, width: 17 },  // 20 rolling through
    { x: -370, y: 4, z: 60, width: 17 },   // 21 rollout
    { x: -350, y: 3, z: -60, width: 18 },  // 22 lower sweep back
    { x: -280, y: 2, z: -140, width: 18 }, // 23 SPLIT 2 — the desert fork
    { x: -180, y: 2, z: -160, width: 19 }, // 24 fork straight
    { x: -90, y: 2, z: -100, width: 18 },  // 25 merge, curving home
    { x: -80, y: 2, z: 60, width: 17 },    // 26 running north WEST of the straight
    { x: -60, y: 2, z: 220, width: 17 },   // 27 |
    { x: -25, y: 2, z: 400, width: 18 },   // 28 overshoot — sweep down onto the line
  ],
  boostPads: [
    { cp: 1.2, d: -4 },   // front-straight chain by the left wall
    { cp: 1.7, d: -4 },
    { cp: 2.2, d: -4 },
    { cp: 9.3, d: 8 },    // SPLIT 1 fast lane
    { cp: 10.0, d: 8 },
    { cp: 10.7, d: 8 },
    { cp: 15.5, d: 0 },   // chicane exit
    { cp: 18.3, d: 0 },   // ridge landing
    { cp: 21.3, d: 0 },   // corkscrew rollout
    { cp: 23.2, d: -8 },  // SPLIT 2 fast lane
    { cp: 23.9, d: -8 },
    { cp: 27.5, d: 0 },   // run home
  ],
  weaponPads: [
    { cp: 3.3, d: 3 },
    { cp: 7.5, d: -3 },
    { cp: 12.5, d: 3 },
    { cp: 18.8, d: -3 },
    { cp: 27.2, d: 3 },
  ],
  splits: [
    { from: 8.8, to: 11.2, gap: 4.5, fast: 1 },   // back-straight rock outcrop
    { from: 22.8, to: 25.2, gap: 4.0, fast: -1 }, // the desert fork on the low side
  ],
  features: [
    { type: 'jump', cp: 16.6, gap: 24, lift: 11 },
    { type: 'corkscrew', from: 19.2, to: 20.6, turns: 1, dir: 1 },
  ],
};
