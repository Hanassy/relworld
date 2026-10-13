/* =========================================================================
   REL WORLD - A CEO QUEST FOR GLORY
   Isometric office-satire roguelite. 100 floors, no dependencies.
   ========================================================================= */
'use strict';
(function () {

  /* ======================= constants ======================= */
  const TILE = {
    WALL: 0, COIN: 1, FLOOR: 2, DESK: 3, ELEVATOR: 5, DESK_SAD: 6,
    KEY: 7, DOOR: 8, ROOM: 9, GPU: 12, DESK_UP: 13, DESK_UP_SAD: 14,
    MEETING: 15, HR: 16, MKEY: 17, MDOOR: 18, MDOOR_OPEN: 19
  };
  const MAP_W = 20, MAP_H = 20, FLOORS = 100;
  // Tile height close to half the width would be a low, side-on view where tall
  // walls hide half the floor. A taller TH tips the camera towards top-down,
  // and the shorter wall height keeps sight lines open.
  const TW = 60, TH = 46, ZH = 34;          // iso tile width / height / wall height
  // The logical viewport tracks the canvas box, so the view fills whatever
  // shape the screen is instead of being letterboxed into a fixed 5:3 window.
  let VIEW_W = 1000, VIEW_H = 600;
  let cx0 = VIEW_W / 2, cy0 = VIEW_H / 2;
  const MOVE_MS = 115;                      // grid step cadence while a key is held
  const COMBO_MS = 2600;                    // window to keep a combo alive
  const MAX_STRIKES = 3;
  // The floor plan and the tower, measured in world units, so the framing below
  // can be derived from the viewport instead of hard-coded for one screen size.
  const PLAN_W = (MAP_W - 1 + MAP_H - 1) * TW / 2;      // iso width of the floor
  const PLAN_H = (MAP_W - 1 + MAP_H - 1) * TH / 2;      // iso height of the floor
  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  const isDesk = t => t === TILE.DESK || t === TILE.DESK_SAD || t === TILE.DESK_UP || t === TILE.DESK_UP_SAD;
  const isDoor = t => t === TILE.DOOR || t === TILE.MDOOR;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ======================= persistence ======================= */
  // Every access is guarded: private mode / blocked storage must not break the game.
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  let unlockedLevel = clamp(parseInt(store.get('rel_unlocked', 0), 10) || 0, 0, FLOORS - 1);
  let highScores = store.get('rel_scores', []);
  if (!Array.isArray(highScores)) highScores = [];
  let bestScore = store.get('rel_best', 0) || 0;
  const options = Object.assign({ sfx: true, music: true, narration: true }, store.get('rel_opts', {}));

  /* ======================= deterministic RNG ======================= */
  // Floor N must look the same on every visit, so layouts are seeded by index.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ======================= story content =======================
     The 100 levels live in src/levels.js (window.REL_LEVELS), which is the
     single source of truth shared with the readable LEVELS.md. Each entry is
     themed on a real tech event and carries the matching quote. */
  const LEVELS = (typeof window !== 'undefined' && window.REL_LEVELS) || [];
  const STORY = LEVELS.map((l, i) => ({
    title: `קומה ${i + 1} · ${l.name}`,
    subtitle: l.sub,
    type: l.type,
    text: l.text,
    goal: l.goal
  }));
  // per-level quote, 1:1 with the floor (no recycling)
  const QUOTES = LEVELS.map(l => l.q);

  const GOAL_TILE = [TILE.ELEVATOR, TILE.MEETING, TILE.HR];
  const GOAL_NAME = ['המעלית 🔼', 'חדר הישיבות 🗓️', 'משרד HR 👩‍⚖️'];
  const GOAL_ICON = ['🔼', '🗓️', '👩‍⚖'];
  const GOAL_FALLBACK = ['מעלית', 'ישיבה', 'HR'];
  // short sign-posting name, shown on the blinking waypoint arrow all game long
  const goalTag = i => STORY[i].goal || GOAL_FALLBACK[STORY[i].type];

  /* ======================= audio ======================= */
  const Audio = (function () {
    let ctx = null, master = null;

    function init() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.9;
          master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { ctx = null; }
    }

    function tone(freq, type, dur, vol, delay) {
      if (!ctx || !options.sfx) return;
      try {
        const t0 = ctx.currentTime + (delay || 0);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(vol === undefined ? 0.25 : vol, t0);
        g.gain.exponentialRampToValueAtTime(0.01, t0 + dur);
        osc.connect(g); g.connect(master);
        osc.start(t0); osc.stop(t0 + dur);
      } catch (e) { /* ignore */ }
    }

    function chord(freqs, vol) {
      if (!ctx || !options.music) return;
      freqs.forEach(f => {
        try {
          const osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, ctx.currentTime);
          g.gain.setValueAtTime(0, ctx.currentTime);
          g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.05);
          g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
          osc.connect(g); g.connect(master);
          osc.start(); osc.stop(ctx.currentTime + 0.6);
        } catch (e) { /* ignore */ }
      });
    }

    function sweep(from, to, dur, vol) {
      if (!ctx || !options.sfx) return;
      try {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(from, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
        g.gain.setValueAtTime(vol, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
        osc.connect(g); g.connect(master);
        osc.start(); osc.stop(ctx.currentTime + dur);
      } catch (e) { /* ignore */ }
    }

    // music: a bass line plus pad chords, driven by the main loop (not setInterval,
    // so it stays in sync with pause and with a backgrounded tab).
    const BASS = [130, 0, 130, 0, 173, 0, 196, 0, 130, 0, 130, 0, 110, 0, 98, 0];
    const PADS = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.6]];
    let step = 0, acc = 0;

    function music(dt, tense) {
      if (!ctx || !options.music) return;
      acc += dt;
      const interval = tense ? 160 : 200;
      while (acc >= interval) {
        acc -= interval;
        const note = BASS[step % BASS.length];
        if (note > 0) tone(tense ? note * 1.5 : note, 'triangle', 0.15, 0.2);
        if (step % 16 === 0) chord(PADS[Math.floor(step / 16) % PADS.length], 0.28);
        step++;
      }
    }

    return {
      init, music, resetMusic() { step = 0; acc = 0; },
      coin() { tone(1200, 'sine', 0.1, 0.15); },
      key() { tone(800, 'sine', 0.1, 0.2); tone(1200, 'sine', 0.15, 0.2, 0.1); },
      masterKey() { [600, 800, 1000].forEach((f, i) => tone(f, 'sine', 0.15, 0.3, i * 0.1)); },
      lock() { tone(300, 'square', 0.1, 0.3); tone(200, 'square', 0.1, 0.3, 0.1); },
      gpu() { tone(1500, 'square', 0.1, 0.15); tone(2000, 'square', 0.15, 0.15, 0.1); },
      giveGpu() { tone(600, 'triangle', 0.1, 0.25); tone(800, 'triangle', 0.2, 0.25, 0.1); },
      slap() { tone(150, 'square', 0.1, 0.5); sweep(600, 200, 0.5, 0.25); },
      deny() { tone(180, 'square', 0.12, 0.25); tone(120, 'square', 0.18, 0.25, 0.1); },
      tick() { tone(1000, 'square', 0.05, 0.1); },
      strike() { tone(260, 'sawtooth', 0.25, 0.3); tone(180, 'sawtooth', 0.35, 0.3, 0.2); },
      fired() { [300, 250, 200].forEach((f, i) => tone(f, 'sawtooth', 0.3 + i * 0.1, 0.3, i * 0.3)); },
      win() {
        [400, 500, 600, 800].forEach((f, i) => tone(f, 'sine', 0.15, 0.3, i * 0.1));
        tone(1200, 'sine', 0.4, 0.3, 0.45);
      },
      combo(level) { tone(700 + level * 140, 'sine', 0.09, 0.18); }
    };
  })();

  /* ======================= narrator =======================
     Reads the mission aloud and reports progress (0..1) so the briefing camera
     and the word highlighting stay in step. Speech is best-effort: with no
     Hebrew voice installed it degrades to a silent, timed read-along rather
     than mangling Hebrew through an English voice. */
  const Narrator = (function () {
    const synth = window.speechSynthesis;
    let fallbackId = null, boundarySeen = false, guardId = null;
    let startedAt = 0, estimate = 1, onProgress = null;

    if (synth && typeof synth.addEventListener === 'function') {
      // Chrome populates the voice list asynchronously; this warms it up.
      try { synth.addEventListener('voiceschanged', () => synth.getVoices()); } catch (e) { /* ignore */ }
    }

    function hebrewVoice() {
      if (!synth || !synth.getVoices) return { voice: null, known: false };
      let voices = [];
      try { voices = synth.getVoices() || []; } catch (e) { voices = []; }
      const hit = voices.find(v => v.lang && /^(he|iw)/i.test(v.lang));
      return { voice: hit || null, known: voices.length > 0 };
    }

    function stop() {
      if (fallbackId) { clearInterval(fallbackId); fallbackId = null; }
      if (guardId) { clearTimeout(guardId); guardId = null; }
      onProgress = null;
      try { if (synth) synth.cancel(); } catch (e) { /* ignore */ }
    }

    function runSilent() {
      if (fallbackId) return;
      startedAt = performance.now();
      fallbackId = setInterval(() => {
        const p = Math.min(1, (performance.now() - startedAt) / estimate);
        if (onProgress) onProgress(p);
        if (p >= 1) { clearInterval(fallbackId); fallbackId = null; }
      }, 60);
    }

    function speak(text, progressCb) {
      stop();
      onProgress = progressCb;
      boundarySeen = false;
      estimate = Math.max(2600, text.length * 55);   // rough Hebrew read-along pace

      const { voice, known } = hebrewVoice();
      const canSpeak = options.narration && synth && window.SpeechSynthesisUtterance && (voice || !known);
      if (!canSpeak) { runSilent(); return; }

      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'he-IL';
        if (voice) u.voice = voice;
        u.rate = 0.98;
        u.onboundary = e => {
          if (e.name && e.name !== 'word') return;
          boundarySeen = true;
          if (fallbackId) { clearInterval(fallbackId); fallbackId = null; }
          if (onProgress) onProgress(Math.min(1, (e.charIndex || 0) / Math.max(1, text.length)));
        };
        u.onend = () => { if (onProgress) onProgress(1); };
        u.onerror = () => runSilent();
        synth.speak(u);
        // Some voices never emit boundary events: fall back to the timed read.
        guardId = setTimeout(() => { if (!boundarySeen) runSilent(); }, 900);
      } catch (e) { runSilent(); }
    }

    return { speak, stop };
  })();

  /* ======================= floor layout ======================= */
  const LAYOUT = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 9, 9, 9, 9, 0, 2, 2, 2, 2, 2, 0, 9, 9, 9, 9, 9, 9, 2, 0],
    [0, 9, 3, 3, 9, 0, 2, 0, 0, 0, 2, 0, 9, 3, 3, 3, 3, 9, 9, 0],
    [0, 9, 3, 3, 9, 18, 2, 17, 2, 0, 2, 18, 9, 9, 9, 9, 9, 9, 9, 0],
    [0, 9, 9, 9, 9, 0, 0, 0, 2, 0, 0, 0, 9, 9, 9, 3, 3, 3, 9, 0],
    [0, 0, 0, 8, 0, 0, 2, 2, 2, 2, 2, 0, 9, 9, 9, 3, 3, 3, 9, 0],
    [0, 1, 1, 7, 1, 0, 2, 2, 2, 2, 2, 0, 9, 9, 9, 9, 9, 9, 9, 0],
    [0, 1, 3, 3, 1, 0, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 8, 0, 0, 0],
    [0, 1, 3, 3, 1, 0, 0, 0, 2, 0, 0, 0, 2, 2, 7, 2, 2, 2, 2, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    [0, 9, 9, 9, 9, 9, 0, 1, 2, 1, 0, 9, 9, 9, 9, 9, 0, 1, 1, 0],
    [0, 9, 3, 3, 3, 9, 18, 1, 2, 1, 18, 9, 3, 3, 3, 9, 0, 1, 1, 0],
    [0, 9, 3, 3, 3, 9, 0, 1, 2, 1, 0, 9, 3, 3, 3, 9, 0, 1, 1, 0],
    [0, 9, 9, 9, 9, 9, 0, 1, 7, 1, 0, 9, 9, 9, 9, 9, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 8, 0, 0, 0, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    [0, 2, 1, 7, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  ];

  // The original start tile (17,17) is a WALL and the rival spawned inside a desk.
  // Spawns are now validated against the generated map instead of hard-coded.
  const START = { x: 17, y: 18 };

  function applyVariant(map, v, rnd) {
    switch (v) {
      case 1: // open plan in the middle, a fresh wall down south
        map[10][7] = TILE.FLOOR; map[10][8] = TILE.FLOOR;
        map[11][7] = TILE.FLOOR; map[11][8] = TILE.FLOOR;
        map[7][13] = TILE.DESK; map[8][13] = TILE.DESK; map[7][14] = TILE.FLOOR;
        break;
      case 2: // southern corridor blocked, detour required
        map[17][8] = TILE.WALL; map[17][9] = TILE.WALL;
        map[10][13] = TILE.WALL; map[10][14] = TILE.WALL;
        map[8][7] = TILE.DESK; map[8][8] = TILE.DESK;
        break;
      case 3: // extra doors and partitions
        map[9][6] = TILE.DOOR; map[9][5] = TILE.WALL; map[9][4] = TILE.WALL;
        map[11][13] = TILE.FLOOR; map[11][14] = TILE.FLOOR; map[12][13] = TILE.WALL;
        break;
      case 4: // hot-desking: scattered desks in the corridors
        [[9, 10], [9, 12], [16, 5], [16, 11], [18, 9]].forEach(p => { map[p[0]][p[1]] = TILE.DESK; });
        map[5][8] = TILE.WALL;
        break;
      case 5: // the "collaboration zone" - rooms punched open
        map[5][3] = TILE.FLOOR; map[11][16] = TILE.FLOOR;
        map[4][5] = TILE.DOOR; map[13][6] = TILE.DOOR;
        map[2][13] = TILE.DESK_SAD; map[12][12] = TILE.DESK_SAD;
        break;
    }
    // a couple of seeded desk shuffles so repeat themes never feel identical
    for (let n = 0; n < 3; n++) {
      const x = 1 + Math.floor(rnd() * (MAP_W - 2));
      const y = 1 + Math.floor(rnd() * (MAP_H - 2));
      if (map[y][x] === TILE.COIN && !(x === START.x && y === START.y)) map[y][x] = TILE.DESK;
    }
  }

  /** Flood fill over everything the player could eventually walk through. */
  function reachableFrom(map, sx, sy) {
    const seen = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
    const queue = [[sx, sy]];
    seen[sy][sx] = true;
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || seen[ny][nx]) continue;
        const t = map[ny][nx];
        if (t === TILE.WALL || isDesk(t)) continue; // doors count as passable: keys exist
        seen[ny][nx] = true;
        queue.push([nx, ny]);
      }
    }
    return seen;
  }

  const hasReachableNeighbour = (seen, x, y) =>
    DIRS.some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && seen[ny][nx];
    });

  /** Breadth-first distance field from a target, used by rival pathfinding. */
  function distanceField(map, tx, ty) {
    const dist = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(Infinity));
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return dist;
    const queue = [[tx, ty]];
    dist[ty][tx] = 0;
    let head = 0;
    while (head < queue.length) {
      const [x, y] = queue[head++];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        if (dist[ny][nx] !== Infinity) continue;
        const t = map[ny][nx];
        if (t === TILE.WALL || isDesk(t) || isDoor(t)) continue; // rivals cannot open doors
        dist[ny][nx] = dist[y][x] + 1;
        queue.push([nx, ny]);
      }
    }
    return dist;
  }

  /**
   * Builds floor `index`. Deterministic, and guaranteed completable:
   * unreachable pickups are relocated, unreachable desks are removed from the
   * quota, and enough GPUs / keys are always placed.
   */
  function buildFloor(index) {
    const rnd = mulberry32(1337 + index * 7919);
    const map = LAYOUT.map(row => row.slice());
    const story = STORY[index];

    applyVariant(map, index % 6, rnd);

    // start tile must be walkable (this is the old spawn-inside-a-wall bug)
    let start = { x: START.x, y: START.y };
    if (map[start.y][start.x] === TILE.WALL || isDesk(map[start.y][start.x])) {
      outer: for (let r = 1; r < MAP_W; r++) {
        for (let y = 1; y < MAP_H - 1; y++) {
          for (let x = 1; x < MAP_W - 1; x++) {
            if (Math.abs(x - START.x) + Math.abs(y - START.y) !== r) continue;
            const t = map[y][x];
            if (t !== TILE.WALL && !isDesk(t) && !isDoor(t)) { start = { x, y }; break outer; }
          }
        }
      }
    }

    let seen = reachableFrom(map, start.x, start.y);

    // The exit is NOT always in the same corner: pick a reachable tile a decent
    // walk away from the start, seeded so a given floor always matches itself.
    const fromStartEarly = distanceField(map, start.x, start.y);
    const goalPicks = [];
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        const t = map[y][x];
        if (t !== TILE.FLOOR && t !== TILE.ROOM && t !== TILE.COIN) continue;
        if (!seen[y][x]) continue;
        const d = fromStartEarly[y][x];
        if (d === Infinity || d < 12) continue;      // never right next to spawn
        goalPicks.push({ x, y, d });
      }
    }
    goalPicks.sort((a, b) => b.d - a.d);
    // choose among the farthest third, so the exit is always a real journey
    const pool = goalPicks.slice(0, Math.max(1, Math.ceil(goalPicks.length / 3)));
    const goal = pool.length ? pool[Math.floor(rnd() * pool.length)] : { x: 18, y: 1 };
    map[goal.y][goal.x] = GOAL_TILE[story.type];

    // room mask drives the camera zoom and the "put the floor back" tile colour
    const roomMask = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (LAYOUT[y][x] === TILE.ROOM) roomMask[y][x] = true;
      }
    }
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (isDesk(map[y][x]) && DIRS.some(([dx, dy]) => roomMask[y + dy] && roomMask[y + dy][x + dx])) {
          roomMask[y][x] = true;
        }
      }
    }

    // free floor tiles we may relocate pickups onto
    const freeTiles = [];
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        const t = map[y][x];
        if (seen[y][x] && (t === TILE.FLOOR || t === TILE.ROOM) && !(x === start.x && y === start.y)) {
          freeTiles.push({ x, y });
        }
      }
    }
    const takeFree = () => freeTiles.length ? freeTiles.splice(Math.floor(rnd() * freeTiles.length), 1)[0] : null;

    // relocate every pickup that ended up walled off, drop unreachable desks
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        const t = map[y][x];
        if (isDesk(t)) {
          if (!hasReachableNeighbour(seen, x, y)) map[y][x] = roomMask[y][x] ? TILE.ROOM : TILE.FLOOR;
        } else if ((t === TILE.COIN || t === TILE.KEY || t === TILE.MKEY) && !seen[y][x]) {
          map[y][x] = TILE.WALL;
          const spot = takeFree();
          if (spot) map[spot.y][spot.x] = t;
        }
      }
    }

    // the goal itself must be reachable, otherwise the floor is a dead end
    seen = reachableFrom(map, start.x, start.y);
    if (!seen[goal.y][goal.x]) {
      map[7][16] = TILE.DOOR; // re-open the right wing
      seen = reachableFrom(map, start.x, start.y);
    }

    // tally the floor, then top up GPUs and keys so the quotas are always met
    let desks = 0, coins = 0, keysOnFloor = 0, doors = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = map[y][x];
        if (isDesk(t)) desks++;
        else if (t === TILE.COIN) coins++;
        else if (t === TILE.KEY) keysOnFloor++;
        else if (t === TILE.DOOR) doors++;
      }
    }

    const coinTiles = [];
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) if (map[y][x] === TILE.COIN && seen[y][x]) coinTiles.push({ x, y });
    }

    const gpusNeeded = desks + 3;
    for (let i = 0; i < gpusNeeded; i++) {
      const spot = coinTiles.length ? coinTiles.splice(Math.floor(rnd() * coinTiles.length), 1)[0] : takeFree();
      if (!spot) break;
      if (map[spot.y][spot.x] === TILE.COIN) coins--;
      map[spot.y][spot.x] = TILE.GPU;
    }
    for (let i = keysOnFloor; i < doors; i++) {
      const spot = takeFree();
      if (spot) map[spot.y][spot.x] = TILE.KEY;
    }

    // rival spawns: reachable floor tiles as far from the player as possible
    const fromStart = distanceField(map, start.x, start.y);
    const spawns = [];
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        const t = map[y][x];
        if (t === TILE.WALL || isDesk(t) || isDoor(t)) continue;
        if (x === goal.x && y === goal.y) continue;
        if (fromStart[y][x] === Infinity || fromStart[y][x] < 8) continue;
        spawns.push({ x, y, d: fromStart[y][x] });
      }
    }
    spawns.sort((a, b) => b.d - a.d);
    if (!spawns.length) spawns.push({ x: start.x, y: start.y, d: 0 });

    // type 1 asks for a budget quota rather than every last coin on the floor
    const coinQuota = story.type === 1 ? Math.max(1, Math.ceil(coins * 0.6)) : 0;
    // Budget: pay for the actual workload of this floor, then tighten the screws
    // as the tower gets higher. Every floor stays finishable, none is a stroll.
    const base = story.type === 0 ? 120 + desks * 3
               : story.type === 1 ? 120 + desks * 2 + Math.round(coinQuota * 1.2)
               : 110 + desks * 3;
    const time = clamp(base - Math.floor(index / 6) * 4, 110, 240);

    return { map, roomMask, start, spawns, goal, desks, coins, coinQuota, time,
             type: story.type, tag: goalTag(index) };
  }

  /* ======================= DOM ======================= */
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');

  const SCREENS = {
    menu: $('startScreen'), briefing: $('briefingScreen'),
    clear: $('clearScreen'), paused: $('pauseScreen'), over: $('overScreen')
  };

  function showScreen(name) {
    Object.keys(SCREENS).forEach(k => { SCREENS[k].hidden = (k !== name); });
    const inGame = (S.state === 'playing' || S.state === 'intro' || S.state === 'paused');
    const portrait = window.innerHeight > window.innerWidth;
    $('missionHUD').hidden = !inGame || portrait;
    $('bottomPanelContainer').hidden = !inGame || !portrait;
  }

  /* ======================= runtime state ======================= */
  const S = {
    state: 'menu',
    level: 0, score: 0, scoreAtStart: 0, runFloors: 0,
    keys: 0, gpus: 0, masterKey: false,
    strikes: 0, combo: 0, comboTimer: 0,
    floor: null, map: null, roomMask: null,
    player: { x: 0, y: 0, animY: 0, invuln: 0 },
    rivals: [], chadSlapped: false,
    slaps: 0, gpusGiven: 0, coinsGot: 0,
    timeLeft: 0,
    camX: 0, camY: 350, scale: 0.13, buildingAlpha: 1, introT: 0,
    shake: 0, globalTime: 0,
    brief: { t: 0, shots: [], progress: 0, tourBase: -1, words: [], textLen: 1, wordIndex: -2 },
    introFrom: { x: 0, y: 350, scale: 0.13, alpha: 1 },
    particles: [], texts: [], slapFx: [],
    scoreSaved: false
  };

  const INTRO_DUR = 1100;      // the tower dive now lives in the briefing
  const BRIEF_OPEN_MS = 4200;  // the tower reveal: long enough to actually watch
  // A 58-storey shell could only be framed by shrinking it to a sliver, and its
  // base ended up behind the briefing text. 36 storeys fit the clear band above
  // the narration while still reading as a skyscraper.
  const SHELL_TOP = -17, SHELL_BOT = 19;
  // Which storey lights up for a given level. Larger result = larger z = LOWER
  // on screen, so level 0 lights near the base and each level climbs UP.
  const activeFloorForLevel = lvl => SHELL_BOT - 3 - (lvl % 30);

  /** Scale and camY that frame `height` world units of content, whose centre is
      at `centre`, into the fraction `band` of the viewport, sitting at `at`. */
  function frameShot(worldW, height, centre, band, at, widthBand, atX) {
    const scale = Math.min((VIEW_W * (widthBand || 1) - 70) / worldW, (VIEW_H * band) / height);
    return {
      scale,
      camX: (0.5 - (atX === undefined ? 0.5 : atX)) * VIEW_W / scale,
      camY: centre + (0.5 - at) * VIEW_H / scale
    };
  }

  // On a wide screen the briefing text moves into a side column, so the floor
  // gets the full height instead of being squeezed above a block of text.
  let sideBrief = false;
  const BRIEF_BAND = () => (sideBrief ? [0.86, 0.5, 0.58, 0.29] : [0.62, 0.37, 1, 0.5]);

  const planShotBriefing = () => {
    const [band, at, wb, atX] = BRIEF_BAND();
    return frameShot(PLAN_W + 60, PLAN_H + ZH + 60, PLAN_H / 2, band, at, wb, atX);
  };
  const towerShot = () => {
    const [, , wb, atX] = BRIEF_BAND();   // the tower sets its own vertical band
    return frameShot(PLAN_W + 80, PLAN_H + (SHELL_BOT - SHELL_TOP) * ZH,
                     (PLAN_H + (SHELL_BOT + SHELL_TOP) * ZH) / 2,
                     sideBrief ? 0.80 : 0.60, sideBrief ? 0.5 : 0.38, wb, atX);
  };
  const inRoom = (x, y) => !!(S.roomMask && S.roomMask[y] && S.roomMask[y][x]);
  const floorTileUnder = (x, y) => inRoom(x, y) ? TILE.ROOM : TILE.FLOOR;

  /* ======================= scoring ======================= */
  function award(points, x, y, label, color) {
    S.combo = Math.min(5, S.combo + 1);
    S.comboTimer = COMBO_MS;
    const total = Math.round(points * (1 + (S.combo - 1) * 0.25));
    S.score += total;
    if (S.combo > 1) Audio.combo(S.combo);
    addText(x, y, label || ('+' + total), color || '#ffcc00');
    refreshStatus();
  }

  function penalty(points) {
    S.score = Math.max(0, S.score - points);
    S.combo = 0; S.comboTimer = 0;
    refreshStatus();
  }

  function addText(x, y, text, color) {
    if (S.texts.length > 24) S.texts.shift();
    S.texts.push({ x, y, text, color, life: 40, maxLife: 40 });
  }

  function addParticles(x, y, color, amount) {
    const room = Math.max(0, 260 - S.particles.length);
    for (let i = 0; i < Math.min(amount, room); i++) {
      S.particles.push({
        x, y, z: 10, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5,
        vz: Math.random() * 2 + 1, life: 20 + Math.random() * 20, color
      });
    }
  }

  /* ======================= objectives ======================= */
  function objectives() {
    const f = S.floor, list = [];
    if (f.type === 0) list.push({ label: `שדרג עמדות ב-GPU: ${S.gpusGiven}/${f.desks}`, done: S.gpusGiven >= f.desks });
    if (f.type === 1) list.push({ label: `אסוף תקציב: ${S.coinsGot}/${f.coinQuota}`, done: S.coinsGot >= f.coinQuota });
    list.push({ label: `חלק צ'אפחות: ${S.slaps}/${f.desks}`, done: S.slaps >= f.desks });
    // the boss slap starts the sprint, so it has to be the last thing you do
    if (f.type === 2) list.push({ label: 'ואז: צ\'אפחה לבוסניק 👺', done: S.chadSlapped });
    const ready = list.every(o => o.done);
    list.push({ label: `הגע ל-${f.tag} ${GOAL_ICON[f.type]}`, done: false, goal: true });
    return { list, ready };
  }

  function refreshStatus() {
    $('score').textContent = S.score;
    $('levelDisplay').textContent = S.level + 1;
    $('keys').textContent = S.keys;
    $('gpus').textContent = S.gpus;
    $('masterKey').textContent = S.masterKey ? '✅' : '❌';
    $('strikes').textContent = S.strikes + '/' + MAX_STRIKES;
    const comboBox = $('comboBox');
    comboBox.hidden = S.combo < 2;
    $('combo').textContent = S.combo;
  }

  let lastTaskHTML = '';

  function updateHUD() {
    if (!S.floor) return;
    const { list, ready } = objectives();
    const html = list.map(o => {
      const done = o.goal ? ready : o.done;
      return `<div class="task ${done ? 'done' : ''}">${done ? '✅' : '❌'} ${o.label}</div>`;
    }).join('');
    if (html !== lastTaskHTML) {   // aria-live: do not re-announce every second
      lastTaskHTML = html;
      $('taskList').innerHTML = html;
      $('taskListBottom').innerHTML = html;
    }

    const secs = Math.max(0, Math.ceil(S.timeLeft));
    const str = `⏳ ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    for (const id of ['timeDisplay', 'timeDisplayBottom']) {
      const el = $(id);
      el.textContent = str;
      el.classList.toggle('danger', secs <= 15);
    }
    refreshStatus();
  }

  /* ======================= level flow ======================= */
  /** Builds the floor and seats everyone on it. Used by the briefing tour and
      by the level itself, so the camera previews exactly what you will play. */
  function prepareFloor() {
    const f = buildFloor(S.level);
    S.floor = f;
    S.map = f.map;
    S.roomMask = f.roomMask;
    S.player = { x: f.start.x, y: f.start.y, animY: 0, invuln: 0 };
    S.slaps = 0; S.gpusGiven = 0; S.coinsGot = 0; S.chadSlapped = false;
    S.combo = 0; S.comboTimer = 0;
    S.particles = []; S.texts = []; S.slapFx = [];
    S.timeLeft = f.time;
    spawnRivals();
    return f;
  }

  /** Camera shots for the briefing: the whole floor first, then the people. */
  function buildShots(f) {
    const iso = (x, y) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 });
    const w = planShotBriefing();
    const wide = { x: w.camX, y: w.camY, scale: w.scale };
    const shots = [wide];

    // group desks into crowds, so the camera frames a team and not one chair
    const clusters = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!isDesk(f.map[y][x])) continue;
        const c = clusters.find(c => Math.abs(c.x - x) <= 4 && Math.abs(c.y - y) <= 4);
        if (c) { c.x = (c.x * c.n + x) / (c.n + 1); c.y = (c.y * c.n + y) / (c.n + 1); c.n++; }
        else clusters.push({ x, y, n: 1 });
      }
    }
    clusters.sort((a, b) => b.n - a.n);
    for (const c of clusters.slice(0, 2)) shots.push(Object.assign(iso(c.x, c.y), { scale: 1.5 }));
    if (S.rivals.length) shots.push(Object.assign(iso(S.rivals[0].x, S.rivals[0].y), { scale: 1.75 }));
    // close on the exit and hold it: the last thing you see is where to go
    const goalShot = Object.assign(iso(f.goal.x, f.goal.y), { scale: 1.55 });
    shots.push(goalShot, goalShot);
    return shots;
  }

  /** Splits the mission text into word spans we can light up one at a time. */
  function renderNarration(text) {
    const host = $('bText');
    host.textContent = '';
    S.brief.words = [];
    S.brief.textLen = Math.max(1, text.length);
    S.brief.wordIndex = -2;
    const re = /\S+/g;
    let m, last = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) host.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = m[0];
      host.appendChild(span);
      S.brief.words.push({ start: m.index, el: span });
      last = m.index + m[0].length;
    }
    if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
  }

  function narrationProgress(p) {
    S.brief.progress = clamp(p, 0, 1);
    const words = S.brief.words;
    if (!words.length) return;
    const charPos = S.brief.progress * S.brief.textLen;
    let idx = 0;
    while (idx + 1 < words.length && words[idx + 1].start <= charPos) idx++;
    if (idx === S.brief.wordIndex) return;
    S.brief.wordIndex = idx;
    for (let i = 0; i < words.length; i++) {
      words[i].el.classList.toggle('now', i === idx);
      words[i].el.classList.toggle('said', i < idx);
    }
  }

  /** What actually gets read out: the mission, then where to end up. */
  function missionScript(i) {
    // the blinking-arrow explanation is a tutorial line: say it on the first
    // couple of floors and then stop repeating it every single briefing
    const hint = i < 2 ? ' החץ המהבהב מצביע לשם לאורך כל הקומה.' : '';
    return `${STORY[i].text} היעד שלך: ${goalTag(i)}.${hint}`;
  }

  function narrateMission() {
    const story = missionScript(S.level);
    renderNarration(story);
    narrationProgress(0);
    S.brief.tourBase = S.brief.t >= BRIEF_OPEN_MS ? 0 : -1;
    Narrator.speak(story, narrationProgress);
  }

  function openBriefing(level, resetRun) {
    Audio.init();
    if (resetRun) {
      S.score = 0; S.keys = 0; S.gpus = 0; S.masterKey = false;
      S.strikes = 0; S.runFloors = 0;
    }
    S.level = clamp(level, 0, FLOORS - 1);
    S.scoreAtStart = S.score;

    const f = prepareFloor();
    const story = STORY[S.level];
    $('bTitle').textContent = story.title;
    $('bSubtitle').textContent = story.subtitle;
    $('bObjectives').innerHTML = [
      f.type === 0 ? `🟩 שדרג ${f.desks} עמדות ב-GPU` : '',
      f.type === 1 ? `🪙 אסוף ${f.coinQuota} יחידות תקציב` : '',
      f.type === 2 ? '👺 ולבסוף: צ\'אפחה לבוסניק ומירוץ ל-HR' : '',
      `🖐️ ${f.desks} צ'אפחות לעובדים`,
      `🏁 יעד: ${f.tag} — ${GOAL_NAME[f.type]}`,
      `⏳ ${Math.floor(f.time / 60)}:${String(f.time % 60).padStart(2, '0')} על השעון`
    ].filter(Boolean).map(line => `<div>${line}</div>`).join('');

    S.state = 'briefing';
    S.brief.t = 0;
    S.brief.tourBase = -1;
    S.brief.shots = buildShots(f);
    const tw = towerShot();
    S.camX = tw.camX; S.camY = tw.camY; S.scale = tw.scale; S.buildingAlpha = 1;
    showScreen('briefing');
    narrateMission();
  }

  function startLevel() {
    Narrator.stop();
    Audio.init(); Audio.resetMusic();
    prepareFloor();
    S.score = S.scoreAtStart;
    // the briefing already showed the floor: dive in from wherever it ended up
    S.introFrom = { x: S.camX, y: S.camY, scale: S.scale, alpha: S.buildingAlpha };
    S.introT = 0;
    S.state = 'intro';
    lastShownSecond = -1; lastTaskHTML = '';
    updateHUD();
    showScreen(null);
  }

  function spawnRivals() {
    const f = S.floor;
    S.rivals = [];
    let count = f.type === 0 ? (S.level >= 12 ? 1 : 0) : 1;
    if (S.level >= 30) count++;
    count = Math.min(count, Math.max(1, f.spawns.length), 2);
    for (let i = 0; i < count; i++) {
      const spot = f.spawns[Math.min(i, f.spawns.length - 1)];
      S.rivals.push({
        x: spot.x, y: spot.y, acc: 0, stun: 0, state: 'roam',
        speed: clamp(300 - S.level * 1.6 - i * 20, 150, 300),
        boss: i === 0
      });
    }
  }

  function levelCleared() {
    S.state = 'clear';
    Audio.win();
    const timeBonus = Math.round(S.timeLeft) * 10;
    const strikeBonus = (MAX_STRIKES - S.strikes) * 250;
    S.score += timeBonus + strikeBonus;
    S.runFloors++;
    if (S.level + 1 > unlockedLevel && S.level < FLOORS - 1) {
      unlockedLevel = S.level + 1;
      store.set('rel_unlocked', unlockedLevel);
    }
    if (S.score > bestScore) { bestScore = S.score; store.set('rel_best', bestScore); }
    addText(S.player.x, S.player.y, 'קודמת!', '#0f0');
    addParticles(S.player.x, S.player.y, '#0f0', 60);

    $('clearTitle').textContent = STORY[S.level].subtitle;
    $('clearStats').innerHTML = [
      `<div class="good">⏳ בונוס זמן: +${timeBonus}</div>`,
      `<div class="good">🛡️ בונוס ללא אזהרות: +${strikeBonus}</div>`,
      `<div>📈 ניקוד מצטבר: <b>${S.score}</b></div>`
    ].join('');
    const q = QUOTES[S.level % QUOTES.length];
    $('clearQuote').innerHTML =
      `<div class="q-text">״${q.t}״</div><div class="q-who">— ${q.who}, ${q.year}</div>`;
    $('btnNext').textContent = S.level >= FLOORS - 1 ? 'לסיום הקריירה' : 'לקומה הבאה';
    refreshStatus();
    setTimeout(() => { if (S.state === 'clear') showScreen('clear'); }, 900);
  }

  function gameOver(reason, victory) {
    if (S.state === 'over') return;
    S.state = 'over';
    S.scoreSaved = false;
    if (victory) Audio.win(); else Audio.fired();
    if (S.score > bestScore) { bestScore = S.score; store.set('rel_best', bestScore); }

    $('overTitle').textContent = victory ? '👑 הגעת למנכ"לות' : '📉 פוטרת';
    $('overReason').textContent = reason;
    $('overStats').innerHTML = [
      `<div>🏢 קומה אחרונה: <b>${S.level + 1}</b></div>`,
      `<div>🪜 קומות שעברת בריצה הזו: <b>${S.runFloors}</b></div>`,
      `<div>📈 ניקוד: <b>${S.score}</b></div>`,
      `<div>🏆 שיא אישי: <b>${bestScore}</b></div>`
    ].join('');
    $('nameForm').hidden = S.score <= 0;
    $('btnRetry').hidden = !!victory;
    showScreen('over');
  }

  function toMenu() {
    Narrator.stop();
    S.state = 'menu';
    S.floor = null;
    S.camX = 0; S.camY = 350; S.scale = 0.13; S.buildingAlpha = 1;
    renderMenu();
    showScreen('menu');
  }

  function togglePause(force) {
    if (S.state === 'playing' && force !== false) {
      S.state = 'paused';
      showScreen('paused');
    } else if (S.state === 'paused' && force !== true) {
      S.state = 'playing';
      showScreen(null);
    }
  }

  /* ======================= player actions ======================= */
  function tryMove(dx, dy) {
    if (S.state !== 'playing') return false;
    const nx = S.player.x + dx, ny = S.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return false;
    const t = S.map[ny][nx];

    if (t === TILE.DOOR) {
      if (S.keys > 0) {
        S.keys--; Audio.key();
        S.map[ny][nx] = floorTileUnder(nx, ny);
        award(50, nx, ny, 'UNLOCKED', '#fff');
        addParticles(nx, ny, '#fff', 10);
      } else {
        Audio.deny(); addText(nx, ny, 'צריך מפתח', '#f55');
      }
      updateHUD();
      return false;
    }
    if (t === TILE.MDOOR) {
      if (S.masterKey) {
        Audio.masterKey();
        S.map[ny][nx] = TILE.MDOOR_OPEN;
        award(50, nx, ny, 'UNLOCKED', '#ff5555');
        addParticles(nx, ny, '#ff5555', 15);
      } else {
        Audio.deny(); addText(nx, ny, 'דלת הנהלה', '#f55');
      }
      updateHUD();
      return false;
    }
    if (t === TILE.WALL || isDesk(t)) return false;

    S.player.x = nx; S.player.y = ny; S.player.animY = 7;

    switch (t) {
      case TILE.COIN:
        S.coinsGot++; Audio.coin();
        S.map[ny][nx] = floorTileUnder(nx, ny);
        award(10, nx, ny, null, '#ffcc00');
        addParticles(nx, ny, '#ffcc00', 5);
        break;
      case TILE.KEY:
        S.keys++; Audio.key();
        S.map[ny][nx] = floorTileUnder(nx, ny);
        award(50, nx, ny, '+KEY', '#ffcc00');
        break;
      case TILE.MKEY:
        S.masterKey = true; Audio.masterKey();
        S.map[ny][nx] = floorTileUnder(nx, ny);
        award(200, nx, ny, 'MASTER KEY!', '#ff5555');
        addParticles(nx, ny, '#ff5555', 20);
        break;
      case TILE.GPU:
        S.gpus++; Audio.gpu();
        S.map[ny][nx] = floorTileUnder(nx, ny);
        award(50, nx, ny, '+GPU', '#0f0');
        addParticles(nx, ny, '#0f0', 10);
        break;
      case TILE.ELEVATOR: case TILE.MEETING: case TILE.HR:
        if (objectives().ready) levelCleared();
        else {
          Audio.deny();
          addText(nx, ny, 'עוד לא סיימת!', '#ff5555');
        }
        break;
    }
    updateHUD();
    return true;
  }

  function doAction() {
    if (S.state !== 'playing') return;
    for (const [dx, dy] of DIRS) {
      const cx = S.player.x + dx, cy = S.player.y + dy;
      if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) continue;
      const cell = S.map[cy][cx];

      const rival = S.rivals.find(r => r.x === cx && r.y === cy);
      if (rival) {
        Audio.slap();
        S.shake = 12;
        S.slapFx.push({ x: cx, y: cy, timer: 20 });
        rival.stun = 3200;
        const deskWorkDone = S.slaps >= S.floor.desks;
        if (S.floor.type === 2 && rival.boss && !S.chadSlapped && deskWorkDone) {
          // He sprints straight to HR from here, so only arm the race once the
          // rest of the floor is finished - otherwise it is an unwinnable loss.
          S.chadSlapped = true;
          rival.state = 'raceHR';
          rival.stun = 2600;
          rival.speed = Math.round(rival.speed * 1.35); // give the player a chance
          award(1000, cx, cy, 'BOOM!', '#ff5555');
          addParticles(cx, cy, '#fff', 30);
        } else if (S.floor.type === 2 && rival.boss && !S.chadSlapped) {
          award(500, cx, cy, 'קודם העובדים!', '#ffcc00');
          addParticles(cx, cy, '#ffcc00', 15);
        } else {
          award(500, cx, cy, 'SMACK!', '#ffcc00');
          addParticles(cx, cy, '#ffcc00', 15);
        }
        updateHUD();
        return;
      }

      if (isDesk(cell)) {
        const sad = (cell === TILE.DESK_SAD || cell === TILE.DESK_UP_SAD);
        const upgraded = (cell === TILE.DESK_UP || cell === TILE.DESK_UP_SAD);
        if (!upgraded && S.gpus > 0) {
          S.gpus--; S.gpusGiven++;
          S.map[cy][cx] = sad ? TILE.DESK_UP_SAD : TILE.DESK_UP;
          Audio.giveGpu();
          award(200, cx, cy, 'UPGRADED!', '#0f0');
          addParticles(cx, cy, '#0f0', 15);
          updateHUD();
          return;
        }
        if (!sad) {
          S.slaps++;
          S.map[cy][cx] = upgraded ? TILE.DESK_UP_SAD : TILE.DESK_SAD;
          Audio.slap(); S.shake = 10;
          S.slapFx.push({ x: cx, y: cy, timer: 20 });
          award(500, cx, cy, 'WAKE UP!', '#ff5555');
          addParticles(cx, cy, '#fff', 15);
          updateHUD();
          return;
        }
        continue; // already handled: look at the next neighbour
      }

      if (cell === TILE.MDOOR_OPEN && S.masterKey) {
        const occupied = S.rivals.some(r => r.x === cx && r.y === cy);
        if (!occupied) {
          S.map[cy][cx] = TILE.MDOOR;
          Audio.lock();
          award(20, cx, cy, 'LOCKED', '#777');
          updateHUD();
          return;
        }
      }
    }
    Audio.deny();
  }

  function takeStrike(rival) {
    S.strikes++;
    penalty(300);
    S.timeLeft = Math.max(1, S.timeLeft - 12);
    S.shake = 20;
    Audio.strike();
    addText(S.player.x, S.player.y, 'אזהרה!', '#ff3333');
    addParticles(S.player.x, S.player.y, '#ff3333', 25);
    if (S.strikes >= MAX_STRIKES) {
      gameOver('שלוש אזהרות מהמנהל המקביל. ליווינו אותך החוצה עם קרטון.', false);
      return;
    }
    // reset both sides so the player is not re-caught on the spot
    S.player.x = S.floor.start.x;
    S.player.y = S.floor.start.y;
    S.player.invuln = 2200;
    rival.stun = 1800;
    updateHUD();
  }

  function updateRivals(dt) {
    for (const r of S.rivals) {
      if (r.stun > 0) { r.stun -= dt; continue; }
      r.acc += dt;
      if (r.acc < r.speed) continue;
      r.acc = 0;

      const target = r.state === 'raceHR' ? S.floor.goal : { x: S.player.x, y: S.player.y };
      const field = distanceField(S.map, target.x, target.y);
      let best = null, bestDist = field[r.y][r.x];
      if (bestDist === Infinity) bestDist = Infinity;
      for (const [dx, dy] of DIRS) {
        const nx = r.x + dx, ny = r.y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        if (field[ny][nx] < bestDist) { bestDist = field[ny][nx]; best = [nx, ny]; }
      }
      if (!best) { // boxed in (locked door, dead end): shuffle around
        const open = DIRS.map(([dx, dy]) => [r.x + dx, r.y + dy]).filter(([nx, ny]) =>
          nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H &&
          S.map[ny][nx] !== TILE.WALL && !isDesk(S.map[ny][nx]) && !isDoor(S.map[ny][nx]));
        if (open.length) best = open[Math.floor(Math.random() * open.length)];
      }
      if (best) { r.x = best[0]; r.y = best[1]; }

      if (r.state === 'raceHR' && r.x === S.floor.goal.x && r.y === S.floor.goal.y) {
        gameOver('המנהל המקביל הגיע ל-HR לפניך. התיק נפתח, אתה נסגר.', false);
        return;
      }
    }

    if (S.player.invuln <= 0) {
      const caught = S.rivals.find(r => r.x === S.player.x && r.y === S.player.y && r.state !== 'raceHR' && r.stun <= 0);
      if (caught) takeStrike(caught);
    }
  }

  /* ======================= camera ======================= */
  const smooth = t => t * t * (3 - 2 * t);

  function updateCamera(dt) {
    const p = S.player;
    const pcx = (p.x - p.y) * TW / 2, pcy = (p.x + p.y) * TH / 2;

    if (S.state === 'briefing') {
      S.brief.t += dt;
      const d = S.brief.t / BRIEF_OPEN_MS;
      if (d < 1) {
        const tw = towerShot(), pl = planShotBriefing();
        const drift = tw.scale * 0.19;      // a touch of push-in on the hold
        if (d < 0.42) {
          // Establishing shot: the whole tower in frame, drifting slowly past
          // it. The old opening started at 0.13 with the camera a thousand
          // units above the roof, so the building barely registered.
          const e = smooth(d / 0.42);
          S.scale = tw.scale + e * drift;
          S.camX = tw.camX;
          S.camY = tw.camY + e * 35;
          S.buildingAlpha = 1;
        } else {
          // then fly into it, dissolving the shell to reveal the floor plan
          const e = smooth((d - 0.42) / 0.58);
          S.scale = (tw.scale + drift) + e * (pl.scale - tw.scale - drift);
          S.camX = tw.camX + e * (pl.camX - tw.camX);
          S.camY = (tw.camY + 35) + e * (pl.camY - tw.camY - 35);
          S.buildingAlpha = clamp(1 - (d - 0.62) / 0.3, 0, 1);
        }
      } else {
        // then tour the floor: one shot per slice of the *remaining* narration.
        // Re-basing matters: whatever was read during the descent must not eat
        // into the establishing shot of the whole maze.
        S.buildingAlpha = 0;
        if (S.brief.tourBase < 0) S.brief.tourBase = S.brief.progress;
        const span = 1 - S.brief.tourBase;
        const tourP = span > 0.01 ? clamp((S.brief.progress - S.brief.tourBase) / span, 0, 1) : 1;
        const shots = S.brief.shots;
        const shot = shots[Math.min(shots.length - 1, Math.floor(tourP * shots.length))] || shots[0];
        const ease = 1 - Math.pow(0.94, dt / 16.67);
        S.scale += (shot.scale - S.scale) * ease;
        S.camX += (shot.x - S.camX) * ease;
        S.camY += (shot.y - S.camY) * ease;
        // deliberately unclamped: this is a cutscene, and an exit near the edge
        // of the floor still has to end up centred in its closing shot
      }
      return;
    }

    if (S.state === 'intro') {
      S.introT += dt;
      const k = clamp(S.introT / INTRO_DUR, 0, 1);
      const e = smooth(k);
      const from = S.introFrom;
      const target = inRoom(p.x, p.y) ? 2.3 : 1.25;
      S.scale = from.scale + e * (target - from.scale);
      S.camX = from.x + e * (pcx - from.x);
      S.camY = from.y + e * (pcy - from.y);
      S.buildingAlpha = from.alpha * (1 - e);
      clampCameraToFloor();
      if (k >= 1) { S.state = 'playing'; S.buildingAlpha = 0; showScreen(null); }
      return;
    }

    if (S.state === 'menu') {
      const tw = towerShot();
      S.scale = tw.scale; S.camX = tw.camX; S.buildingAlpha = 1;
      S.camY = tw.camY + Math.sin(S.globalTime * 0.004) * 90;
      return;
    }

    // playing / paused / clear / over: frame-rate independent easing
    const ease = 1 - Math.pow(0.85, dt / 16.67);
    const target = inRoom(p.x, p.y) ? 2.2 : 1.2;
    S.scale += (target - S.scale) * ease;
    S.camX += (pcx - S.camX) * ease;
    S.camY += (pcy - S.camY) * ease;
    clampCameraToFloor();
    if (S.shake > 0) S.shake -= dt / 16.67;
    if (p.animY > 0) p.animY -= dt / 16.67 * 0.6;
  }

  // Keep the viewport over the floor plan: the start tile sits in a corner of
  // the isometric diamond, so an unclamped camera wastes half the screen.
  const ISO_MIN_X = -(MAP_H - 1) * TW / 2, ISO_MAX_X = (MAP_W - 1) * TW / 2;
  const ISO_MAX_Y = (MAP_W - 1 + MAP_H - 1) * TH / 2;

  function clampCameraToFloor() {
    const halfW = VIEW_W / (2 * S.scale), halfH = VIEW_H / (2 * S.scale);
    const loX = ISO_MIN_X - TW + halfW, hiX = ISO_MAX_X + TW - halfW;
    S.camX = loX > hiX ? (ISO_MIN_X + ISO_MAX_X) / 2 : clamp(S.camX, loX, hiX);
    const loY = -ZH - TH * 0.5 + halfH, hiY = ISO_MAX_Y + TH * 0.5 - halfH;
    S.camY = loY > hiY ? ISO_MAX_Y / 2 : clamp(S.camY, loY, hiY);
  }

  /* ======================= drawing primitives ======================= */
  function drawWallBlock(x, y, z, cTop, cLeft, cRight, isDoorBlock) {
    ctx.beginPath();
    ctx.moveTo(x - TW / 2, y + TH / 2 - z); ctx.lineTo(x, y + TH - z);
    ctx.lineTo(x, y + TH); ctx.lineTo(x - TW / 2, y + TH / 2);
    ctx.closePath(); ctx.fillStyle = cLeft; ctx.fill();
    if (isDoorBlock) { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke(); }

    ctx.beginPath();
    ctx.moveTo(x, y + TH - z); ctx.lineTo(x + TW / 2, y + TH / 2 - z);
    ctx.lineTo(x + TW / 2, y + TH / 2); ctx.lineTo(x, y + TH);
    ctx.closePath(); ctx.fillStyle = cRight; ctx.fill();
    if (isDoorBlock) { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke(); }

    ctx.beginPath();
    ctx.moveTo(x, y - z); ctx.lineTo(x + TW / 2, y + TH / 2 - z);
    ctx.lineTo(x, y + TH - z); ctx.lineTo(x - TW / 2, y + TH / 2 - z);
    ctx.closePath(); ctx.fillStyle = cTop; ctx.fill();
    if (!isDoorBlock) { ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.stroke(); }
  }

  function shiftColor(hex, delta) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + delta, 0, 255);
    const g = clamp(((n >> 8) & 255) + delta, 0, 255);
    const b = clamp((n & 255) + delta, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function groundShadow(x, y, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.33)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** The cyan name plate that marks where this floor wants you to end up. */
  function signPlate(x, y, label, alpha, pointDown) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 18;
    ctx.fillStyle = 'rgba(0,18,26,0.9)';
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    roundRectPath(x - w / 2, y - 12, w, 24, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(label, x, y);
    if (pointDown) {
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 13); ctx.lineTo(x + 8, y + 13); ctx.lineTo(x, y + 25);
      ctx.closePath();
      ctx.fillStyle = '#00e5ff';
      ctx.fill();
    }
    ctx.restore();
  }

  /** Goal tile: glowing floor pool, expanding ring, icon and a blinking sign. */
  function drawGoalBeacon(x, y, val, ready) {
    const t = S.globalTime;
    const blink = 0.55 + 0.45 * Math.sin(t * 0.18);
    ctx.save();
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 48);
    glow.addColorStop(0, `rgba(0,229,255,${(ready ? 0.42 : 0.26) * blink})`);
    glow.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, y, 48, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    const rp = (t * 0.9) % 60;
    ctx.strokeStyle = `rgba(0,229,255,${Math.max(0, 1 - rp / 60) * 0.85})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 10 + rp * 0.5, (10 + rp * 0.5) * 0.56, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.font = '26px Arial';
    ctx.fillStyle = '#fff';
    const icon = val === TILE.ELEVATOR ? GOAL_ICON[0] : val === TILE.MEETING ? GOAL_ICON[1] : GOAL_ICON[2];
    ctx.fillText(icon, x, y - 8);
    signPlate(x, y - 56 + Math.sin(t * 0.12) * 4, S.floor ? S.floor.tag : '', 0.45 + 0.55 * blink, true);
  }

  /** When the goal is off screen, pin a blinking arrow to the edge pointing at
      it, so you always know where this floor wants you to go. */
  function drawGoalCompass(sx, sy) {
    if (!S.floor) return;
    const g = S.floor.goal;
    const wx = cx0 + (g.x - g.y) * TW / 2 - S.camX;
    const wy = cy0 + (g.x + g.y) * TH / 2 - S.camY;
    const px = cx0 + sx + S.scale * (wx - cx0);
    const py = cy0 + sy + S.scale * (wy - cy0);
    // The top strip belongs to the minimap and the task panel: a goal sitting
    // under either of them counts as hidden, so the edge arrow takes over.
    const m = 70, mTop = 168;
    if (px > m && px < VIEW_W - m && py > mTop && py < VIEW_H - m) return;

    const ex = clamp(px, m, VIEW_W - m), ey = clamp(py, mTop, VIEW_H - m);
    const ang = Math.atan2(py - cy0, px - cx0);
    const blink = 0.5 + 0.5 * Math.sin(S.globalTime * 0.22);

    ctx.save();
    ctx.translate(ex, ey);
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.55 * blink;
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(30, 0); ctx.lineTo(-10, -18); ctx.lineTo(-1, 0); ctx.lineTo(-10, 18);
    ctx.closePath();
    ctx.fillStyle = '#00e5ff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.restore();
    signPlate(0, ey > VIEW_H / 2 ? -34 : 34, S.floor.tag, 0.5 + 0.5 * blink, false);
    ctx.restore();
  }

  function drawIsoTile(x, y, color, room) {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + TW / 2, y + TH / 2);
    ctx.lineTo(x, y + TH); ctx.lineTo(x - TW / 2, y + TH / 2);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    if (room) {
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - TW / 4, y + TH / 4); ctx.lineTo(x + TW / 4, y + TH * 0.75);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.stroke();
    }
  }

  // Projection shared by the city backdrop and the tower shell. Note the +cx/+cy:
  // the original omitted it, so the tower and the floor plan never lined up
  // during the cross-fade.
  const pt = (x, y, z) => ({
    x: cx0 + (x - y) * TW / 2 - S.camX,
    y: cy0 + (x + y) * TH / 2 - S.camY + z
  });

  function poly(points, color) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  function drawScenery() {
    const gz = SHELL_BOT * ZH;
    poly([pt(-100, -100, gz), pt(100, -100, gz), pt(100, 100, gz), pt(-100, 100, gz)], '#05080c');
    poly([pt(-60, 23, gz - 3), pt(60, 23, gz - 3), pt(60, 26, gz - 3), pt(-60, 26, gz - 3)], '#111');

    const car1 = ((S.globalTime * 0.4) % 120) - 60;
    const car2 = 60 - ((S.globalTime * 0.5) % 120);
    const c1 = pt(car1, 24, gz - 6), c2 = pt(car2, 25.5, gz - 6);
    ctx.fillStyle = '#ff3333'; ctx.beginPath(); ctx.arc(c1.x, c1.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eeeeee'; ctx.beginPath(); ctx.arc(c2.x, c2.y, 3, 0, Math.PI * 2); ctx.fill();

    const bg = (bx, by, w, h, zT, zB, l, r, t) => {
      const topC = pt(bx, by, zT), leftC = pt(bx, by + h, zT), rightC = pt(bx + w, by, zT), botC = pt(bx + w, by + h, zT);
      poly([leftC, botC, pt(bx + w, by + h, zB), pt(bx, by + h, zB)], l);
      poly([rightC, botC, pt(bx + w, by + h, zB), pt(bx + w, by, zB)], r);
      poly([topC, rightC, botC, leftC], t);
    };
    bg(-25, -10, 15, 12, -11 * ZH, gz, '#101622', '#0a0d15', '#1a2230');
    bg(25, -5, 18, 14, -14 * ZH, gz, '#091016', '#05080c', '#111a22');
    bg(-10, 30, 12, 12, -6 * ZH, gz, '#161c22', '#10141a', '#222a33');
  }

  function drawTowerShell() {
    const zTop = SHELL_TOP * ZH, zBot = SHELL_BOT * ZH;
    const topC = pt(0, 0, zTop), leftC = pt(0, 20, zTop), rightC = pt(20, 0, zTop), botC = pt(20, 20, zTop);
    poly([leftC, botC, pt(20, 20, zBot), pt(0, 20, zBot)], '#162030');
    poly([rightC, botC, pt(20, 20, zBot), pt(20, 0, zBot)], '#0c1320');
    poly([topC, rightC, botC, leftC], '#08101a');

    const activeFloor = activeFloorForLevel(S.level);
    for (let f = SHELL_TOP + 1; f < SHELL_BOT; f++) {
      const z = f * ZH;
      const active = (f === activeFloor);
      // a pseudo-random set of windows is dark, so the tower looks inhabited
      ctx.fillStyle = active ? 'rgba(0,255,255,0.95)' : 'rgba(255,220,50,0.85)';
      for (let step = 1; step < 19; step += 2.5) {
        const lit = active || ((f * 7 + step * 13) % 9) > 2;
        if (!lit) continue;
        poly([pt(step, 19.9, z - 25), pt(step + 1.2, 19.9, z - 25), pt(step + 1.2, 19.9, z - 10), pt(step, 19.9, z - 10)], ctx.fillStyle);
        poly([pt(19.9, step, z - 25), pt(19.9, step + 1.2, z - 25), pt(19.9, step + 1.2, z - 10), pt(19.9, step, z - 10)], ctx.fillStyle);
      }
    }
  }

  function drawMinimap() {
    if (!S.map) return;
    const s = 7, pad = 8, w = MAP_W * s, h = MAP_H * s;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(pad - 3, pad - 3, w + 6, h + 6);
    ctx.strokeStyle = 'rgba(0,204,255,0.6)';
    ctx.strokeRect(pad - 3, pad - 3, w + 6, h + 6);

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = S.map[y][x];
        let c = null;
        if (t === TILE.WALL) c = '#12161f';
        else if (t === TILE.DESK) c = '#ffcc00';
        else if (t === TILE.DESK_UP) c = '#8f8';
        else if (t === TILE.DESK_SAD || t === TILE.DESK_UP_SAD) c = '#4a4a4a';
        else if (t === TILE.GPU) c = '#00ff00';
        else if (t === TILE.COIN) c = '#6b6440';
        else if (t === TILE.KEY) c = '#ffaa00';
        else if (t === TILE.MKEY) c = '#ff4444';
        else if (t === TILE.DOOR) c = '#ff8800';
        else if (t === TILE.MDOOR) c = '#ff2222';
        else if (t === TILE.MDOOR_OPEN) c = '#772222';
        else if (t === TILE.ELEVATOR || t === TILE.MEETING || t === TILE.HR) {
          c = (Math.sin(S.globalTime * 0.18) > 0) ? '#00ffff' : '#006672';   // blinks
        }
        else c = S.roomMask[y][x] ? '#33281e' : '#1d2430';
        ctx.fillStyle = c;
        ctx.fillRect(pad + x * s, pad + y * s, s, s);
      }
    }
    for (const r of S.rivals) {
      ctx.fillStyle = r.stun > 0 ? '#886699' : '#ff00ff';
      ctx.fillRect(pad + r.x * s - 1, pad + r.y * s - 1, s + 2, s + 2);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pad + S.player.x * s - 1, pad + S.player.y * s - 1, s + 2, s + 2);
    ctx.restore();
  }

  /* ======================= main render ======================= */
  function draw(dt) {
    updateCamera(dt);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    const sx = S.shake > 0 ? (Math.random() - 0.5) * (15 / S.scale) : 0;
    const sy = S.shake > 0 ? (Math.random() - 0.5) * (15 / S.scale) : 0;

    ctx.save();
    ctx.translate(cx0 + sx, cy0 + sy);
    ctx.scale(S.scale, S.scale);
    ctx.translate(-cx0, -cy0);

    if (S.buildingAlpha > 0.01) drawScenery();

    const innerAlpha = Math.max(0, 1 - S.buildingAlpha);
    const detailed = innerAlpha > 0.5 && S.map && S.state !== 'menu';
    const ready = S.floor && S.state === 'playing' ? objectives().ready : false;

    if (S.map && innerAlpha > 0.02) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const palettes = [
        { t: '#2c3e50', l: '#34495e', r: '#2c3e50' }, { t: '#27ae60', l: '#2ecc71', r: '#27ae60' },
        { t: '#c0392b', l: '#e74c3c', r: '#c0392b' }, { t: '#8e44ad', l: '#9b59b6', r: '#8e44ad' }
      ];
      const base = palettes[S.level % palettes.length];
      const pal = { t: shiftColor(base.t, 14), l: base.l, r: shiftColor(base.r, -26) };
      const bop = Math.sin(S.globalTime * 0.15) * 2;

      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const val = S.map[y][x];
          const pX = cx0 + (x - y) * TW / 2 - S.camX;
          const pY = cy0 + (x + y) * TH / 2 - S.camY;
          if (pX < -600 || pX > VIEW_W + 600 || pY < -600 || pY > VIEW_H + 600) continue;

          ctx.globalAlpha = innerAlpha;
          if (val !== TILE.WALL && val !== TILE.DOOR && val !== TILE.MDOOR) {
            const room = S.roomMask[y][x];
            // a little per-tile noise so large floors do not read as flat colour
            const n = ((x * 7 + y * 13) % 5) - 2;
            drawIsoTile(pX, pY, room ? shiftColor('#3a2518', n * 5) : shiftColor('#14161c', n * 4), room);
          }
          if (val === TILE.WALL) {
            // Cut away walls standing between the camera and the player: in this
            // projection anything further along x+y is drawn on top of them.
            const ox = x - S.player.x, oy = y - S.player.y;
            const occluding = detailed && ox >= 0 && oy >= 0 && ox + oy > 0 && ox + oy <= 3;
            if (occluding) ctx.globalAlpha = innerAlpha * 0.34;
            drawWallBlock(pX, pY, ZH, pal.t, pal.l, pal.r, false);
            ctx.globalAlpha = innerAlpha;
          } else if (val === TILE.DOOR) {
            drawWallBlock(pX, pY, ZH, 'rgba(255,100,0,0.5)', 'rgba(255,80,0,0.7)', 'rgba(200,50,0,0.8)', true);
            if (detailed) { ctx.font = '18px Arial'; ctx.fillStyle = '#fff'; ctx.fillText('🔒', pX, pY - ZH + 12); }
          } else if (val === TILE.MDOOR) {
            drawWallBlock(pX, pY, ZH, 'rgba(255,50,50,0.5)', 'rgba(200,20,20,0.7)', 'rgba(150,10,10,0.8)', true);
            if (detailed) { ctx.font = '20px Arial'; ctx.fillStyle = '#fff'; ctx.fillText('🔏', pX, pY - ZH + 13); }
          }
          ctx.globalAlpha = 1;
          if (!detailed) continue;

          ctx.font = '24px Arial';
          ctx.fillStyle = '#fff';
          if (val === TILE.COIN) ctx.fillText('🪙', pX, pY + bop);
          else if (val === TILE.KEY) ctx.fillText('🔑', pX, pY + bop);
          else if (val === TILE.MKEY) ctx.fillText('🗝', pX, pY + bop);
          else if (val === TILE.ELEVATOR || val === TILE.MEETING || val === TILE.HR) {
            drawGoalBeacon(pX, pY, val, ready);
          } else if (val === TILE.GPU) {
            ctx.save();
            ctx.shadowColor = '#0f0'; ctx.shadowBlur = 7;
            ctx.fillStyle = '#19d419'; ctx.fillRect(pX - 11, pY - 9 + bop, 22, 11);
            ctx.restore();
            ctx.fillStyle = '#042604'; ctx.font = 'bold 8px Arial';
            ctx.fillText('GPU', pX, pY - 1 + bop);
          } else if (isDesk(val)) {
            const upgraded = (val === TILE.DESK_UP || val === TILE.DESK_UP_SAD);
            const sad = (val === TILE.DESK_SAD || val === TILE.DESK_UP_SAD);
            const z = 15;
            groundShadow(pX, pY, 19);
            ctx.fillStyle = '#1b1b1f';
            ctx.fillRect(pX - 15, pY - z + 5, 4, 15);
            ctx.fillRect(pX + 10, pY - z + 5, 4, 15);
            ctx.beginPath();
            ctx.moveTo(pX, pY - z); ctx.lineTo(pX + 20, pY - z + 10);
            ctx.lineTo(pX, pY - z + 20); ctx.lineTo(pX - 20, pY - z + 10);
            ctx.closePath();
            ctx.fillStyle = '#9b7352'; ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
            // a lit monitor on the desk: green once it has been given a GPU
            ctx.save();
            ctx.shadowColor = upgraded ? '#0f0' : '#39f';
            ctx.shadowBlur = 9;
            ctx.fillStyle = upgraded ? '#0f0' : '#2f6fae';
            ctx.fillRect(pX - 11, pY - z - 6, 16, 9);
            ctx.restore();
            if (upgraded) {
              ctx.fillStyle = '#000'; ctx.font = 'bold 7px Arial';
              ctx.fillText('GPU', pX - 3, pY - z + 1);
            }
            const hop = sad ? 0 : Math.max(0, Math.sin(S.globalTime * 0.25) * 4);
            ctx.font = '24px Arial'; ctx.fillStyle = '#fff';
            ctx.fillText(sad ? '😭' : '👨‍💻', pX, pY - 10 - hop);
          }

          for (const r of S.rivals) {
            if (r.x !== x || r.y !== y) continue;
            groundShadow(pX, pY, 14);
            ctx.font = '24px Arial'; ctx.fillStyle = '#fff';
            ctx.globalAlpha = r.stun > 0 ? 0.55 : 1;
            ctx.fillText(r.stun > 0 ? '💫' : r.state === 'raceHR' ? '🏃‍♂️' : '👺', pX, pY - 5);
            ctx.globalAlpha = 1;
          }

          if (S.player.x === x && S.player.y === y) {
            ctx.save();
            ctx.globalAlpha = (S.player.invuln > 0 && Math.floor(S.globalTime / 4) % 2) ? 0.35 : 1;
            // marker disc: the suit emoji is dark and gets lost among the desks
            ctx.beginPath();
            ctx.ellipse(pX, pY, 18, 9, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,229,255,0.28)'; ctx.fill();
            ctx.strokeStyle = 'rgba(0,229,255,0.95)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 14;
            ctx.font = '36px Arial'; ctx.fillStyle = '#fff';
            ctx.fillText('🕴️', pX, pY - S.player.animY + 3);
            ctx.restore();
          }

          for (const eff of S.slapFx) {
            if (eff.x !== x || eff.y !== y) continue;
            ctx.save();
            ctx.font = (30 + (20 - eff.timer)) + 'px Arial';
            ctx.globalAlpha = eff.timer / 20;
            ctx.fillStyle = '#fff';
            ctx.fillText('🖐️💥', pX, pY - 10 - (20 - eff.timer));
            ctx.restore();
          }
        }
      }
    }

    if (detailed) {
      for (let i = S.particles.length - 1; i >= 0; i--) {
        const p = S.particles[i], age = 40 - p.life;
        const pX = cx0 + (p.x - p.y) * TW / 2 - S.camX + p.vx * age;
        const pY = cy0 + (p.x + p.y) * TH / 2 - S.camY - p.z + p.vy * age - p.vz * age + 0.05 * age * age;
        ctx.globalAlpha = Math.max(0, p.life / 20);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(pX, pY, 3, 0, Math.PI * 2); ctx.fill();
        if (--p.life <= 0) S.particles.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      for (let i = S.texts.length - 1; i >= 0; i--) {
        const t = S.texts[i];
        const pX = cx0 + (t.x - t.y) * TW / 2 - S.camX;
        const pY = cy0 + (t.x + t.y) * TH / 2 - S.camY - 20 - (t.maxLife - t.life);
        ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#000'; ctx.fillText(t.text, pX + 1, pY + 1);
        ctx.fillStyle = t.color; ctx.fillText(t.text, pX, pY);
        if (--t.life <= 0) S.texts.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      for (let i = S.slapFx.length - 1; i >= 0; i--) {
        if (--S.slapFx[i].timer <= 0) S.slapFx.splice(i, 1);
      }
    }

    if (S.buildingAlpha > 0.01) {
      ctx.globalAlpha = S.buildingAlpha;
      drawTowerShell();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (detailed) { drawMinimap(); drawGoalCompass(sx, sy); }

    // vignette keeps the eye on the middle of the floor
    const vg = ctx.createRadialGradient(cx0, cy0, VIEW_H * 0.35, cx0, cy0, VIEW_H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /* ======================= input ======================= */
  const held = { up: false, down: false, left: false, right: false };
  let moveCooldown = 0;

  function updateMovement(dt) {
    moveCooldown -= dt;
    if (moveCooldown > 0) return;
    let dx = 0, dy = 0;
    if (held.up) dy = -1;
    else if (held.down) dy = 1;
    else if (held.left) dx = -1;
    else if (held.right) dx = 1;
    if (!dx && !dy) return;
    const moved = tryMove(dx, dy);
    moveCooldown = moved ? MOVE_MS : MOVE_MS * 1.6;
  }

  const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function setHeld(dir, down) {
    if (!(dir in held)) return;
    if (down && S.state === 'intro') { S.introT = INTRO_DUR; return; }
    held[dir] = down;
    // Step on the press itself. A quick tap can release before the next frame,
    // so waiting for updateMovement() would swallow it entirely.
    if (down && S.state === 'playing' && moveCooldown <= 0) {
      const [dx, dy] = DIR_VEC[dir];
      moveCooldown = tryMove(dx, dy) ? MOVE_MS : MOVE_MS * 1.6;
    }
  }

  const KEY_DIRS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right'
  };

  window.addEventListener('keydown', e => {
    const dir = KEY_DIRS[e.code];
    if (dir) { e.preventDefault(); setHeld(dir, true); return; }
    if (e.code === 'Space' || e.code === 'Enter') {
      if (S.state === 'briefing') { e.preventDefault(); startLevel(); return; }
      if (S.state === 'intro') { S.introT = INTRO_DUR; e.preventDefault(); return; }
      if (S.state === 'playing') { e.preventDefault(); doAction(); }
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); togglePause(); }
    else if (e.code === 'KeyM') toggleOption('music');
    else if (e.code === 'KeyN') toggleOption('sfx');
    else if (e.code === 'KeyV') toggleOption('narration');
    else if (e.code === 'KeyF') toggleFullscreen();
  });

  window.addEventListener('keyup', e => {
    const dir = KEY_DIRS[e.code];
    if (dir) { e.preventDefault(); setHeld(dir, false); }
  });

  window.addEventListener('blur', () => {
    Object.keys(held).forEach(k => { held[k] = false; });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (S.state === 'playing') togglePause(true);
    if (S.state === 'briefing') Narrator.stop();
  });

  // D-pad: pointer events cover mouse, touch and pen with one code path.
  document.querySelectorAll('.touch-btn').forEach(btn => {
    const dir = btn.dataset.dir;
    const press = e => {
      e.preventDefault();
      Audio.init();
      btn.classList.add('active');
      setHeld(dir, true);
      if (btn.setPointerCapture && e.pointerId !== undefined) {
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    };
    const release = e => {
      if (e) e.preventDefault();
      btn.classList.remove('active');
      setHeld(dir, false);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });

  const actionBtn = $('btnAction');
  actionBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    Audio.init();
    actionBtn.classList.add('active');
    if (S.state === 'intro') { S.introT = INTRO_DUR; return; }
    doAction();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    actionBtn.addEventListener(ev, () => actionBtn.classList.remove('active')));

  // Canvas gestures: swipe to step, tap to act.
  let gesture = null;
  canvas.addEventListener('pointerdown', e => {
    Audio.init();
    if (S.state === 'intro') { S.introT = INTRO_DUR; return; }
    gesture = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', e => {
    if (!gesture || S.state !== 'playing') { gesture = null; return; }
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 24) {
      doAction();
    } else if (Math.abs(dx) > Math.abs(dy)) {
      tryMove(dx > 0 ? 1 : -1, 0);
    } else {
      tryMove(0, dy > 0 ? 1 : -1);
    }
    gesture = null;
  });
  canvas.addEventListener('pointercancel', () => { gesture = null; });

  /* ======================= menu & options ======================= */
  function toggleOption(name) {
    options[name] = !options[name];
    store.set('rel_opts', options);
    syncOptionButtons();
    if (name === 'music' && options.music) Audio.init();
    if (name === 'narration') {
      // re-read the mission with the new setting, or fall silent right away
      if (S.state === 'briefing') narrateMission(); else Narrator.stop();
    }
  }

  function syncOptionButtons() {
    const sfx = $('btnSound'), music = $('btnMusic');
    sfx.setAttribute('aria-pressed', String(options.sfx));
    sfx.textContent = options.sfx ? '🔊' : '🔇';
    music.setAttribute('aria-pressed', String(options.music));
    music.textContent = options.music ? '🎵' : '🎶';
    const narration = $('btnNarration');
    narration.setAttribute('aria-pressed', String(options.narration));
    narration.textContent = options.narration ? '🗣️' : '🤐';
  }

  function renderMenu() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < FLOORS; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-btn' + (i <= unlockedLevel ? ' unlocked' : '');
      btn.textContent = i <= unlockedLevel ? String(i + 1) : '🔒';
      if (i <= unlockedLevel) {
        btn.addEventListener('click', () => openBriefing(i, true));
      } else {
        btn.disabled = true;
        btn.title = 'עוד לא פתחת את הקומה הזו';
      }
      frag.appendChild(btn);
    }
    const cont = $('levelSelectCont');
    cont.textContent = '';
    cont.appendChild(frag);

    const list = $('leaderboardList');
    list.textContent = '';
    if (!highScores.length) {
      const li = document.createElement('li');
      li.textContent = 'אין עדיין אלופים. היה הראשון!';
      list.appendChild(li);
    } else {
      highScores.slice(0, 8).forEach((entry, idx) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${idx + 1}. ${entry.name}`;
        const sc = document.createElement('span');
        sc.textContent = `${entry.score} נק'`;
        li.append(name, sc);
        list.appendChild(li);
      });
    }
    $('bestScore').textContent = bestScore;
    $('contLvl').textContent = unlockedLevel + 1;
    $('btnContinue').hidden = unlockedLevel === 0;
  }

  function saveHighScore(rawName) {
    const name = (rawName || '').trim().substring(0, 12) || 'אנונימי';
    highScores.push({ name, score: S.score });
    highScores.sort((a, b) => b.score - a.score);
    highScores = highScores.slice(0, 10);
    store.set('rel_scores', highScores);
    S.scoreSaved = true;
  }

  /* ======================= wiring ======================= */
  $('btnNewCareer').addEventListener('click', () => openBriefing(0, true));
  $('btnContinue').addEventListener('click', () => openBriefing(unlockedLevel, true));
  $('btnGo').addEventListener('click', startLevel);
  $('btnBriefMenu').addEventListener('click', toMenu);
  $('btnNext').addEventListener('click', () => {
    if (S.level >= FLOORS - 1) {
      gameOver('סיימת 100 קומות. הדירקטוריון מינה אותך למנכ"ל, והמשקיעים כבר מתחרטים.', true);
    } else {
      openBriefing(S.level + 1, false);
    }
  });
  $('btnResume').addEventListener('click', () => togglePause(false));
  $('btnRestart').addEventListener('click', startLevel);
  $('btnPauseMenu').addEventListener('click', toMenu);
  $('btnRetry').addEventListener('click', () => { S.score = S.scoreAtStart; startLevel(); });
  $('btnOverMenu').addEventListener('click', toMenu);
  $('btnPause').addEventListener('click', () => togglePause());
  $('btnSound').addEventListener('click', () => toggleOption('sfx'));
  $('btnNarration').addEventListener('click', () => toggleOption('narration'));
  $('btnReplay').addEventListener('click', narrateMission);
  $('btnMusic').addEventListener('click', () => toggleOption('music'));

  $('nameForm').addEventListener('submit', e => {
    e.preventDefault();
    if (S.scoreSaved) return;
    saveHighScore($('nameInput').value);
    $('nameForm').hidden = true;
    renderMenu();
  });

  window.addEventListener('resize', () => showScreen(
    S.state === 'menu' ? 'menu' : S.state === 'briefing' ? 'briefing' :
    S.state === 'clear' ? 'clear' : S.state === 'paused' ? 'paused' :
    S.state === 'over' ? 'over' : null
  ));

  // crisp rendering on high-DPI screens, logical coordinates stay 1000x600
  function setupCanvas() {
    const box = canvas.getBoundingClientRect();
    VIEW_W = Math.max(320, Math.round(box.width || 1000));
    VIEW_H = Math.max(240, Math.round(box.height || 600));
    cx0 = VIEW_W / 2;
    cy0 = VIEW_H / 2;
    sideBrief = VIEW_W >= 900 && VIEW_W / VIEW_H >= 1.25;
    document.body.classList.toggle('wide-brief', sideBrief);
    // cap the backing store so a huge window does not cost 4x the fill rate
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const budget = 3.2e6;
    if (VIEW_W * VIEW_H * dpr * dpr > budget) {
      dpr = Math.max(1, Math.sqrt(budget / (VIEW_W * VIEW_H)));
    }
    canvas.width = Math.round(VIEW_W * dpr);
    canvas.height = Math.round(VIEW_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupCanvas();
  window.addEventListener('resize', setupCanvas);
  window.addEventListener('orientationchange', setupCanvas);
  // the canvas also changes size when the task panel or the pad appears, which
  // fires no resize event of its own
  if (window.ResizeObserver) new ResizeObserver(setupCanvas).observe(canvas);
  document.addEventListener('fullscreenchange', () => {
    setupCanvas();
    $('btnFull').setAttribute('aria-pressed', String(!!document.fullscreenElement));
  });

  // A pointer-only machine has a keyboard, so the thumb pad is just wasted
  // vertical space there.
  if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) {
    document.body.classList.add('no-touch');
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } catch (e) { /* denied or unsupported: nothing to do */ }
  }
  $('btnFull').addEventListener('click', toggleFullscreen);

  /* ======================= main loop ======================= */
  let lastFrame = performance.now();
  let lastShownSecond = -1;

  function frame(now) {
    let dt = now - lastFrame;
    lastFrame = now;
    if (!(dt >= 0)) dt = 16;
    dt = Math.min(dt, 100); // a backgrounded tab must not fast-forward the floor
    S.globalTime += dt / 16.67;

    if (S.state === 'playing') {
      S.timeLeft -= dt / 1000;
      if (S.player.invuln > 0) S.player.invuln -= dt;
      if (S.comboTimer > 0) {
        S.comboTimer -= dt;
        if (S.comboTimer <= 0) { S.combo = 0; refreshStatus(); }
      }
      updateMovement(dt);
      if (S.state === 'playing') updateRivals(dt);

      if (S.timeLeft <= 0) {
        S.timeLeft = 0;
        updateHUD();
        gameOver('הזמן נגמר. המנכ"ל קרא לזה "אי התאמה תרבותית".', false);
      } else {
        const secs = Math.ceil(S.timeLeft);
        if (secs !== lastShownSecond) {
          lastShownSecond = secs;
          if (secs <= 15) Audio.tick();
          updateHUD();
        }
      }
    }

    if (S.state === 'playing' || S.state === 'intro' || S.state === 'briefing') {
      Audio.music(dt, S.state === 'playing' && S.timeLeft <= 20);
    }

    draw(dt);
    requestAnimationFrame(frame);
  }

  // Test seam: lets the headless smoke test validate all 100 floors without
  // having to duplicate the generator.
  window.RelWorld = { buildFloor, distanceField, reachableFrom, TILE, isDesk, FLOORS,
                      state: S, options, BRIEF_OPEN_MS, missionScript, QUOTES,
                      view: () => ({ w: VIEW_W, h: VIEW_H }), towerShot,
                      SHELL_TOP, SHELL_BOT, ZH, TH, LEVELS, activeFloorForLevel };

  /* ======================= boot ======================= */
  syncOptionButtons();
  renderMenu();
  refreshStatus();
  showScreen('menu');
  requestAnimationFrame(frame);

})();
