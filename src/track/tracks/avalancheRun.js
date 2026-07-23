// World 4 (FROSTFALL RIDGE), track 2: the gorge. Start on a high shelf, tip
// down through narrowing esses into a frozen basin — where the world's LOOP
// lives — then climb the cut past a split around a frozen pillar, jump the
// icefall shelf and commit to the valley-head hairpin before the run home.
// Twistier and more claustrophobic than Aurora Pass's exposed ridge. (The
// distant-avalanche set-piece will live on this track — hence the name.)
export const AVALANCHE_RUN = {
  id: 'avalanche-run',
  name: 'Avalanche Run',
  world: 'frost',
  laps: 3,
  points: [
    { x: 0, y: 14, z: 260, width: 15 },    //  0 start/finish on the high shelf
    { x: 0, y: 13, z: 120, width: 14 },    //  1 | shelf straight (boost chain)
    { x: 10, y: 12, z: -20, width: 15 },   //  2 | carrying speed
    { x: 40, y: 10, z: -150, width: 12 },  //  3 tipping into the gorge
    { x: 110, y: 7, z: -250, width: 10 },  //  4 gorge esses — narrows
    { x: 200, y: 5, z: -300, width: 9 },   //  5 esses apex — PINCH
    { x: 300, y: 3, z: -310, width: 10 },  //  6 esses exit
    { x: 390, y: 2, z: -250, width: 13 },  //  7 gorge mouth — the basin opens
    { x: 440, y: 2, z: -130, width: 15 },  //  8 basin straight (LOOP entry — keep room)
    { x: 450, y: 2, z: 10, width: 15 },    //  9 | flat out on the ice
    { x: 430, y: 2, z: 150, width: 14 },   // 10 basin end
    { x: 370, y: 3, z: 260, width: 16 },   // 11 wide sweeper into the cut
    { x: 290, y: 5, z: 340, width: 19 },   // 12 SPLIT around the frozen pillar
    { x: 190, y: 7, z: 380, width: 19 },   // 13 lanes run the cut in parallel
    { x: 90, y: 9, z: 390, width: 15 },    // 14 merge
    { x: 0, y: 11, z: 380, width: 12 },    // 15 climbing the cut
    { x: -100, y: 14, z: 350, width: 11 }, // 16 icefall shelf — JUMP ahead
    { x: -190, y: 16, z: 290, width: 13 }, // 17 flying the icefall gap
    { x: -260, y: 17, z: 200, width: 13 }, // 18 landing run
    { x: -300, y: 17, z: 90, width: 10 },  // 19 valley-head sweeper
    { x: -310, y: 16, z: -30, width: 8 },  // 20 hairpin entry — PINCH
    { x: -260, y: 15, z: -110, width: 6 }, // 21 hairpin apex — TIGHT (the commit)
    { x: -180, y: 14, z: -80, width: 8 },  // 22 hairpin exit
    { x: -140, y: 14, z: 20, width: 11 },  // 23 ridge back
    { x: -120, y: 14, z: 130, width: 13 }, // 24 run home begins
    { x: -75, y: 14, z: 210, width: 15 },  // 25 wide
    { x: -35, y: 14, z: 245, width: 16 },  // 26 final approach
  ],
  boostPads: [
    { cp: 0.5, d: -4 },   // shelf risk line by the left wall
    { cp: 1.1, d: -4 },
    { cp: 1.7, d: -4 },
    { cp: 6.5, d: 0 },    // esses exit
    { cp: 7.8, d: 3 },    // basin entry — feed the loop
    { cp: 9.5, d: 0 },    // loop exit, back up to speed
    { cp: 11.8, d: -8 },  // SPLIT fast lane through the cut
    { cp: 12.5, d: -8 },
    { cp: 13.2, d: -8 },
    { cp: 15.3, d: 0 },   // the climb
    { cp: 18.4, d: 0 },   // icefall landing
    { cp: 22.4, d: 0 },   // hairpin exit
    { cp: 24.8, d: -3 },  // run home
  ],
  weaponPads: [
    { cp: 2.3, d: 3 },
    { cp: 9.0, d: -3 },
    { cp: 14.5, d: 3 },
    { cp: 19.2, d: -3 },
    { cp: 23.8, d: 3 },
  ],
  splits: [
    // The frozen pillar in the cut: the inside line is shorter + boosted but
    // walled; outside is open with the view down the gorge.
    { from: 11.5, to: 13.6, gap: 4.5, fast: -1 },
  ],
  features: [
    // The world's LOOP, on the frozen basin's long straight.
    { type: 'loop', cp: 8, dir: 1 },
    // The icefall: a jump where the shelf breaks away.
    { type: 'jump', cp: 16.5, gap: 20, lift: 10 },
  ],
};
