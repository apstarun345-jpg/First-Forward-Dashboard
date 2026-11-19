/* 🤖 Test for Gems Robot UI upgrades: thought bubble, mood glow aura, voice waveform visualizer & smart context questions */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('robot UI: thought bubble, halo aura, fluid waveform & smart context pills present', async () => {
  const mascotCode = await fs.readFile(path.join(ROOT, 'mascot.js'), 'utf8');
  const stylesCode = await fs.readFile(path.join(ROOT, 'styles.css'), 'utf8');

  // 1. Thought Bubble
  assert.ok(mascotCode.includes('mc-bubble'), 'mc-bubble element present in mascot.js');
  assert.ok(mascotCode.includes('showBubble'), 'showBubble helper present in mascot.js');
  assert.ok(mascotCode.includes('hideBubble'), 'hideBubble helper present in mascot.js');
  assert.ok(stylesCode.includes('.mc-bubble'), '.mc-bubble styles defined in styles.css');
  assert.ok(stylesCode.includes('.mc-bubble-tail'), '.mc-bubble-tail styles defined in styles.css');

  // 2. Halo Mood Glow Aura
  assert.ok(mascotCode.includes('mc-halo'), 'mc-halo element present in mascot.js');
  assert.ok(stylesCode.includes('.mc-halo'), '.mc-halo styles defined in styles.css');
  assert.ok(stylesCode.includes('mcHaloPulse'), 'mcHaloPulse animation defined in styles.css');

  // 3. Fluid Siri / Gemini Voice Waveform Visualizer
  assert.ok(mascotCode.includes('gv-wave-wrap'), 'gv-wave-wrap present in mascot.js');
  assert.ok(mascotCode.includes('gv-wave'), 'gv-wave present in mascot.js');
  assert.ok(mascotCode.includes('gvWaveBounce'), 'gvWaveBounce animation defined in mascot.js GV_CSS');

  // 4. Page-Aware Smart Question Chips
  assert.ok(mascotCode.includes('pageSmartQuestions'), 'pageSmartQuestions function present in mascot.js');
  assert.ok(mascotCode.includes('mc-smart-pills'), 'mc-smart-pills element present in mascot.js');
  assert.ok(mascotCode.includes('mc-chip-pill'), 'mc-chip-pill class present in mascot.js');
  assert.ok(stylesCode.includes('.mc-smart-pills'), '.mc-smart-pills styles defined in styles.css');

  // 5. Mobile Bottom Sheet Styling
  assert.ok(stylesCode.includes('.mc-sheet-pill'), '.mc-sheet-pill styles defined in styles.css');
  assert.ok(stylesCode.includes('mcSheetUp'), 'mcSheetUp animation defined in styles.css');
});
