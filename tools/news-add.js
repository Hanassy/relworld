/* =========================================================================
   Adds one week's mission to src/news.js.

   The weekly loop is deliberately NOT automatic, and that is a decision
   rather than a gap. These missions are satire about named people, written
   the same week the thing happened, published to a public URL under this
   repository's name. Everything up to the taste call can be mechanised; the
   taste call cannot, and nobody wants to find out on a Monday morning that a
   cron job published a joke about a funeral.

   So the loop is: a scheduled workflow opens an issue every Monday, somebody
   (or Claude, asked to) picks the story and writes the mission, and this tool
   does the mechanical half — validate it, slot it in, point the Hebrew.

       node tools/news-add.js draft.json      # add it
       node tools/news-add.js --check         # validate what is already there

   draft.json is one news entry, exactly the shape src/news.js documents:

     { "id": "...", "date": "2026-10-15", "headline": "...", "blurb": "...",
       "source": "...",
       "bulletin": [ { "who": "📺 קריין", "text": "..." }, ... ],
       "level": { "name", "sub", "type", "goal", "goalName", "scene", "era",
                  "text", "q": { "t", "who", "year" } } }

   Leave every `say` and `saySub` out. This tool runs tools/vocalize.js at the
   end, which writes them from the plain text word for word, and fails loudly
   on any word that is not yet in tools/niqqud.json.
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NEWS = path.join(ROOT, 'src/news.js');
const MARKER = /(const REL_NEWS =\n)(\[[\s\S]*?\n\]|\[[\s\S]*?\n {2}\])(;\n)/;

const SCENES = ['office', 'board', 'cinema', 'court', 'lab', 'bank'];
const fail = msg => { console.error(`✗ ${msg}`); process.exit(1); };

/** Everything that would break the game, the tests or the satire notice.
    `draft` is true for a file being added, which must not carry the spoken
    fields yet, and false for an entry already on disk, which must. */
function validate(item, existing, draft) {
  const bad = [];
  const str = (o, k, min) => typeof o[k] === 'string' && o[k].trim().length >= (min || 1);

  for (const k of ['id', 'date', 'headline', 'blurb', 'source']) {
    if (!str(item, k)) bad.push(`missing or empty: ${k}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) bad.push('date must be YYYY-MM-DD');
  if (!/^[a-z0-9-]+$/.test(item.id || '')) bad.push('id must be a lowercase slug');
  // the id is the one thing a save or an analytics event could ever key on
  if (existing.some(n => n.id === item.id)) bad.push(`id "${item.id}" is already used`);

  if (!Array.isArray(item.bulletin) || item.bulletin.length < 2) {
    bad.push('bulletin needs at least an anchor and a reporter');
  } else {
    item.bulletin.forEach((b, i) => {
      if (!str(b, 'who')) bad.push(`bulletin[${i}]: no speaker`);
      if (!str(b, 'text', 10)) bad.push(`bulletin[${i}]: no line to read`);
    });
  }

  const l = item.level || {};
  for (const k of ['name', 'sub', 'goal', 'text']) if (!str(l, k)) bad.push(`level.${k} missing`);
  if (![0, 1, 2].includes(l.type)) bad.push('level.type must be 0, 1 or 2');
  if (!SCENES.includes(l.scene)) bad.push(`level.scene must be one of ${SCENES.join(', ')}`);
  if (!(l.era >= 1900 && l.era <= new Date().getFullYear() + 1)) bad.push('level.era is not a year');
  if (!l.q || !str(l.q, 't') || !str(l.q, 'who')) bad.push('level.q needs a quote and a speaker');
  if (l.q && !(l.q.year >= 1900 && l.q.year <= new Date().getFullYear())) {
    bad.push('level.q.year is not a year that has happened');
  }
  /* The quote is the one thing on the screen presented as somebody's real
     words, so an invented one would be the single genuinely dishonest thing
     in a game that is otherwise openly made up. */
  if (l.q && /^(TODO|תוסיף|חסר)/i.test(l.q.t || '')) bad.push('level.q.t is a placeholder');
  const spoken = [l.say, l.saySub].concat((item.bulletin || []).map(b => b.say));
  if (draft && spoken.some(Boolean)) {
    bad.push('leave say/saySub out of a draft — tools/vocalize.js writes them');
  }
  if (!draft && spoken.some(v => !v)) {
    bad.push('a spoken field is empty — run node tools/vocalize.js');
  }
  return bad;
}

function read() {
  const src = fs.readFileSync(NEWS, 'utf8');
  const m = MARKER.exec(src);
  if (!m) fail('could not find REL_NEWS in src/news.js');
  return { src, m, data: JSON.parse(m[2]) };
}

function main() {
  const arg = process.argv[2];
  const { src, m, data } = read();

  if (!arg || arg === '--check') {
    const bad = [];
    data.forEach((n, i) => validate(n, data.filter((_, j) => j !== i), false)
      .forEach(b => bad.push(`news[${i}] ${b}`)));
    if (bad.length) fail(`${bad.length} problems:\n  ` + bad.join('\n  '));
    console.log(`✓ ${data.length} news missions, all well formed`);
    return;
  }

  const item = JSON.parse(fs.readFileSync(arg, 'utf8'));
  const bad = validate(item, data, true);
  if (bad.length) fail(`draft is not usable:\n  ` + bad.join('\n  '));

  // blanks for the vocaliser to fill, so the shape on disk never varies
  item.level.say = '';
  item.level.saySub = '';
  for (const b of item.bulletin) b.say = '';

  data.unshift(item);                       // newest first on disk as well
  const body = JSON.stringify(data, null, 2);
  fs.writeFileSync(NEWS, src.slice(0, m.index + m[1].length) + body +
                         src.slice(m.index + m[1].length + m[2].length));
  console.log(`✓ added "${item.headline}" (${item.date}) — ${data.length} missions on file`);

  execFileSync('node', [path.join(__dirname, 'vocalize.js')], { stdio: 'inherit' });
  console.log('\nNow run:  node tests/smoke.js');
}

main();
