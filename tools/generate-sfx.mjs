#!/usr/bin/env node
// Batch-generate the baked SFX one-shots via the ElevenLabs sound-generation API.
//
// Workflow:
//   1) In the SFX lab (localhost:8741/sfx-lab.html): audition prompts against the
//      in-game synth, EXPORT SFX CONFIG → save the JSON as tools/sfx-config.json
//   2) ELEVEN_API_KEY=sk_...  node tools/generate-sfx.mjs          # generate
//        --dry         print the plan (and character bill), no API calls
//        --force       regenerate everything even if unchanged
//        --only <key>  regenerate ONE sound (a re-roll: same prompt, new take)
//
// Output:
//   assets/sfx/<key>.mp3
//   assets/sfx/manifest.json   ({ key: { prompt, duration_seconds, loop } })
// Idempotent: a clip is skipped when its manifest entry still matches the
// config — editing one prompt and re-running regenerates only that clip.
// The game (src/core/audio.js) reads the manifest and layers these clips on
// top of the procedural synth; a missing file just means synth-only, no error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'sfx');
const CFG = path.join(ROOT, 'tools', 'sfx-config.json');
const KEY = process.env.ELEVEN_API_KEY;
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

if (!fs.existsSync(CFG)) {
  console.error('✗ tools/sfx-config.json missing — EXPORT SFX CONFIG in the lab and save it there.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
if (!DRY && !KEY) {
  console.error('✗ Set ELEVEN_API_KEY (or run with --dry to preview the plan).');
  process.exit(1);
}

const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

const jobs = [];
let skipped = 0;
for (const [key, s] of Object.entries(cfg.sounds)) {
  if (ONLY && key !== ONLY) { skipped++; continue; }
  // curated = Martin hand-picked this take in the lab and dropped the mp3 in
  // assets/sfx/ himself — NEVER regenerate it from a batch run (not even with
  // --force). Only an explicit --only <key> may re-roll a curated sound.
  if (s.curated && !ONLY) { console.log(`● ${key}: curated take — left untouched`); skipped++; continue; }
  const file = path.join(OUT, `${key}.mp3`);
  const up = manifest[key];
  const fresh = up && up.prompt === s.prompt && up.duration_seconds === s.duration_seconds && fs.existsSync(file);
  if (!FORCE && !ONLY && fresh) { skipped++; continue; }
  jobs.push({ key, file, prompt: s.prompt, duration_seconds: s.duration_seconds, loop: !!s.loop });
}

console.log(`Plan: ${jobs.length} clips to generate (${skipped} skipped)  ·  prompt_influence ${cfg.prompt_influence}`);
if (DRY) { for (const j of jobs) console.log(`  ${j.key} (${j.duration_seconds}s)  "${j.prompt.slice(0, 80)}…"`); process.exit(0); }

async function soundGen(job, attempt = 1) {
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: job.prompt, duration_seconds: job.duration_seconds, prompt_influence: cfg.prompt_influence }),
  });
  if (res.status === 429 && attempt <= 4) {
    const wait = attempt * 3000;
    console.log(`  … rate-limited, waiting ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return soundGen(job, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  return Buffer.from(await res.arrayBuffer());
}

let done = 0, failed = 0;
fs.mkdirSync(OUT, { recursive: true });
for (const job of jobs) {
  try {
    const buf = await soundGen(job);
    fs.writeFileSync(job.file, buf);
    manifest[job.key] = { prompt: job.prompt, duration_seconds: job.duration_seconds, loop: job.loop };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); // save as we go — resumable
    done++;
    console.log(`✓ ${job.key}  (${(buf.length / 1024).toFixed(0)}kB, ${job.duration_seconds}s)`);
    await new Promise((r) => setTimeout(r, 350)); // gentle pacing
  } catch (e) {
    failed++;
    console.error(`✗ ${job.key}: ${e.message}`);
  }
}
console.log(`\nDone: ${done} generated, ${skipped} skipped, ${failed} failed.`);
console.log('Output: assets/sfx/ — reload the game and listen; re-roll one with --only <key>.');
