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
    const goalSpots = new Set();
    const mazeSigs = new Set();
    let minTime = Infinity, maxTime = 0, withScreens = 0;
    for (let i = 0; i < FLOORS; i++) {
      const f = buildFloor(i), m = f.map;
      const startTile = m[f.start.y][f.start.x];
      if (startTile === TILE.WALL || isDesk(startTile)) problems.push(`L${i + 1}: start inside a wall/desk`);
      const seen = reachableFrom(m, f.start.x, f.start.y);
      if (!seen[f.goal.y][f.goal.x]) problems.push(`L${i + 1}: goal unreachable`);
      goalSpots.add(f.goal.x + ',' + f.goal.y);
      const goalTile = m[f.goal.y][f.goal.x];
      if (goalTile !== TILE.ELEVATOR && goalTile !== TILE.MEETING && goalTile !== TILE.HR) {
        problems.push(`L${i + 1}: goal tile not stamped`);
      }
      if (!f.tag) problems.push(`L${i + 1}: no destination name`);

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
      mazeSigs.add(m.map(row => row.map(c => (c === TILE.WALL ? 1 : 0)).join('')).join(''));
      if (f.screens && f.screens.length) withScreens++;
      const sc = (window.RelWorld.LEVELS[i] || {}).scene;
      if (sc === 'cinema' && (!f.screens || !f.screens.length)) problems.push(`L${i + 1}: cinema floor has no screen`);
    }
    const deterministic = JSON.stringify(buildFloor(42).map) === JSON.stringify(buildFloor(42).map);
    return { problems: [...new Set(problems)], minTime, maxTime, deterministic,
             goalSpots: goalSpots.size, distinctMazes: mazeSigs.size, withScreens };
  });
  check('all 100 floors are completable', audit.problems.length === 0, audit.problems.slice(0, 5).join('; '));
  check('each floor has a distinct maze (no repeating layout)', audit.distinctMazes >= 98,
    `${audit.distinctMazes}/100 distinct wall layouts`);
  check('themed set pieces (screens) appear across floors', audit.withScreens >= 40,
    `${audit.withScreens} floors have a screen/set piece`);
  check('floor generation is deterministic', audit.deterministic);
  check('time budget varies per floor', audit.maxTime - audit.minTime > 30, `${audit.minTime}-${audit.maxTime}s`);
  check('the exit is not always in the same place', audit.goalSpots > 8, `${audit.goalSpots} distinct exits`);

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
      const g = s.floor.goal;
      const q = [[g.x, g.y]]; dist[g.y][g.x] = 0;
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

  const quote = await page.evaluate(() => {
    const Q = window.RelWorld.QUOTES;
    const bad = Q.filter(q => !q.t || !q.who || !(q.year >= 1940 && q.year <= 2025));
    const el = document.getElementById('clearQuote');
    return {
      count: Q.length, bad: bad.length,
      shownText: (el.querySelector('.q-text') || {}).textContent || '',
      shownWho: (el.querySelector('.q-who') || {}).textContent || ''
    };
  });
  check('every quote carries a speaker and a plausible year',
    quote.count > 20 && quote.bad === 0, `${quote.count} quotes`);
  check('finishing a floor shows a quote with its year',
    quote.shownText.length > 10 && /\d{4}/.test(quote.shownWho),
    quote.shownWho.trim());

  // 100 distinct levels, each with its own matching quote
  const content = await page.evaluate(() => {
    const L = window.RelWorld.LEVELS;
    const missions = new Set(L.map(l => l.text));
    const quotes = new Set(L.map(l => l.q.t));
    // the clear screen showed floor 1's quote, which must be floor 1's quote
    const el = document.getElementById('clearQuote');
    const shown = (el.querySelector('.q-text') || {}).textContent || '';
    return {
      levels: L.length, missions: missions.size, quotes: quotes.size,
      matchesFloor1: shown.includes(L[0].q.t.slice(0, 20))
    };
  });
  check('there are 100 levels with distinct missions', content.levels === 100 && content.missions === 100,
    `${content.levels} levels, ${content.missions} distinct missions`);
  check('each level has its own distinct quote', content.quotes === 100, `${content.quotes} distinct quotes`);
  check('the quote shown matches the floor just cleared', content.matchesFloor1);

  // the lit floor climbs UP the tower as the career advances (was reversed)
  const lit = await page.evaluate(() => {
    const R = window.RelWorld;
    return { base: R.activeFloorForLevel(0), mid: R.activeFloorForLevel(15),
             bot: R.SHELL_BOT, top: R.SHELL_TOP };
  });
  check('the lit storey starts at the base and climbs up with the level',
    lit.base > lit.mid && (lit.bot - lit.base) <= 4,
    `level0 lights storey ${lit.base} (base ${lit.bot}), level15 lights ${lit.mid}`);

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

  /* ---- 5. the narrated, cinematic briefing ---- */
  await page.evaluate(() => document.querySelectorAll('#levelSelectCont .level-btn')[0].click());
  await page.waitForSelector('#briefingScreen:not([hidden])');

  const words = await page.evaluate(() => ({
    spans: document.querySelectorAll('#bText .w').length,
    storyWords: window.RelWorld.state.brief.words.length,
    text: document.getElementById('bText').textContent.trim().slice(0, 24)
  }));
  check('mission text is split into highlightable words', words.spans > 8 && words.spans === words.storyWords,
    `${words.spans} words`);

  // the opening must hold the whole building in frame, zoomed right out
  await page.waitForTimeout(900);
  const tower = await page.evaluate(() => {
    const R = window.RelWorld, s = R.state, v = R.view();
    // where the renderer actually puts the roof and the base of the shell
    const screenY = (isoY, z) => v.h / 2 + s.scale * (isoY - s.camY + z);
    const screenX = isoX => v.w / 2 + s.scale * (isoX - s.camX);
    return {
      view: v, alpha: s.buildingAlpha,
      side: document.body.classList.contains('wide-brief'),
      top: screenY(0, R.SHELL_TOP * R.ZH) / v.h,
      bottom: screenY(19 * R.TH, R.SHELL_BOT * R.ZH) / v.h,
      right: screenX(19 * 30) / v.w
    };
  });
  // The briefing text sits either below the tower or beside it; either way the
  // whole building has to stay in the clear.
  const towerOk = tower.side
    ? (tower.top > 0.01 && tower.bottom < 0.99 && tower.right < 0.64)
    : (tower.top > 0.01 && tower.bottom < 0.75);
  check('opening holds the whole building clear of the briefing text',
    tower.alpha > 0.95 && towerOk,
    `${tower.side ? 'side' : 'stacked'} layout, spans ${(tower.top * 100).toFixed(0)}%..` +
    `${(tower.bottom * 100).toFixed(0)}% of a ${tower.view.w}x${tower.view.h} view`);

  // and the reveal is slow enough to watch, not a blink
  const stillTower = await page.evaluate(() =>
    new Promise(r => setTimeout(() => r(window.RelWorld.state.buildingAlpha), 1600)));
  check('building reveal is paced, not instant', stillTower > 0.5, `alpha=${stillTower.toFixed(2)}`);

  // once it opens up, the camera shows the whole floor plan
  await page.waitForFunction(() => window.RelWorld.state.brief.t > window.RelWorld.BRIEF_OPEN_MS + 250,
    { timeout: 12000 });
  const wide = await page.evaluate(() => {
    const R = window.RelWorld, s = R.state, v = R.view();
    const TW = 60, TH = R.TH;
    // the four corners of the floor plan, in screen space
    const pts = [[0, 0], [19, 0], [0, 19], [19, 19]].map(([x, y]) => ({
      x: v.w / 2 + s.scale * ((x - y) * TW / 2 - s.camX),
      y: v.h / 2 + s.scale * ((x + y) * TH / 2 - s.camY)
    }));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return {
      alpha: s.buildingAlpha, view: v,
      left: Math.min(...xs), right: Math.max(...xs),
      top: Math.min(...ys), bottom: Math.max(...ys)
    };
  });
  const fitsW = wide.left > -8 && wide.right < wide.view.w + 8;
  const fitsH = wide.top > -8 && wide.bottom < wide.view.h + 8;
  // and it should actually use the space, not sit as a stamp in the middle
  const fills = (wide.right - wide.left) / wide.view.w > 0.5 ||
                (wide.bottom - wide.top) / wide.view.h > 0.5;
  check('briefing fits the whole maze on screen and fills it',
    wide.alpha < 0.05 && fitsW && fitsH && fills,
    `${(wide.right - wide.left).toFixed(0)}x${(wide.bottom - wide.top).toFixed(0)} in ${wide.view.w}x${wide.view.h}`);

  // the read-along advances on its own even with no speech voice installed
  const reading = await page.evaluate(() => {
    const s = window.RelWorld.state;
    const first = s.brief.wordIndex;
    return new Promise(res => setTimeout(() => res({
      first, later: s.brief.wordIndex, progress: s.brief.progress,
      highlighted: document.querySelectorAll('#bText .w.now').length,
      spoken: document.querySelectorAll('#bText .w.said').length
    }), 2500));
  });
  check('words highlight as the mission is read', reading.later > reading.first && reading.highlighted === 1,
    JSON.stringify(reading));

  // later in the narration the camera moves in on the people on the floor
  const closeUp = await page.evaluate(() => {
    const s = window.RelWorld.state;
    s.brief.progress = 0.45;
    return new Promise(res => setTimeout(() => res({ scale: s.scale }), 1200));
  });
  check('camera zooms in on the participants mid-narration', closeUp.scale > 1.1, JSON.stringify(closeUp));

  check('briefing can be skipped straight into the level', await (async () => {
    await page.click('#btnGo');
    await page.waitForFunction(() => window.RelWorld.state.state === 'playing', { timeout: 6000 }).catch(() => {});
    return page.evaluate(() => window.RelWorld.state.state === 'playing');
  })());

  check('narration can be switched off', await (async () => {
    await page.click('#btnPause'); await page.click('#btnPauseMenu');
    await page.click('#btnNarration');
    const off = await page.evaluate(() => window.RelWorld.options.narration === false);
    await page.evaluate(() => document.querySelectorAll('#levelSelectCont .level-btn')[0].click());
    await page.waitForSelector('#briefingScreen:not([hidden])');
    const stillShown = await page.evaluate(() => document.querySelectorAll('#bText .w').length > 5);
    return off && stillShown;   // muted, but the text is still there to read
  })());

  /* ---- 6. walls between the camera and the player are cut away ---- */
  await page.click('#btnGo');
  await page.waitForFunction(() => window.RelWorld.state.state === 'playing', { timeout: 9000 });
  const cutaway = await page.evaluate(async () => {
    const { state: s, TILE } = window.RelWorld;
    const W = 20, H = 20;
    const plain = (x, y) => { const t = s.map[y] && s.map[y][x]; return t === TILE.FLOOR || t === TILE.ROOM || t === TILE.COIN; };
    const g = s.floor.goal;
    // A wall with a standable tile diagonally in front of it (where it occludes)
    // and another two steps further back (where it doesn't), away from the exit.
    let spot = null;
    const screenAt = s.floor.screenAt || {};
    for (let y = 3; y < H - 1 && !spot; y++) {
      for (let x = 3; x < W - 1 && !spot; x++) {
        if (s.map[y][x] !== TILE.WALL) continue;
        if (screenAt[y * W + x]) continue;      // screen walls are dark; dimming them reveals brighter floor
        if (Math.abs(x - g.x) + Math.abs(y - g.y) < 4) continue;
        const behind = [x - 1, y - 1], away = [x - 3, y - 3];
        if (away[0] < 1 || away[1] < 1) continue;
        if (plain(behind[0], behind[1]) && plain(away[0], away[1])) spot = { wall: [x, y], behind, away };
      }
    }
    if (!spot) return { ok: false, reason: 'no suitable wall found' };

    const cv = document.getElementById('gameCanvas');
    const ctx2 = cv.getContext('2d');
    const view = window.RelWorld.view();
    const VW = view.w, VH = view.h;
    const dpr = cv.width / VW;                    // whatever the renderer settled on
    const TW = 60, TH = window.RelWorld.TH, ZH = window.RelWorld.ZH;
    const sample = async (px, py) => {
      s.player.x = px; s.player.y = py;
      await new Promise(r => setTimeout(r, 700));        // let the camera settle
      const wx = VW / 2 + (spot.wall[0] - spot.wall[1]) * TW / 2 - s.camX;
      const wy = VH / 2 + (spot.wall[0] + spot.wall[1]) * TH / 2 - s.camY - ZH + TH * 0.35;
      const sx = VW / 2 + s.scale * (wx - VW / 2);
      const sy = VH / 2 + s.scale * (wy - VH / 2);
      if (sx < 4 || sx > VW - 4 || sy < 4 || sy > VH - 4) return null;
      const d = ctx2.getImageData(Math.round(sx * dpr), Math.round(sy * dpr), 1, 1).data;
      return d[0] + d[1] + d[2];
    };
    const solid = await sample(spot.away[0], spot.away[1]);
    const ghost = await sample(spot.behind[0], spot.behind[1]);
    return { ok: solid !== null && ghost !== null, solid, ghost, spot };
  });
  check('walls in front of the player are made see-through',
    cutaway.ok && cutaway.ghost < cutaway.solid * 0.8,
    `solid=${cutaway.solid} ghosted=${cutaway.ghost}`);

  /* ---- 7. the arrow tutorial line is not repeated every floor ---- */
  const hints = await page.evaluate(() => {
    const f = window.RelWorld.missionScript;
    const needle = 'החץ המהבהב';
    return { first: f(0).includes(needle), second: f(1).includes(needle),
             third: f(2).includes(needle), late: f(40).includes(needle),
             lateNamesGoal: f(40).includes('היעד שלך') };
  });
  check('the blinking-arrow hint is only taught on the first floors',
    hints.first && hints.second && !hints.third && !hints.late, JSON.stringify(hints));
  check('every floor still names its destination out loud', hints.lateNamesGoal);

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
