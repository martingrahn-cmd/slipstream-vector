// The track roster, in menu order: 3 worlds x 2 tracks.
import { SUNSET_CIRCUIT } from './sunsetCircuit.js';
import { MESA_RUN } from './mesaRun.js';
import { LAGOON_PASS } from './lagoonPass.js';
import { CORAL_KEYS } from './coralKeys.js';
import { ORBITAL_RING } from './orbitalRing.js';
import { SKYLINE_RUSH } from './skylineRush.js';
import { AURORA_PASS } from './auroraPass.js';

export const TRACKS = [
  SUNSET_CIRCUIT,
  MESA_RUN,
  LAGOON_PASS,
  CORAL_KEYS,
  ORBITAL_RING,
  SKYLINE_RUSH,
  AURORA_PASS, // TEMP preview registration — remove before deploy (cup = TRACKS.length rounds)
];
