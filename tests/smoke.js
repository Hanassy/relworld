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
    const { buildFloor, reachableWithKeys, TILE, isDesk, FLOORS } = window.RelWorld;
    const problems = [];
    const goalSpots = new Set();
    const mazeSigs = new Set();
    let minTime = Infinity, maxTime = 0, withScreens = 0, auditoriums = 0;
    let stuckFloors = 0, repairedFloors = 0;
    for (let i = 0; i < FLOORS; i++) {
      const f = buildFloor(i), m = f.map;
      const startTile = m[f.start.y][f.start.x];
      if (startTile === TILE.WALL || isDesk(startTile)) problems.push(`L${i + 1}: start inside a wall/desk`);
      const lock = reachableWithKeys(m, f.start.x, f.start.y);
      const seen = lock.seen;
      // THE check: a door you can walk up to but can never pay for means a key
      // is sealed behind the very lock it opens.
      if (lock.stuck.length) {
        stuckFloors++;
        const d = lock.stuck[0];
        problems.push(`L${i + 1}: door at ${d.x},${d.y} is reachable but unopenable (key locked away)`);
      }
      if (f.lockFixes > 0) repairedFloors++;
      if (!seen[f.goal.y][f.goal.x]) problems.push(`L${i + 1}: goal unreachable`);
      goalSpots.add(f.goal.x + ',' + f.goal.y);
      const goalTile = m[f.goal.y][f.goal.x];
      if (goalTile !== TILE.ELEVATOR && goalTile !== TILE.MEETING && goalTile !== TILE.HR) {
        problems.push(`L${i + 1}: goal tile not stamped`);
      }
      if (!f.tag) problems.push(`L${i + 1}: no destination name`);

      let parts = 0, desks = 0, coins = 0, keys = 0, doors = 0;
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
        const t = m[y][x];
        if (t === TILE.PART) { parts++; if (!seen[y][x]) problems.push(`L${i + 1}: part walled off`); }
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
      if (f.type === 0 && parts < desks) problems.push(`L${i + 1}: only ${parts} parts for ${desks} desks`);
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
      if (sc === 'cinema' || sc === 'court') {
        // an auditorium must read as one: rows of seats split by a centre aisle
        let seatRows = 0, splitRows = 0;
        for (let y = 0; y < 20; y++) {
          const xs = [];
          for (let x = 0; x < 20; x++) if (isDesk(m[y][x])) xs.push(x);
          if (xs.length < 4) continue;
          seatRows++;
          let groups = 1;
          for (let k = 1; k < xs.length; k++) if (xs[k] !== xs[k - 1] + 1) groups++;
          if (groups >= 2) splitRows++;             // a gap = the aisle you walk up
        }
        if (seatRows < 2) problems.push(`L${i + 1}: auditorium has ${seatRows} seat rows`);
        else if (splitRows === 0) problems.push(`L${i + 1}: auditorium rows have no centre aisle`);
        auditoriums++;
      }
    }
    const deterministic = JSON.stringify(buildFloor(42).map) === JSON.stringify(buildFloor(42).map);
    return { problems: [...new Set(problems)], minTime, maxTime, deterministic,
             goalSpots: goalSpots.size, distinctMazes: mazeSigs.size, withScreens, auditoriums,
             stuckFloors, repairedFloors };
  });
  check('all 100 floors are completable', audit.problems.length === 0, audit.problems.slice(0, 5).join('; '));
  // The niqqud is a pronunciation hint for the speech engine, not grammar, so
  // it follows a fixed phonetic convention. Guard it mechanically, because the
  // same rules have to hold once every mission is pointed.
  const pointing = await page.evaluate(() => {
    const L = window.RelWorld.LEVELS;
    const script = window.RelWorld.missionScript;
    // one stray mark is a disambiguation, not a vocalised mission
    const marks = t => (String(t).match(/[\u05B0-\u05BC\u05C1\u05C2\u05C7]/g) || []).length;
    const bad = [];
    let pointedCount = 0;
    for (let i = 0; i < L.length; i++) {
      const texts = [L[i].text, L[i].sub, script(i)];
      if (marks(L[i].text) < 8) { bad.push(`L${i + 1}: mission is not vocalised`); continue; }
      pointedCount++;
      for (const t of texts) {
        if (t.indexOf('\u05B0') >= 0) bad.push(`L${i + 1}: shva (silent ones are dropped, vocal ones become segol/patach)`);
        if (t.indexOf('\u05DB\u05B8\u05DC') >= 0) bad.push(`L${i + 1}: כָּל with kamatz — must be כּוֹל`);
        if (t.indexOf("\u05E6'\u05D0") >= 0) bad.push(`L${i + 1}: alef inside the slap word — the engine voices it`);
      }
    }
    return { pointedCount, total: L.length, bad: [...new Set(bad)] };
  });
  check('every mission is vocalised, and follows the phonetic niqqud convention',
    pointing.bad.length === 0 && pointing.pointedCount === pointing.total,
    `${pointing.pointedCount}/${pointing.total} pointed${pointing.bad.length ? ': ' + pointing.bad.slice(0, 3).join('; ') : ''}`);

  // Negative control: a validator that cannot fail proves nothing, so hand it a
  // floor where the only key sits behind the door it opens.
  const control = await page.evaluate(() => {
    const { reachableWithKeys, TILE } = window.RelWorld;
    const grid = () => Array.from({ length: 20 }, () => new Array(20).fill(TILE.WALL));
    // corridor: start(1,1) .. door(4,1) .. key(6,1)
    const bad = grid();
    for (let x = 1; x <= 8; x++) bad[1][x] = TILE.FLOOR;
    bad[1][4] = TILE.DOOR;
    bad[1][6] = TILE.KEY;                       // the key is PAST the door
    const r1 = reachableWithKeys(bad, 1, 1);

    // same floor with the key moved to the near side: now it is solvable
    const good = grid();
    for (let x = 1; x <= 8; x++) good[1][x] = TILE.FLOOR;
    good[1][4] = TILE.DOOR;
    good[1][2] = TILE.KEY;
    const r2 = reachableWithKeys(good, 1, 1);

    return {
      badStuck: r1.stuck.length, badKeyReached: r1.seen[1][6],
      goodStuck: r2.stuck.length, goodFarReached: r2.seen[1][8]
    };
  });
  check('the lock audit detects a key sealed behind its own door',
    control.badStuck === 1 && !control.badKeyReached, JSON.stringify(control));
  check('the lock audit passes a floor whose key is on the near side',
    control.goodStuck === 0 && control.goodFarReached, JSON.stringify(control));

  check('no floor leaves a door the player can reach but never open',
    audit.stuckFloors === 0, `lock audit auto-repaired ${audit.repairedFloors}/100 floors`);
  check('each floor has a distinct maze (no repeating layout)', audit.distinctMazes >= 98,
    `${audit.distinctMazes}/100 distinct wall layouts`);
  check('themed set pieces (screens) appear across floors', audit.withScreens >= 40,
    `${audit.withScreens} floors have a screen/set piece`);
  check('auditorium floors are laid out as seat rows round a centre aisle',
    audit.auditoriums >= 15, `${audit.auditoriums} auditorium floors checked`);
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
    s.slaps = s.floor.desks; s.partsGiven = s.floor.desks;
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
    const bad = Q.filter(q => !q.t || !q.who || !(q.year >= 1900 && q.year <= 2025));
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
      levels: L.length, floors: window.RelWorld.FLOORS,
      missions: missions.size, quotes: quotes.size,
      matchesFloor1: shown.includes(L[0].q.t.slice(0, 20))
    };
  });
  // the tower is as tall as the data: adding a floor must not need a code edit
  check('the tower is exactly as tall as the level data, and every mission is its own',
    content.levels >= 100 && content.floors === content.levels && content.missions === content.levels,
    `${content.levels} levels, ${content.floors} floors, ${content.missions} distinct missions`);
  check('each level has its own distinct quote', content.quotes === content.levels,
    `${content.quotes} distinct quotes`);
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
    window.RelWorld.stopNarration();      // or the read-along overwrites progress
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
    cutaway.ok && cutaway.ghost < cutaway.solid * 0.9,
    `solid=${cutaway.solid} ghosted=${cutaway.ghost}`);

  /* ---- 7. the arrow tutorial line is not repeated every floor ---- */
  const hints = await page.evaluate(() => {
    const f = window.RelWorld.missionScript;
    // a mission may be written with niqqud, so compare on the bare letters
    const bare = i => f(i).replace(/[\u0591-\u05C7]/g, '');
    const needle = 'החץ המהבהב';
    return { first: bare(0).includes(needle), second: bare(1).includes(needle),
             third: bare(2).includes(needle), late: bare(40).includes(needle),
             lateNamesGoal: bare(40).includes('היעד שלך'),
             firstNamesGoal: bare(0).includes('היעד שלך') };
  });
  check('the blinking-arrow hint is only taught on the first floors',
    hints.first && hints.second && !hints.third && !hints.late, JSON.stringify(hints));
  check('every floor still names its destination out loud',
    hints.lateNamesGoal && hints.firstNamesGoal);

  /* ---- 8. the hardware handed out belongs to the mission's own year ---- */
  const era = await page.evaluate(() => {
    const L = window.REL_LEVELS, T = window.REL_TECH;
    const bad = [];
    // the ladder has to climb, or techFor would pick the wrong rung
    for (let k = 1; k < T.length; k++) if (T[k].from <= T[k - 1].from) bad.push(`rung ${T[k].id} out of order`);
    // every rung needs the five fields the renderer and the briefing read
    for (const t of T) {
      if (!t.name || !t.b || !t.short || !t.icon || !/^#[0-9a-f]{6}$/i.test(t.hue)) bad.push(`rung ${t.id} incomplete`);
      if (!t.b.startsWith('ב')) bad.push(`rung ${t.id}: "${t.b}" is not a ב- phrase`);
    }
    const used = new Set();
    L.forEach((l, i) => {
      if (!l.kit) { bad.push(`L${i + 1}: no kit`); return; }
      used.add(l.kit.id);
      if (l.era < l.kit.from) bad.push(`L${i + 1}: ${l.kit.id} did not exist in ${l.era}`);
      const next = T[T.indexOf(l.kit) + 1];
      if (next && l.era >= next.from) bad.push(`L${i + 1}: ${l.era} should already be on ${next.id}`);
      // a mission must never name hardware from a different era than its own.
      // Matched on the full name, not the short label: "סרט" is a substring of
      // "הסרטון" and would flag an Uber mission for naming a tape reel.
      for (const t of T) {
        if (t === l.kit) continue;
        if (l.text.includes(t.name) || l.text.includes(t.b)) {
          bad.push(`L${i + 1}: ${l.era} text names ${t.name}`);
        }
      }
    });
    // a rung nothing lands on is dead data: the ladder tracks the missions
    for (const t of T) if (!used.has(t.id)) bad.push(`rung ${t.id} is never used`);
    // and a rung must not borrow a glyph the HUD already spends on something else
    for (const t of T) if (['🔑', '🗝️', '🪙', '⚠️', '📈', '🏢'].includes(t.icon)) {
      bad.push(`rung ${t.id} reuses the HUD icon ${t.icon}`);
    }
    return { bad, rungs: T.length, used: used.size };
  });
  check('every floor hands out hardware that existed in its year',
    era.bad.length === 0, era.bad.slice(0, 4).join(' | ') || `${era.used}/${era.rungs} rungs in play`);

  // negative control: the same audit, run over a deliberately mis-dated floor
  const eraCtrl = await page.evaluate(() => {
    const T = window.REL_TECH;
    const fake = { era: 2023, text: 'שדרג כל עמדה בתקליטון 3.5', kit: T.find(t => t.id === 'floppy35') };
    const caught = [];
    const next = T[T.indexOf(fake.kit) + 1];
    if (next && fake.era >= next.from) caught.push('wrong rung');
    for (const t of T) if (t !== fake.kit && fake.text.includes(t.short)) caught.push('wrong name');
    return caught;
  });
  check('the era audit is not vacuous', eraCtrl.includes('wrong rung'), eraCtrl.join(','));

  // the HUD and the briefing both have to say what this floor hands out
  const shown = await page.evaluate(() => {
    const api = window.RelWorld;
    // one upgrade floor per rung that any floor actually uses
    const seen = new Set(), picks = [];
    api.LEVELS.forEach((l, i) => {
      if (l.type === 0 && !seen.has(l.kit.id)) { seen.add(l.kit.id); picks.push(i); }
    });
    return picks.map(lvl => {
      api.openBriefing(lvl, true);
      const kit = api.state.floor.kit;
      return { lvl, id: kit.id,
               chip: document.getElementById('bObjectives').textContent.includes(kit.b),
               icon: document.getElementById('partIcon').textContent === kit.icon };
    });
  });
  check('the briefing and HUD name this floor\'s own hardware',
    shown.length > 6 && shown.every(r => r.icon && r.chip),
    shown.map(r => `${r.lvl + 1}:${r.id}`).join(' '));

  /* ---- 9. 3.5" on an rtl page: the trailing quote would jump to the front ---- */
  const ltr = await page.evaluate(async () => {
    const api = window.RelWorld;
    // a floor whose label actually carries the inch mark
    const lvl = api.LEVELS.findIndex(l => l.type === 0 && l.kit.short.includes('"'));
    api.openBriefing(lvl, true);
    document.getElementById('btnGo').click();
    // the dive-in camera has to settle, or the floor is still drawn undetailed
    await new Promise(r => setTimeout(r, 1500));
    // make sure one is lying right next to the player, in shot and in detail
    const s = api.state;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = s.player.x + dx, y = s.player.y + dy;
      if (s.map[y] && s.map[y][x] !== undefined && s.map[y][x] !== api.TILE.WALL) s.map[y][x] = api.TILE.PART;
    }
    const short = s.floor.kit.short, seen = [];
    const proto = CanvasRenderingContext2D.prototype, real = proto.fillText;
    proto.fillText = function (t, ...rest) {
      if (typeof t === 'string' && t.includes(short)) seen.push(this.direction);
      return real.call(this, t, ...rest);
    };
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    proto.fillText = real;
    return { short, seen: [...new Set(seen)], n: seen.length };
  });
  check('the inch mark stays at the end of 3.5" on an rtl page',
    ltr.n > 0 && ltr.seen.length === 1 && ltr.seen[0] === 'ltr',
    `${ltr.short} drawn ${ltr.n}x as ${ltr.seen.join('/')}`);

  /* ---- 10. the disguise floor really puts the player in costume ---- */
  const costume = await page.evaluate(async () => {
    const api = window.RelWorld;
    const lvl = api.LEVELS.findIndex(l => l.avatar);
    if (lvl < 0) return { lvl };
    const drawn = {};
    for (const [label, i] of [['costume', lvl], ['plain', 0]]) {
      api.openBriefing(i, true);
      document.getElementById('btnGo').click();
      await new Promise(r => setTimeout(r, 1500));
      const seen = [];
      const proto = CanvasRenderingContext2D.prototype, real = proto.fillText;
      proto.fillText = function (t, ...rest) {
        if (typeof t === 'string' && /^[\u{1F300}-\u{1FAFF}]/u.test(t) && this.font.startsWith('36px')) seen.push(t);
        return real.call(this, t, ...rest);
      };
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      proto.fillText = real;
      drawn[label] = [...new Set(seen)];
    }
    return { lvl, want: api.LEVELS[lvl].avatar, ...drawn };
  });
  check('a floor can put the player in costume, and the others do not',
    costume.lvl >= 0 && costume.costume.includes(costume.want) &&
    costume.plain.includes('🕴️') && !costume.plain.includes(costume.want),
    `floor ${costume.lvl + 1}: ${(costume.costume || []).join('')} vs ${(costume.plain || []).join('')}`);

  /* ---- 11. the briefing must not contradict the mission it just read ---- */
  const dest = await page.evaluate(() => {
    const api = window.RelWorld, bad = [];
    api.LEVELS.forEach((l, i) => {
      api.openBriefing(i, true);
      const chips = document.getElementById('bObjectives').textContent;
      // whatever the floor calls its exit is what the briefing has to say
      if (!chips.includes(l.goal)) bad.push(`L${i + 1}: chip omits ${l.goal}`);
      // and a renamed destination must not also carry the generic one
      const generic = ['המעלית 🔼', 'חדר הישיבות 🗓️', 'משרד HR 👩‍⚖️'][l.type];
      if (l.goalName && chips.includes(generic) && generic !== l.goalName) {
        bad.push(`L${i + 1}: still says ${generic}`);
      }
    });
    return bad;
  });
  check('the briefing names the destination the mission names',
    dest.length === 0, dest.slice(0, 3).join(' | '));

  /* ---- 12. nobody starts the floor standing on you ---- */
  const clearance = await page.evaluate(() => {
    const api = window.RelWorld, bad = [];
    let worst = Infinity, multi = 0;
    for (let i = 0; i < api.FLOORS; i++) {
      const f = api.buildFloor(i);
      // the player's own walk, through doors, is the distance that is felt
      const d = api.distanceField(f.map, f.start.x, f.start.y, true);
      for (const sp of f.spawns.slice(0, 3)) {
        const steps = d[sp.y][sp.x];
        if (sp.x === f.start.x && sp.y === f.start.y) bad.push(`L${i + 1}: spawn on the player`);
        else if (!(steps >= 10)) bad.push(`L${i + 1}: spawn ${steps} steps away`);
        worst = Math.min(worst, steps);
      }
      // the exit must be a walk, never the tile you are already standing on
      if (f.goal.x === f.start.x && f.goal.y === f.start.y) bad.push(`L${i + 1}: exit on the spawn`);
      if (f.spawns.length >= 3) multi++;
    }
    return { bad, worst, multi };
  });
  check('no rival starts within reach of the player, and no exit sits on the spawn',
    clearance.bad.length === 0, clearance.bad.slice(0, 4).join(' | ') || `closest is ${clearance.worst} steps`);

  // the upper floors field a whole management layer, not one cloned Chad
  const crowd = await page.evaluate(async () => {
    const api = window.RelWorld, seen = {};
    for (const lvl of [5, 35, 70]) {
      api.openBriefing(lvl, true);
      document.getElementById('btnGo').click();
      await new Promise(r => setTimeout(r, 300));
      seen[lvl + 1] = api.state.rivals.map(r => r.face);
    }
    return seen;
  });
  check('higher floors put several different managers on you, not one face repeated',
    crowd[71].length >= 3 && new Set(crowd[71]).size === crowd[71].length &&
    crowd[36].length === 2 && crowd[6].length <= 1,
    Object.entries(crowd).map(([k, v]) => `${k}:${v.join('')}`).join(' '));

  /* ---- 13. the epigraph opens the game, and the quotes are read aloud ---- */
  const epi = await page.evaluate(() => {
    const api = window.RelWorld;
    const bare = s => s.replace(/[\u0591-\u05C7]/g, '');
    const first = bare(api.missionScript(0));
    const second = bare(api.missionScript(1));
    // the script is written in the plene spelling the speech engine needs
    const spoken = 'מחשב על כול שולחן ובכול בית';
    const plain = 'מחשב על כל שולחן ובכל בית';
    return {
      opensFirst: first.indexOf(spoken) === 1,          // right after the opening ״
      onlyFirst: !second.includes(spoken),
      // and it is no longer spent as some floor's closing quote
      notAQuote: api.QUOTES.every(q => !bare(q.t).includes(plain) && !bare(q.t).includes(spoken))
    };
  });
  check('the game opens on the computer-on-every-desk line, and only there',
    epi.opensFirst && epi.onlyFirst && epi.notAQuote, JSON.stringify(epi));

  const readQuote = await page.evaluate(async () => {
    const api = window.RelWorld;
    api.openBriefing(3, true);
    document.getElementById('btnGo').click();
    await new Promise(r => setTimeout(r, 400));
    const s = api.state;
    s.slaps = s.floor.desks; s.partsGiven = s.floor.desks; s.coinsGot = s.floor.coinQuota;
    s.chadSlapped = true;
    api.levelCleared();
    await new Promise(r => setTimeout(r, 1300));
    const el = document.querySelector('#clearQuote .q-text');
    const words = el ? el.querySelectorAll('span.w').length : 0;
    const early = el ? el.querySelectorAll('span.w.said, span.w.now').length : 0;
    await new Promise(r => setTimeout(r, 1500));
    const later = el ? el.querySelectorAll('span.w.said, span.w.now').length : 0;
    return { words, early, later };
  });
  check('the floor-clear quote is split into words and read along',
    readQuote.words > 3 && readQuote.later > readQuote.early, JSON.stringify(readQuote));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
