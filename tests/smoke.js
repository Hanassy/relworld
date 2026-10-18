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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.png': 'image/png' };

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
  /* A mission is held twice: plain correct Hebrew for the eye, phonetically
     pointed Hebrew for the voice. The points are deliberately not grammar, so
     the convention is guarded mechanically — and so is the split itself, since
     a player must never be shown the misspelt half. */
  const pointing = await page.evaluate(() => {
    const L = window.RelWorld.LEVELS;
    const script = window.RelWorld.missionScript;
    const marks = t => (String(t).match(/[\u05B0-\u05BC\u05C1\u05C2\u05C7]/g) || []).length;
    const words = t => (String(t).match(/\S+/g) || []).length;
    const bad = [];
    let aligned = 0;
    for (let i = 0; i < L.length; i++) {
      const sc = script(i);
      // what is shown carries no points at all
      for (const [name, t] of [['text', L[i].text], ['sub', L[i].sub], ['script', sc.show]]) {
        if (marks(t) > 0) bad.push(`L${i + 1}: ${name} is shown to the player with vowel points`);
      }
      // what is spoken does, and follows the convention. A subtitle is a few
      // words, so it cannot be held to a full mission's density of marks, and
      // one in Latin ("Think Different") carries none at all and is fine.
      const heb = t => /[\u05D0-\u05EA]/.test(t);
      for (const [name, t, floor] of
           [['say', L[i].say, 8], ['saySub', L[i].saySub, 1], ['script', sc.say, 8]]) {
        if (heb(t) && marks(t) < floor) { bad.push(`L${i + 1}: ${name} is not vocalised`); continue; }
        if (t.indexOf('\u05B0') >= 0) bad.push(`L${i + 1}: shva (silent ones are dropped, vocal ones become segol/patach)`);
        if (t.indexOf('\u05DB\u05B8\u05DC') >= 0) bad.push(`L${i + 1}: כָּל with kamatz — must be כּוֹל`);
        if (t.indexOf("\u05E6'\u05D0") >= 0) bad.push(`L${i + 1}: alef inside the slap word — the engine voices it`);
      }
      // and the two line up word for word, or the read-along lights the wrong one
      const pairs = [[L[i].text, L[i].say], [L[i].sub, L[i].saySub], [sc.show, sc.say]];
      if (pairs.every(([a, b]) => words(a) === words(b))) aligned++;
      else bad.push(`L${i + 1}: ${pairs.map(([a, b]) => words(a) + '/' + words(b)).join(' ')} words`);
    }
    return { aligned, total: L.length, bad: [...new Set(bad)] };
  });
  check('shown Hebrew is plain, spoken Hebrew is pointed, and they line up word for word',
    pointing.bad.length === 0 && pointing.aligned === pointing.total,
    `${pointing.aligned}/${pointing.total} aligned${pointing.bad.length ? ': ' + pointing.bad.slice(0, 3).join('; ') : ''}`);

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
  // a new career opens on its own screen, held until you choose to walk in
  await page.waitForSelector('#openingScreen:not([hidden])');
  const openingHeld = await page.evaluate(() => ({
    title: document.querySelector('#openingScreen h1').textContent.trim(),
    button: document.getElementById('btnEnterBuilding').textContent.trim(),
    words: document.querySelectorAll('#openingQuote span.w').length,
    credit: (document.querySelector('#openingQuote .q-who') || {}).textContent || '',
    briefingWaits: document.getElementById('briefingScreen').hidden
  }));
  check('a new career opens on a screen of its own, with the quote and no briefing yet',
    openingHeld.title.includes('התחלת קריירה חדשה') && openingHeld.button === 'היכנס לבניין' &&
    openingHeld.words > 6 && openingHeld.credit.includes('1980') && openingHeld.briefingWaits,
    JSON.stringify(openingHeld));
  await page.click('#btnEnterBuilding');
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
    // the shown half is already plain, but strip anyway so the test does not
    // quietly start passing for the wrong reason if that ever changes
    const bare = i => f(i).show.replace(/[\u0591-\u05C7]/g, '');
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
    L.forEach((l, i) => {
      if (l.era >= 2000) return;
      if (l.kit.id === 'gpu' || l.kit.id === 'h100') bad.push(`L${i + 1}: ${l.kit.short} in ${l.era}`);
      if (/GPU|H100/i.test(l.text + l.sub)) bad.push(`L${i + 1}: text names a GPU in ${l.era}`);
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

  /* ---- 13. the opening line is spent on the opening, not on a floor ---- */
  const epi = await page.evaluate(() => {
    const api = window.RelWorld;
    const bare = s => s.replace(/[\u0591-\u05C7]/g, '');
    const plain = 'מחשב על כל שולחן ובכל בית';
    const spoken = 'מחשב על כול שולחן ובכול בית';
    const words = t => (String(t).match(/\S+/g) || []).length;
    return {
      // it is the game's epigraph, so no floor may also close on it
      notAQuote: api.QUOTES.every(q => !bare(q.t).includes(plain) && !bare(q.t).includes(spoken)),
      // shown correctly spelled, spoken in the plene form the engine needs
      isEpigraph: api.EPIGRAPH.t.includes(plain),
      spokenPlene: bare(api.EPIGRAPH.sayT).includes(spoken),
      aligned: words(api.EPIGRAPH.t) === words(api.EPIGRAPH.sayT) &&
               words(api.EPIGRAPH.who) === words(api.EPIGRAPH.sayWho)
    };
  });
  check('the computer-on-every-desk line opens the game, shown plain and spoken plene',
    epi.isEpigraph && epi.notAQuote && epi.spokenPlene && epi.aligned, JSON.stringify(epi));

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

  /* ---- 14. the opening quote belongs to the opening, not to the briefing ---- */
  const opening = await page.evaluate(async () => {
    const api = window.RelWorld;
    const bare = s => s.replace(/[\u0591-\u05C7]/g, '');
    api.startCareer();
    await new Promise(r => setTimeout(r, 300));
    const shown = {
      screen: !document.getElementById('openingScreen').hidden,
      state: api.state.state,
      read: document.querySelectorAll('#openingQuote .w.said, #openingQuote .w.now').length
    };
    document.getElementById('btnEnterBuilding').click();
    await new Promise(r => setTimeout(r, 300));
    return {
      shown,
      afterEnter: {
        screen: !document.getElementById('openingScreen').hidden,
        briefing: !document.getElementById('briefingScreen').hidden,
        // the mission's own script never carries the epigraph
        inScript: bare(api.missionScript(0).show).includes('מחשב על כל שולחן')
      }
    };
  });
  check('the opening screen holds the quote, reads it, and steps aside for the briefing',
    opening.shown.screen && opening.shown.state === 'opening' && opening.shown.read > 0 &&
    !opening.afterEnter.screen && opening.afterEnter.briefing && !opening.afterEnter.inScript,
    JSON.stringify(opening));

  // and both quotes say who said it, out loud
  const credited = await page.evaluate(async () => {
    const api = window.RelWorld;
    api.openBriefing(3, true);
    document.getElementById('btnGo').click();
    await new Promise(r => setTimeout(r, 400));
    const s = api.state;
    s.slaps = s.floor.desks; s.partsGiven = s.floor.desks; s.coinsGot = s.floor.coinQuota;
    s.chadSlapped = true;
    api.levelCleared();
    await new Promise(r => setTimeout(r, 1300));
    const who = document.querySelector('#clearQuote .q-who');
    const early = document.querySelectorAll('#clearQuote .w.said, #clearQuote .w.now').length;
    // let the read-along run past the end of the quotation itself
    await new Promise(r => setTimeout(r, 4000));
    return {
      whoWords: who ? who.querySelectorAll('span.w').length : 0,
      whoRead: who ? who.querySelectorAll('span.w.said, span.w.now').length : 0,
      early
    };
  });
  check('the closing quote reads its attribution too, not just the line',
    credited.whoWords > 2 && credited.whoRead > 0, JSON.stringify(credited));

  /* ---- 15. the shop front: link card, credit, satire notice ---- */
  const front = await page.evaluate(() => {
    const meta = p => (document.querySelector(`meta[property="${p}"]`) || {}).content || '';
    const B = window.RelWorld.BRAND;
    const credit = document.getElementById('menuCredit');
    const a = credit.querySelector('a');
    return {
      // what a pasted link turns into
      card: {
        title: !!meta('og:title'), desc: !!meta('og:description'),
        image: meta('og:image'), w: meta('og:image:width'), h: meta('og:image:height'),
        twitter: (document.querySelector('meta[name="twitter:card"]') || {}).content
      },
      credit: {
        name: credit.textContent.includes(B.name),
        tagline: credit.textContent.includes(B.tagline),
        href: a ? a.getAttribute('href') : '',
        newTab: a ? a.getAttribute('rel') : ''
      },
      // the notice is on the opening screen and reachable from the menu
      notice: {
        opening: (document.getElementById('openingDisclaimer').textContent || '').length > 20,
        full: (document.getElementById('legalText').textContent || '').length > 200,
        saysSatire: (document.getElementById('legalText').textContent || '').includes('סאטירי'),
        saysCoincidental: (document.getElementById('legalText').textContent || '').includes('מקרי בהחלט'),
        saysTrademark: (document.getElementById('legalText').textContent || '').includes('סימני מסחר')
      }
    };
  });
  check('a pasted link renders a card, not a grey line of text',
    front.card.title && front.card.desc && front.card.image.endsWith('/assets/share.png') &&
    front.card.w === '1200' && front.card.h === '630' && front.card.twitter === 'summary_large_image',
    JSON.stringify(front.card));
  check('the credit names the company, is tagged for attribution, and opens safely',
    front.credit.name && front.credit.tagline &&
    front.credit.href.includes('utm_source=relworld') && front.credit.href.includes('utm_content=menu') &&
    front.credit.newTab.includes('noopener'),
    JSON.stringify(front.credit));
  check('the satire notice is shown up front and spelled out in full',
    front.notice.opening && front.notice.full && front.notice.saysSatire &&
    front.notice.saysCoincidental && front.notice.saysTrademark,
    JSON.stringify(front.notice));

  // the credit stays out of the way while a floor is being played
  const quietDuringPlay = await page.evaluate(async () => {
    const api = window.RelWorld;
    api.openBriefing(5, true);
    document.getElementById('btnGo').click();
    // the dive-in camera runs first; wait for the floor to be live
    for (let i = 0; i < 60 && api.state.state !== 'playing'; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    const vis = id => {
      const el = document.getElementById(id);
      return !!(el && el.offsetParent !== null);
    };
    return { state: api.state.state, menuCredit: vis('menuCredit'), overCredit: vis('overCredit') };
  });
  check('no credit on screen while a floor is being played',
    quietDuringPlay.state === 'playing' && !quietDuringPlay.menuCredit && !quietDuringPlay.overCredit,
    JSON.stringify(quietDuringPlay));

  // nothing is sent anywhere unless analytics has actually been configured
  const quiet = await page.evaluate(() => ({
    configured: !!(window.RelWorld.BRAND.analytics.src || window.RelWorld.BRAND.analytics.ga4),
    scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))
  }));
  check('no third-party script loads while analytics is unconfigured',
    !quiet.configured && quiet.scripts.every(src => src.startsWith('src/')),
    JSON.stringify(quiet.scripts));

  // and the counters stay silent too, even though the call sites are wired
  const silent = await page.evaluate(async () => {
    const api = window.RelWorld, seen = [];
    // stand in for each provider: if track() reaches one, it is not inert
    window.plausible = (n, o) => seen.push(['plausible', n, o]);
    window.umami = { track: (n, p) => seen.push(['umami', n, p]) };
    window.goatcounter = { count: o => seen.push(['goatcounter', o]) };
    api.startCareer();
    api.track('probe', { a: 1 });
    await new Promise(r => setTimeout(r, 150));
    delete window.plausible; delete window.umami; delete window.goatcounter;
    return seen;
  });
  check('with no provider configured, not one event is reported',
    silent.length === 0, JSON.stringify(silent).slice(0, 120));

  // and once one is configured, the counts actually go out — with no personal data
  const wired = await page.evaluate(async () => {
    const api = window.RelWorld, seen = [];
    api.BRAND.analytics.src = 'https://example.invalid/a.js';   // test-only
    window.plausible = (n, o) => seen.push({ name: n, props: (o || {}).props });
    api.startCareer();
    api.openBriefing(2, true);
    document.getElementById('btnGo').click();
    await new Promise(r => setTimeout(r, 400));
    const s = api.state;
    s.slaps = s.floor.desks; s.partsGiven = s.floor.desks; s.coinsGot = s.floor.coinQuota;
    s.chadSlapped = true;
    api.levelCleared();
    await new Promise(r => setTimeout(r, 150));
    api.BRAND.analytics.src = '';
    delete window.plausible;
    const blob = JSON.stringify(seen);
    return {
      names: seen.map(e => e.name),
      floor: (seen.find(e => e.name === 'floor-cleared') || {}).props,
      // nothing that could identify a player may ride along
      leaks: /@|utm_|http|[0-9]{1,3}(\.[0-9]{1,3}){3}/.test(blob)
    };
  });
  // GA4 is the odd one out: it needs gtag, and it rejects hyphens in a name
  const ga = await page.evaluate(async () => {
    const api = window.RelWorld, seen = [];
    api.BRAND.analytics.ga4 = 'G-TESTONLY00';
    window.gtag = (...args) => seen.push(args);
    api.track('career-start');
    api.track('floor-cleared', { floor: 7 });
    api.BRAND.analytics.ga4 = '';
    delete window.gtag;
    return seen;
  });
  check('GA4 events go out under names GA will actually accept',
    ga.length === 2 && ga[0][1] === 'career_start' && ga[1][1] === 'floor_cleared' &&
    ga[1][2].floor === 7 && ga.every(e => /^[A-Za-z][A-Za-z0-9_]*$/.test(e[1])),
    JSON.stringify(ga));

  check('once a provider is configured the counts go out, carrying no personal data',
    wired.names.includes('career-start') && wired.names.includes('floor-cleared') &&
    wired.floor && wired.floor.floor === 3 && !wired.leaks,
    JSON.stringify(wired));

  /* ---- 16. a phone gives the screen to the game, not to the chrome ---- */
  // its own page: the suite's is a desktop viewport, and a pointer-only device
  // hides the pad entirely, so the phone layout has to be exercised on a phone
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
  });
  await phone.goto(base + '/index.html');
  await phone.waitForFunction(() => !!window.RelWorld);
  const onPhone = await phone.evaluate(async () => {
    const api = window.RelWorld;
    api.openBriefing(5, true);
    document.getElementById('btnGo').click();
    for (let i = 0; i < 60 && api.state.state !== 'playing'; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 400));
    const box = id => {
      const el = document.getElementById(id);
      return el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    };
    const c = box('gameCanvas'), pad = box('touchControls'), panel = box('bottomPanelContainer');
    const over = (a, b) => !!a && !!b && a.top < b.bottom && b.top < a.bottom;
    return {
      share: c ? c.height / window.innerHeight : 0,
      scale: api.state.scale,
      // both strips have to be ON the canvas, not stacked under it
      padOnCanvas: over(pad, c) && !!pad && pad.bottom <= c.bottom + 1,
      panelOnCanvas: over(panel, c),
      // and the task panel must not be sitting on the minimap, which the
      // canvas draws into its own top-LEFT corner
      panelClearsMinimap: !!panel && !!c && panel.left > c.left + 140
    };
  });
  check('on a phone the canvas gets the screen and the controls float on it',
    onPhone.share > 0.85 && onPhone.padOnCanvas && onPhone.panelOnCanvas &&
    onPhone.panelClearsMinimap,
    JSON.stringify({ ...onPhone, share: +onPhone.share.toFixed(2) }));
  check('and the floor is zoomed out so more of it fits',
    onPhone.scale > 1.2 && onPhone.scale < 1.7, `scale ${onPhone.scale.toFixed(2)}`);
  await phone.close();

  /* ---- 17. a returning player gets the build that is actually deployed ---- */
  const freshness = await page.evaluate(async () => {
    const api = window.RelWorld;
    const tags = [...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
      .map(e => e.getAttribute('src') || e.getAttribute('href'))
      .filter(u => u && u.startsWith('src/'));
    const realFetch = window.fetch;
    const nav = [];
    const run = body => {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      return api.checkForUpdate(u => nav.push(u));
    };
    try {
      sessionStorage.removeItem('rel_update_try');
      const same = await run({ build: api.BUILD });
      const newer = await run({ build: 'ffffff9' });
      const twice = await run({ build: 'ffffff9' });   // must not loop
      sessionStorage.removeItem('rel_update_try');
      return {
        // every asset carries the marker CI rewrites to the commit
        stamped: tags.length >= 4 && tags.every(u => /\?v=/.test(u)),
        build: api.BUILD,
        same, newer, twice, nav
      };
    } finally { window.fetch = realFetch; }
  });
  check('every asset URL carries a build marker, and the page knows its own build',
    freshness.stamped && !!freshness.build, JSON.stringify({ stamped: freshness.stamped, build: freshness.build }));
  check('a stale page reloads itself once onto the deployed build, and never loops',
    freshness.same === 'current' && freshness.newer === 'reloading' &&
    freshness.twice === 'already-tried' && freshness.nav.length === 1 &&
    freshness.nav[0].includes('v=ffffff9'),
    JSON.stringify({ same: freshness.same, newer: freshness.newer, twice: freshness.twice, nav: freshness.nav }));

  // stripping the build marker must not take the campaign tags with it
  const utmKept = await page.evaluate(async () => {
    const w = window.open('index.html?v=abc1234&utm_source=linkedin&utm_content=post', '_blank');
    await new Promise(r => setTimeout(r, 900));
    const search = w.location.search;
    w.close();
    return search;
  });
  check('the build marker is stripped from the URL but the utm tags survive',
    !/[?&]v=/.test(utmKept) && utmKept.includes('utm_source=linkedin') &&
    utmKept.includes('utm_content=post'),
    utmKept);

  // and version.json has to actually be served, or the check above is moot
  const vjson = await page.evaluate(async () => {
    const r = await fetch('version.json', { cache: 'no-store' });
    return { ok: r.ok, body: r.ok ? await r.json() : null };
  });
  check('version.json is served and names a build',
    vjson.ok && !!(vjson.body || {}).build, JSON.stringify(vjson));

  /* ---- 18. the lit word is the correct spelling of the word being said ---- */
  const dubbed = await page.evaluate(async () => {
    const api = window.RelWorld;
    api.openBriefing(4, true);
    await new Promise(r => setTimeout(r, 400));
    api.stopNarration();              // drive the read-along by hand
    const s = api.state;
    const sc = api.missionScript(4);
    const shown = sc.show.match(/\S+/g);
    const said = sc.say.match(/\S+/g);
    const starts = s.brief.sayStarts;
    const rows = [];
    // walk a few words spread across the mission
    for (const k of [0, 3, 9, 17, shown.length - 1]) {
      // park progress just inside the k-th SPOKEN word
      s.brief.wordIndex = -2;
      s.brief.progress = 0;
      const p = (starts[k] + 1) / s.brief.textLen;
      api.state.brief.progress = 0;
      window.RelWorld.narrationProgress(p);
      const lit = document.querySelector('#bText .w.now');
      rows.push({
        k,
        lit: lit ? lit.textContent : null,
        wantShown: shown[k],
        beingSaid: said[k],
        // the lit word is always the plain one
        litIsPlain: lit ? !/[\u0591-\u05C7]/.test(lit.textContent) : false,
        // and for a Hebrew word the voice is given something different. A year,
        // a Latin word or the goal tag is the same in both halves by design.
        dubbed: /[\u05D0-\u05EA]/.test(shown[k]) && said[k] !== shown[k]
      });
    }
    return { rows, shownLen: shown.length, saidLen: said.length };
  });
  // the phonetic spellings are deliberate misspellings; none may leak on screen
  const spelling = await page.evaluate(() => {
    const L = window.RelWorld.LEVELS;
    const wrong = [
      [/צ'פח/, "צ'פחות without the alef"],
      [/(^|\s)[ולבהש]?כול(\s|[,.:;!?]|$)/, 'כול with the plene vav'],
      [/(^|\s)ה?זות(\s|[,.:;!?]|$)/, 'זות for זאת'],
      [/עסר/, 'עסרים for עשרים'],
      [/(^|\s)צ'ד(\s|[,.:;!?]|$)/, "צ'ד for צ'אד"]
    ];
    const hits = [];
    L.forEach((l, i) => {
      for (const f of ['text', 'sub']) {
        for (const [re, why] of wrong) if (re.test(l[f])) hits.push(`L${i + 1}.${f}: ${why}`);
      }
    });
    return hits;
  });
  check('no phonetic misspelling leaks into the Hebrew a player reads',
    spelling.length === 0, spelling.slice(0, 4).join(' | '));

  check('every lit word is the plain spelling of the phonetic word being spoken',
    dubbed.shownLen === dubbed.saidLen &&
    dubbed.rows.every(r => r.lit === r.wantShown && r.litIsPlain) &&
    dubbed.rows.filter(r => r.dubbed).length >= 3,
    dubbed.rows.map(r => `${r.k}:${r.lit}|${r.beingSaid}`).join('  '));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
