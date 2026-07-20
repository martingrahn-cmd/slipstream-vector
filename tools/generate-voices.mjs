#!/usr/bin/env node
// Batch-generate the rival-banter voice clips via the ElevenLabs API.
//
// Workflow:
//   1) In the voice lab (localhost:8741/pilot-expression-lab.html): CONNECT with
//      your API key, assign a voice per driver, audition, EXPORT VOICE CONFIG →
//      save the JSON as tools/voice-config.json
//   2) ELEVEN_API_KEY=sk_...  node tools/generate-voices.mjs        # generate
//        --dry    print what would be generated (and the character bill), no calls
//        --force  regenerate everything even if unchanged
//
// Reads the ONE source of truth for lines (src/ui/banter.js LINES) so the audio
// always matches what the in-game feed shows. Output:
//   assets/voice/<slug>/<bucket>-<i>.mp3
//   assets/voice/manifest.json   ({ "slug/bucket-i": "line text", ... })
// Idempotent: a clip is skipped when its manifest text still matches — editing
// one line and re-running regenerates only that clip.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES } from '../src/ui/banter.js';
import { pilotSlug } from '../src/worlds/teams.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'voice');
const CFG = path.join(ROOT, 'tools', 'voice-config.json');
const KEY = process.env.ELEVEN_API_KEY;
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

if (!fs.existsSync(CFG)) {
  console.error('✗ tools/voice-config.json missing — EXPORT VOICE CONFIG in the lab and save it there.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
if (!DRY && !KEY) {
  console.error('✗ Set ELEVEN_API_KEY (or run with --dry to preview the plan).');
  process.exit(1);
}

const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

// Build the work list from the game's line bank.
const jobs = [];
let chars = 0, skipped = 0;
for (const [pilot, buckets] of Object.entries(LINES)) {
  const voice = cfg.voices && cfg.voices[pilot];
  if (!voice || !voice.voice_id) { console.warn(`⚠ no voice for ${pilot} — skipping their ${Object.values(buckets).flat().length} lines`); continue; }
  const slug = pilotSlug(pilot);
  for (const [bucket, lines] of Object.entries(buckets)) {
    lines.forEach((text, i) => {
      const key = `${slug}/${bucket}-${i}`;
      const file = path.join(OUT, slug, `${bucket}-${i}.mp3`);
      if (!FORCE && manifest[key] === text && fs.existsSync(file)) { skipped++; return; }
      // Per-pilot voice_settings override the global default (excitable rivals
      // run looser/more expressive; the stoic ones stay composed).
      jobs.push({ pilot, slug, bucket, i, text, key, file, voice_id: voice.voice_id, settings: voice.voice_settings || cfg.voice_settings });
      chars += text.length;
    });
  }
}

console.log(`Plan: ${jobs.length} clips to generate (${skipped} up-to-date, ~${chars} characters billed)`);
console.log(`Model: ${cfg.model_id}  ·  settings: ${JSON.stringify(cfg.voice_settings)}`);
if (DRY) { for (const j of jobs) console.log(`  ${j.key}  "${j.text}"`); process.exit(0); }

async function tts(job, attempt = 1) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${job.voice_id}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: job.text, model_id: cfg.model_id, voice_settings: job.settings }),
  });
  if (res.status === 429 && attempt <= 4) {
    const wait = attempt * 3000;
    console.log(`  … rate-limited, waiting ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return tts(job, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  return Buffer.from(await res.arrayBuffer());
}

let done = 0, failed = 0;
for (const job of jobs) {
  try {
    fs.mkdirSync(path.dirname(job.file), { recursive: true });
    const buf = await tts(job);
    fs.writeFileSync(job.file, buf);
    manifest[job.key] = job.text;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); // save as we go — resumable
    done++;
    console.log(`✓ ${job.key}  (${(buf.length / 1024).toFixed(0)}kB)  "${job.text}"`);
    await new Promise((r) => setTimeout(r, 350)); // gentle pacing
  } catch (e) {
    failed++;
    console.error(`✗ ${job.key}: ${e.message}`);
  }
}
console.log(`\nDone: ${done} generated, ${skipped} skipped, ${failed} failed.`);
console.log(`Output: assets/voice/  — commit when happy (same policy as music/videos).`);
