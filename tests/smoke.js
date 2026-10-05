/**
 * REL WORLD smoke test.
 *
 *   npm install --no-save playwright   (once)
 *   node tests/smoke.js
 *
 * Serves the repo over HTTP, then drives the real game in Chromium:
 *  - every one of the 100 generated floors is completable
 *  - floors are deterministic
 *  - keyboard input, pause, win, loss and persistence all behave
 * Exits non-zero if anything fails.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) failures.push(name);
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(base + '/index.html');
  await page.waitForFunction(() => !!window.RelWorld);

  /* ---- 1. every generated floor must be completable ---- */
  const audit = await page.evaluate(() => {
    const { buildFloor, reachableFrom, TILE, isDesk, FLOORS } = window.RelWorld;
    const problems = [];
    let minTime = Infinity, maxTime = 0;
    for (let i = 0; i < FLOORS; i++) {
      const f = buildFloor(i), m = f.map;
      const startTile = m[f.start.y][f.start.x];
      if (startTile === TILE.WALL || isDesk(startTile)) problems.push(`L${i + 1}: start inside a wall/desk`);
      const seen = reachableFrom(m, f.start.x, f.start.y);
      if (!seen[1][18]) problems.push(`L${i + 1}: goal unreachable`);

      let gpus = 0, desks = 0, coins = 0, keys = 0, doors = 0;
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
        const t = m[y][x];
        if (t === TILE.GPU) { gpus++; if (!seen[y][x]) problems.push(`L${i + 1}: GPU walled off`); }
        else if (t === TILE.COIN) { coins++; if (!seen[y][x]) problems.push(`L${i + 1}: coin walled off`); }
        else if (t === TILE.KEY) { keys++; if (!seen[y][x]) problems.push(`L${i + 1}: key walled off`); }
        else if (t === TILE.MKEY && !seen[y][x]) problems.push(`L${i + 1}: master key walled off`);
        else if (t === TILE.DOOR) doors++;
        if (isDesk(t)) {
          desks++;
          const ok = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => seen[y + dy] && seen[y + dy][x + dx]);
          if (!ok) problems.push(`L${i + 1}: desk unreachable`);
        }
      }
      if (desks !== f.desks) problems.push(`L${i + 1}: desk count mismatch`);
      if (f.type === 0 && gpus < desks) problems.push(`L${i + 1}: only ${gpus} GPUs for ${desks} desks`);
      if (f.type === 1 && coins < f.coinQuota) problems.push(`L${i + 1}: coin quota above supply`);
      if (keys < doors) problems.push(`L${i + 1}: ${keys} keys for ${doors} locked doors`);
      if (!f.spawns.length) problems.push(`L${i + 1}: nowhere to spawn a rival`);
      for (const sp of f.spawns.slice(0, 2)) {
        if (m[sp.y][sp.x] === TILE.WALL || isDesk(m[sp.y][sp.x])) problems.push(`L${i + 1}: rival spawn blocked`);
      }
      minTime = Math.min(minTime, f.time); maxTime = Math.max(maxTime, f.time);
    }
    const deterministic = JSON.stringify(buildFloor(42).map) === JSON.stringify(buildFloor(42).map);
    return { problems: [...new Set(problems)], minTime, maxTime, deterministic };
  });
  check('all 100 floors are completable', audit.problems.length === 0, audit.problems.slice(0, 5).join('; '));
  check('floor generation is deterministic', audit.deterministic);
  check('time budget varies per floor', audit.maxTime - audit.minTime > 30, `${audit.minTime}-${audit.maxTime}s`);

  /* ---- 2. play floor 1 from the menu to the clear screen ---- */
  await page.click('#btnNewCareer');
  await page.waitForSelector('#briefingScreen:not([hidden])');
  await page.click('#btnGo');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.RelWorld.state.state === 'playing', { timeout: 9000 });

  const before = await page.evaluate(() => ({ ...window.RelWorld.state.player }));
  for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft']) { await page.keyboard.press(k); await page.waitForTimeout(140); }
  const after = await page.evaluate(() => ({ ...window.RelWorld.state.player }));
  check('a tapped arrow key moves the player', before.x !== after.x || before.y !== after.y);

  await page.keyboard.press('KeyP');
  await page.waitForSelector('#pauseScreen:not([hidden])');
  const t0 = await page.evaluate(() => window.RelWorld.state.timeLeft);
  await page.waitForTimeout(600);
  const t1 = await page.evaluate(() => window.RelWorld.state.timeLeft);
  check('pause freezes the clock', t0 === t1);
  await page.click('#btnResume');

  await page.evaluate(() => {
    const s = window.RelWorld.state;
    s.slaps = s.floor.desks; s.gpusGiven = s.floor.desks;
    s.keys = 9; s.masterKey = true; s.timeLeft = 400;
  });
  const walk = await page.evaluate(async () => {
    const { state: s, TILE, isDesk } = window.RelWorld;
    const W = 20, H = 20, D = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const code = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' };
    for (let n = 0; n < 300; n++) {
      if (s.state !== 'playing') return { reached: true, steps: n };
      const dist = Array.from({ length: H }, () => new Array(W).fill(Infinity));
      const q = [[18, 1]]; dist[1][18] = 0;
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h];
        for (const [dx, dy] of D) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || dist[ny][nx] !== Infinity) continue;
          if (s.map[ny][nx] === TILE.WALL || isDesk(s.map[ny][nx])) continue;
          dist[ny][nx] = dist[y][x] + 1; q.push([nx, ny]);
        }
      }
      let best = null, bd = dist[s.player.y][s.player.x];
      for (const [dx, dy] of D) {
        const nx = s.player.x + dx, ny = s.player.y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && dist[ny][nx] < bd) { bd = dist[ny][nx]; best = [dx, dy]; }
      }
      if (!best) return { reached: false, reason: 'stuck' };
      const c = code[best[0] + ',' + best[1]];
      window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c }));
      await new Promise(r => setTimeout(r, 55));
    }
    return { reached: false, reason: 'out of steps' };
  });
  check('player can walk to the goal and clear the floor', walk.reached, JSON.stringify(walk));
  await page.waitForSelector('#clearScreen:not([hidden])', { timeout: 6000 }).then(
    () => check('clear screen is shown', true), () => check('clear screen is shown', false));
  check('progress is persisted', (await page.evaluate(() => localStorage.getItem('rel_unlocked'))) === '1');

  /* ---- 3. losing keeps the page alive (no location.reload) ---- */
  await page.click('#btnNext');
  await page.click('#btnGo');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.RelWorld.state.state === 'playing', { timeout: 9000 });
  await page.evaluate(() => { window.RelWorld.state.timeLeft = 0.2; });
  await page.waitForSelector('#overScreen:not([hidden])', { timeout: 5000 }).then(
    () => check('running out of time shows a game-over screen', true),
    () => check('running out of time shows a game-over screen', false));

  /* ---- 4. race floors and the strike system ---- */
  await page.evaluate(() => localStorage.setItem('rel_unlocked', '5'));
  await page.reload();
  await page.waitForFunction(() => !!window.RelWorld);
  await page.evaluate(() => document.querySelectorAll('#levelSelectCont .level-btn')[2].click());
  await page.click('#btnGo');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.RelWorld.state.state === 'playing', { timeout: 9000 });

  const faceRival = () => page.evaluate(() => {
    const s = window.RelWorld.state;
    s.player.x = 8; s.player.y = 9;
    s.rivals[0].x = 8; s.rivals[0].y = 8;
    s.rivals[0].stun = 60000; s.player.invuln = 60000;
  });
  await faceRival();
  await page.keyboard.press('Space'); await page.waitForTimeout(150);
  check('boss slap before the desks are done does NOT start the race',
    (await page.evaluate(() => window.RelWorld.state.chadSlapped)) === false);

  await page.evaluate(() => { const s = window.RelWorld.state; s.slaps = s.floor.desks; });
  await faceRival();
  await page.keyboard.press('Space'); await page.waitForTimeout(150);
  check('boss slap after the desks are done starts the race',
    (await page.evaluate(() => window.RelWorld.state.chadSlapped)) === true);

  const caught = await page.evaluate(async () => {
    const s = window.RelWorld.state;
    s.chadSlapped = false; s.rivals[0].state = 'roam';
    s.rivals[0].stun = 0; s.player.invuln = 0;
    s.rivals[0].x = s.player.x; s.rivals[0].y = s.player.y;
    await new Promise(r => setTimeout(r, 400));
    return { strikes: s.strikes, state: s.state };
  });
  check('being caught costs one strike, not the run', caught.strikes === 1 && caught.state === 'playing', JSON.stringify(caught));

  await page.evaluate(async () => {
    const s = window.RelWorld.state;
    for (let i = 0; i < 3; i++) {
      s.player.invuln = 0; s.rivals[0].stun = 0;
      s.rivals[0].x = s.player.x; s.rivals[0].y = s.player.y;
      await new Promise(r => setTimeout(r, 350));
    }
  });
  await page.waitForSelector('#overScreen:not([hidden])', { timeout: 4000 }).then(
    () => check('three strikes ends the run', true), () => check('three strikes ends the run', false));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
