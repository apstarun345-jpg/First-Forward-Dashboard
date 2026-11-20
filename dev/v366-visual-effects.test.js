import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

test('✨ Visual Effect 1: Cursor Spotlight & Border Glow Effect (Vercel/Stripe style)', () => {
  const styles = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');

  // CSS contains spotlight variables & radial gradient
  assert.match(styles, /--spot-x:\s*-999px/, 'CSS defines default off-card spotlight X coordinate');
  assert.match(styles, /--spot-y:\s*-999px/, 'CSS defines default off-card spotlight Y coordinate');
  assert.match(styles, /radial-gradient\(\s*420px\s*circle\s*at\s*var\(--spot-x\)\s*var\(--spot-y\)/, 'Card background incorporates cursor radial spotlight');
  assert.match(styles, /\.card:hover,\s*\.kpi:hover/, 'Card and KPI hover triggers border glow');

  // app.js contains spotlight cursor tracking
  assert.match(appJs, /function initSpotlight\(\)/, 'app.js defines initSpotlight helper');
  assert.match(appJs, /--spot-x/, 'pointer listener updates --spot-x property');
  assert.match(appJs, /--spot-y/, 'pointer listener updates --spot-y property');
});

test('🌌 Visual Effect 2: Aurora Ambient Mesh Glow behind Hero & Topbar (with Mac 0-animation compatibility)', () => {
  const styles = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

  assert.match(styles, /\.home-hero::after,\s*\.home-hero\.v2::after\s*\{[^}]*radial-gradient/, 'Home hero has glowing ambient mesh aura');
  assert.match(styles, /\.topbar::after\s*\{[^}]*radial-gradient/, 'Topbar has ambient mesh glow');
  assert.match(styles, /@keyframes auroraMeshPulse/, 'Aurora pulsing animation defined');

  // Mac reduced motion / 0 animation safeguard: mesh glow MUST NOT disappear
  assert.match(styles, /\.home-hero::after,\s*\.home-hero\.v2::after\s*\{[^}]*opacity:\s*0\.82\s*!important/, 'Aurora mesh stays visible at high opacity on Mac');
  assert.match(styles, /\.home-hero::after,\s*\.home-hero\.v2::after\s*\{[^}]*animation:\s*none\s*!important/, 'Animation freezes cleanly without stuttering');
});

test('🔢 Visual Effect 3: Animated Odometer Number Ticker for metric counters', () => {
  const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

  assert.match(appJs, /function runOdometerCounters\(root\)/, 'app.js defines runOdometerCounters');
  assert.match(appJs, /function observeOdometer/, 'app.js defines observeOdometer for dynamic DOM updates');
  assert.match(appJs, /FF\.runOdometerCounters = runOdometerCounters/, 'Exposes runOdometerCounters on FF namespace');
  assert.match(styles, /tabular-nums/, 'KPI values use tabular-nums for aligned rolling ticker');
});

test('🛸 Visual Effect 4: Smart Command Wheel / Quick-HUD Orbit Menu around Gems Robot mascot', () => {
  const mascotJs = fs.readFileSync(path.join(rootDir, 'mascot.js'), 'utf8');
  const styles = fs.readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

  // Mascot DOM has orbit HUD container & buttons
  assert.match(mascotJs, /class="mc-orbit-hud"/, 'Mascot HTML has mc-orbit-hud element');
  assert.match(mascotJs, /data-hud="ask"/, 'HUD contains Ask AI button');
  assert.match(mascotJs, /data-hud="stock"/, 'HUD contains Stock button');
  assert.match(mascotJs, /data-hud="analytics"/, 'HUD contains Analytics button');
  assert.match(mascotJs, /data-hud="mapping"/, 'HUD contains Mapping button');
  assert.match(mascotJs, /data-hud="notif"/, 'HUD contains Alerts/Notification button');
  assert.match(mascotJs, /class="mc-hud-toggle"/, 'Mascot has mini HUD trigger toggle');

  // Adaptive geometry and interaction functions
  assert.match(mascotJs, /function updateHudOrbit\(\)/, 'mascot.js defines updateHudOrbit for adaptive fan angles');
  assert.match(mascotJs, /function toggleHud\(\)/, 'mascot.js defines toggleHud');
  assert.match(mascotJs, /function handleHudAction\(act\)/, 'mascot.js handles HUD action routing');

  // CSS styling & reduced-motion compatibility
  assert.match(styles, /\.mc-orbit-hud\s*\{/, 'styles.css styles mc-orbit-hud');
  assert.match(styles, /\.mc-hud-btn\s*\{/, 'styles.css styles mc-hud-btn');
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.mc-orbit-hud/, 'Reduced motion ensures orbit HUD is immediately visible on Mac');
});

test('👑 VIP Themes: Obsidian Gold and Cyber Neon', () => {
  const themePacksJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'theme-packs.json'), 'utf8'));
  const themesCss = fs.readFileSync(path.join(rootDir, 'themes.css'), 'utf8');
  const uiBootJs = fs.readFileSync(path.join(rootDir, 'ui-boot.js'), 'utf8');
  const wowzoneJs = fs.readFileSync(path.join(rootDir, 'wowzone.js'), 'utf8');

  // Obsidian Gold in theme-packs.json
  assert.ok(themePacksJson.obsidian, 'theme-packs.json includes obsidian pack');
  assert.equal(themePacksJson.obsidian.name, 'Obsidian Gold');
  assert.equal(themePacksJson.obsidian.mode, 'dark');

  // Cyber Neon in theme-packs.json
  assert.ok(themePacksJson.cyber, 'theme-packs.json includes cyber pack');
  assert.equal(themePacksJson.cyber.name, 'Cyber Neon');
  assert.equal(themePacksJson.cyber.mode, 'dark');

  // CSS definitions
  assert.match(themesCss, /html\[data-theme-pack="obsidian"\]/, 'themes.css has obsidian pack rules');
  assert.match(themesCss, /html\[data-theme-pack="cyber"\]/, 'themes.css has cyber pack rules');

  // ui-boot registration
  assert.match(uiBootJs, /obsidian:\s*'dark'/, 'ui-boot knows obsidian is dark mode');
  assert.match(uiBootJs, /cyber:\s*'dark'/, 'ui-boot knows cyber is dark mode');

  // wowzone UI picker
  assert.match(wowzoneJs, /obsidian:\s*\{/, 'wowzone.js lists obsidian pack');
  assert.match(wowzoneJs, /cyber:\s*\{/, 'wowzone.js lists cyber pack');
});
