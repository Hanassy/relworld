/* =========================================================================
   Builds assets/share.png, the 1200x630 card that LinkedIn, WhatsApp and
   Slack show when somebody pastes the link. Without it a share is a grey
   line of text, which is where most of the reach is lost.

   It is a real frame of the game, shot from a real floor, with the title
   laid over it — not a mock-up, so the card never promises something the
   game does not look like.

       node tools/share-image.js
   ========================================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const FLOOR = 3;          // the 1984 Macintosh floor: a full auditorium, reads well small

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
    fs.createReadStream(file).pipe(res);
  });
  return server;
}

(async () => {
  const server = serve();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => !!window.RelWorld);

  // drop into a floor and let the dive-in camera settle on the people
  await page.evaluate(async (floor) => {
    const api = window.RelWorld;
    api.openBriefing(floor, true);
    document.getElementById('btnGo').click();
    await new Promise(r => setTimeout(r, 1800));
    const s = api.state;
    // half the desks upgraded: the floor looks played, not freshly loaded
    let n = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        if (s.map[y][x] === api.TILE.DESK && n++ % 2 === 0) { s.map[y][x] = 13; s.partsGiven++; }
      }
    }
    // the chrome is for playing, not for a poster
    for (const id of ['topBar', 'missionHUD', 'touchControls', 'bottomPanelContainer']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  }, FLOOR);
  await page.waitForTimeout(900);

  const shot = path.join(ROOT, 'assets', 'share-frame.png');
  await page.screenshot({ path: shot });
  await page.close();

  // lay the title over the frame
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const data = 'data:image/png;base64,' + fs.readFileSync(shot).toString('base64');
  await card.setContent(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; position: relative;
           font-family: Arial, Helvetica, sans-serif; background: #04060a; }
    img { position: absolute; inset: 0; width: 1200px; height: 630px; object-fit: cover; }
    .veil { position: absolute; inset: 0;
            background: linear-gradient(90deg, rgba(3,5,10,.96) 0%, rgba(3,5,10,.86) 42%, rgba(3,5,10,.12) 78%); }
    .copy { position: absolute; inset: 0; padding: 64px 72px; display: flex;
            flex-direction: column; justify-content: center; align-items: flex-end; text-align: right; }
    h1 { font-size: 86px; letter-spacing: 6px; color: #19e5ff; direction: ltr;
         text-shadow: 0 0 34px rgba(0,229,255,.55); }
    .sub { font-size: 23px; letter-spacing: 5px; color: #ffc400; direction: ltr; margin-top: 6px; }
    .line { font-size: 35px; color: #eaf2fb; margin-top: 30px; font-weight: bold; }
    .small { font-size: 22px; color: #9fb0c2; margin-top: 14px; line-height: 1.5; }
    .rule { width: 190px; height: 4px; background: #ffc400; margin-top: 30px; border-radius: 2px; }
  </style></head><body>
    <img src="${data}">
    <div class="veil"></div>
    <div class="copy">
      <h1>REL WORLD</h1>
      <div class="sub">A CEO QUEST FOR GLORY</div>
      <div class="line">משחק סאטירה על הדרך למנכ&quot;לות</div>
      <div class="small">110 קומות. כל אחת מבוססת על סיפור אמיתי<br>ונגמרת בציטוט אמיתי והזוי.</div>
      <div class="rule"></div>
    </div>
  </body></html>`);
  await card.waitForTimeout(400);
  await card.screenshot({ path: path.join(ROOT, 'assets', 'share.png') });

  fs.unlinkSync(shot);
  await browser.close();
  server.close();
  console.log('wrote assets/share.png (1200x630)');
})();
