// World 2, track 2: tight technical island-hopper — two true hairpins, ridge
// esses, and a full F-Zero LOOP on the south straight (cp 2-8: a 40m-radius
// circle in the direction of travel, corkscrewed 30m sideways so the exit leg
// clears the entry leg).
export const CORAL_KEYS = {
  id: 'coral-keys',
  name: 'Coral Keys',
  world: 'tropic',
  laps: 3,
  points: [
    { x: -270, y: 4, z: 0, width: 15 },   //  0 start/finish, heading east
    { x: -110, y: 3, z: -10, width: 15 }, //  1 south straight
    { x: -60, y: 3, z: -22, width: 13 },  //  2 LOOP entry (bottom)
    { x: -25, y: 23, z: -17, width: 13 }, //  3 climbing the face
    { x: -25, y: 63, z: -12, width: 13 }, //  4
    { x: -60, y: 83, z: -7, width: 13 },  //  5 the top — sky below you
    { x: -95, y: 63, z: -2, width: 13 },  //  6
    { x: -95, y: 23, z: 3, width: 13 },   //  7
    { x: -60, y: 3, z: 8, width: 13 },    //  8 LOOP exit (bottom, 30m over)
    { x: 55, y: 4, z: 10, width: 14 },    //  9 straight resumes
    { x: 215, y: 5, z: -10, width: 13 },  // 10
    { x: 350, y: 3, z: 30, width: 12 },   // 11 east hairpin entry (dipping)
    { x: 405, y: 2, z: 120, width: 12 },  // 12 hairpin apex in the dip
    { x: 325, y: 6, z: 200, width: 12 },  // 13 exit climbing
    { x: 175, y: 11, z: 230, width: 13 }, // 14 north ridge run
    { x: 40, y: 16, z: 200, width: 12 },  // 15 ridge ess
    { x: -95, y: 18, z: 250, width: 12 }, // 16 ridge ess
    { x: -230, y: 16, z: 220, width: 13 },// 17
    { x: -365, y: 12, z: 250, width: 13 },// 18 west hairpin entry
    { x: -445, y: 8, z: 180, width: 12 }, // 19 apex, diving
    { x: -460, y: 6, z: 80, width: 12 },  // 20
    { x: -380, y: 4, z: 20, width: 13 },  // 21 exit onto the straight
  ],
  boostPads: [
    { cp: 0.6, d: 0 },   // launch
    { cp: 1.1, d: 0 },
    { cp: 1.6, d: 0 },   // carry speed into the loop
    { cp: 10.3, d: 3 },  // outside line before the east hairpin
    { cp: 13.4, d: 0 },  // hairpin exit
    { cp: 16.5, d: 0 },  // ridge esses exit
    { cp: 21.2, d: 0 },  // west hairpin exit
  ],
  features: [
    // Loop (cp 2-8) plus a barrel roll on the long straight after it.
    { type: 'corkscrew', from: 9.3, to: 10.4, turns: 1, dir: -1 },
  ],
};
