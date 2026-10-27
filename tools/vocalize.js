/* =========================================================================
   Generates the SPOKEN half of everything the narrator reads: the missions in
   src/levels.js, the news missions and bulletins in src/news.js, and the
   closing quote on every floor.

   Each level holds two strings. `text` (and `sub`) is plain, correctly spelled
   Hebrew — that is what a player reads. `say` (and `saySub`) is the same words
   with vowel points, and that is the only thing the speech engine is given.
   This tool writes the second from the first, word for word, so the two always
   have the same number of words and the read-along can light up the correct
   spelling while the voice pronounces the phonetic one. `text` is never
   touched.

   The points are NOT grammar. They are a pronunciation score for the browser's
   Hebrew speech engine, which reads the briefing out loud, and they follow one
   rule: write the vowel you actually hear.

     - no shva, ever. The engine swallows it, so a shva becomes the vowel it
       sounds like: the prefixes ל ב כ ו take tzere (lesham, not lasham), and
       a word's own opening consonant takes patach (mankal, not menakal).
     - no kamatz in a closed syllable, where the engine may read it /o/ —
       patach there instead. That is why כל is spelled כּוֹל and צנחה is צַנחָה.
     - a letter that is heard is written, and one that is not is dropped:
       hence כול with a vav and צ'פחות without the alef.

   Missions are STRICT and quotes are SOFT, and the difference is on purpose.
   We write the missions, so a word the list does not know is a mistake and
   fails the run. A quote is somebody else's sentence, reproduced verbatim,
   full of surnames and words that appear once in the whole game — making
   those fail would mean every new quote blocks CI until someone points a
   surname. So a quote takes whatever the list knows, leaves the rest as
   written (which is what the engine got before any of this existed, so it is
   never worse), and the run prints the coverage.

   The word list lives in tools/niqqud.json, one entry per word, so a word that
   comes out wrong is fixed once and every mission using it follows. Run:

       node tools/vocalize.js          # regenerates say/saySub in src/levels.js
       node tools/vocalize.js --check  # fails if they are stale or misaligned

   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEVELS = path.join(ROOT, 'src/levels.js');
const NEWS = path.join(ROOT, 'src/news.js');
const DICT = JSON.parse(fs.readFileSync(path.join(__dirname, 'niqqud.json'), 'utf8'));

const NIQQUD = /[֑-ׇ]/g;
// A word is a run of Hebrew letters, keeping the geresh of צ', the hyphen of
// דיסק-און-קי and the gershayim of מנכ"ל inside the token. Split on the
// gershayim, that trailing ל was read as the preposition "le".
const WORD = new RegExp(
  // an acronym: two or more letters, the gershayim, then its tail
  "[\u0590-\u05FF'\u05F3\u2019-]{2,}[\"\u05F4][\u0590-\u05FF]{1,4}(?![\u0590-\u05FF])"
  // or an ordinary word
  + "|[\u0590-\u05FF'\u05F3\u2019-]+", 'g');
const HEBREW = /[֐-׿]/;

const bare = s => s.replace(NIQQUD, '');

/* Some entries change the spelling as well as the points — כל becomes כּוֹל and
   צ'אפחות loses its alef — so after one pass the text no longer contains the
   word the list is keyed on. Each result is registered as its own key, which
   makes running the tool twice a no-op. */
for (const pointed of Object.values(DICT)) {
  const key = bare(pointed);
  if (!DICT[key]) DICT[key] = pointed;
}

/** Reorders an object's keys, and refuses to lose one. Rewriting a data file
    through a fixed key list is convenient and quietly destructive: anything
    the list has not heard of disappears. Every field is accounted for here,
    so a new one fails the run instead of vanishing from the game. */
function pickAll(obj, order, label) {
  const out = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  const lost = Object.keys(obj).filter(k => out[k] === undefined && obj[k] !== undefined);
  if (lost.length) {
    throw new Error(`${label}: ${lost.join(', ')} would be dropped — add to the key order in ` +
                    'tools/vocalize.js (this is how goalIcon was lost once)');
  }
  return out;
}

/** Points one string. Returns the text plus any word the list does not know. */
function vocalize(text) {
  const unknown = [];
  let total = 0;
  const out = bare(text).replace(WORD, w => {
    if (!HEBREW.test(w)) return w;
    total++;
    if (DICT[w]) return DICT[w];
    unknown.push(w);
    return w;
  });
  return { out, unknown, total };
}

const unknown = new Set();
/* Quotes are verbatim: real sentences by real people, full of proper nouns and
   words that appear once in the whole game. Treating a missing word there as a
   build failure would mean every new quote blocks CI until someone points a
   surname. So they are soft: whatever the list knows gets pointed, the rest
   passes through unchanged, and the run reports the coverage instead of dying.
   Mission text stays strict — we write that ourselves, so there is no excuse. */
const softUnknown = new Set();
let softWords = 0, softHits = 0;
const misaligned = [];
const words = t => (String(t).match(/\S+/g) || []).length;
let changed = 0;

/** The closing quote is read out loud at the end of every floor, speaker and
    year included, so it needs the same treatment as the mission: the correct
    spelling on screen, the phonetic one in the mouth. showQuote already reads
    sayT/sayWho when they are there. */
function quote(q, label) {
  if (!q) return;
  pair(q, 't', 'sayT', `${label}.t`, true);
  pair(q, 'who', 'sayWho', `${label}.who`, true);
}

/** Points one plain/spoken pair in place, and records anything wrong with it.
    Every string the narrator reads goes through here, whether it belongs to a
    career floor, a news mission or a line in a news bulletin. */
function pair(obj, plain, spoken, label, soft) {
  if (obj[plain] === undefined) return;
  const r = vocalize(obj[plain]);
  if (soft) {
    r.unknown.forEach(w => softUnknown.add(w));
    softWords += r.total;
    softHits += r.total - r.unknown.length;
  } else {
    r.unknown.forEach(w => unknown.add(w));
  }
  if (r.out !== obj[spoken]) changed++;
  obj[spoken] = r.out;
  // the read-along maps word N of one onto word N of the other, so a mismatch
  // here would silently light up the wrong word
  if (words(obj[plain]) !== words(obj[spoken])) {
    misaligned.push(`${label}: ${words(obj[plain])} shown vs ${words(obj[spoken])} spoken`);
  }
}

/** Reads one data file, points everything a narrator will read in it, and
    hands back the source with the array re-serialised in its place. */
function processFile(file, marker, order, walk) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`(const ${marker} =\\n)(\\[[\\s\\S]*?\\n\\]|\\[[\\s\\S]*?\\n {2}\\])(;\\n)`);
  const m = re.exec(src);
  if (!m) throw new Error(`could not find ${marker} in ${path.basename(file)}`);
  const data = JSON.parse(m[2]);
  data.forEach(walk);
  return { src, m, data };
}

function main() {
  const check = process.argv.includes('--check');
  const lv = processFile(LEVELS, 'REL_LEVELS', [], (level, i) => {
    pair(level, 'text', 'say', `L${i + 1}.text`);
    pair(level, 'sub', 'saySub', `L${i + 1}.sub`);
    quote(level.q, `L${i + 1}.q`);
  });
  const data = lv.data, src = lv.src, m = lv.m;

  /* The news file holds the same mission shape plus the broadcast that comes
     before it, so the anchor and the reporter are pointed too. */
  const news = processFile(NEWS, 'REL_NEWS', ['id', 'date', 'headline', 'blurb', 'source', 'bulletin'],
    (item, i) => {
      pair(item.level, 'text', 'say', `N${i + 1}.text`);
      pair(item.level, 'sub', 'saySub', `N${i + 1}.sub`);
      (item.bulletin || []).forEach((b, j) => pair(b, 'text', 'say', `N${i + 1}.bulletin[${j}]`));
      // the twist is shouted on screen and the outro is read on the clear
      // screen, so both are narrated and both need the phonetic half
      if (item.level.twist) {
        pair(item.level.twist, 'announce', 'sayAnnounce', `N${i + 1}.twist`);
      }
      if (item.level.outro) pair(item.level.outro, 'text', 'say', `N${i + 1}.outro`);
      quote(item.level.q, `N${i + 1}.q`);
    });

  if (misaligned.length) {
    console.error(`${misaligned.length} missions do not line up word for word:`);
    console.error('  ' + misaligned.slice(0, 5).join('\n  '));
    process.exit(1);
  }

  if (unknown.size) {
    console.error(`${unknown.size} words are missing from tools/niqqud.json:`);
    console.error('  ' + [...unknown].join(' '));
    process.exit(1);
  }
  const cover = softWords ? Math.round((softHits / softWords) * 100) : 100;
  console.log(`quotes: ${cover}% of their words are pointed ` +
              `(${softUnknown.size} still unlisted — they are read as written)`);

  if (check) {
    console.log(changed
      ? `${changed} spoken fields are stale — run node tools/vocalize.js`
      : `all ${data.length + news.data.length} missions have an up-to-date, word-aligned spoken half`);
    process.exit(changed ? 1 : 0);
  }

  /* The key order a level is written back in. It is also, dangerously, a
     whitelist: a field missing from this list used to be dropped on the next
     run without a word, which is how the car mission lost its `goalIcon` and
     spent a release showing the HR lawyer at the goal. `pick` now refuses to
     drop anything instead. */
  const ORDER = ['name', 'sub', 'saySub', 'type', 'goal', 'goalName', 'goalIcon',
                 'scene', 'era', 'avatar', 'text', 'say', 'twist', 'outro', 'q'];
  // and the quote's own keys, for the same reason ORDER exists
  const Q_ORDER = ['t', 'sayT', 'who', 'sayWho', 'year'];
  const ordered = data.map((l, i) => {
    const o = pickAll(l, ORDER, `L${i + 1}`);
    if (o.q) o.q = pickAll(o.q, Q_ORDER, `L${i + 1}.q`);
    return o;
  });
  let body = JSON.stringify(ordered, null, 2)
    .split('\n').map(line => (line.trim() ? '  ' + line : line)).join('\n').replace(/^ {2}/, '');
  fs.writeFileSync(LEVELS, src.slice(0, m.index + m[1].length) + body + src.slice(m.index + m[1].length + m[2].length));

  const NEWS_ORDER = ['id', 'date', 'headline', 'blurb', 'source', 'bulletin', 'level'];
  const nbody = JSON.stringify(news.data.map((n, i) => {
    const o = pickAll(n, NEWS_ORDER, `N${i + 1}`);
    o.level = pickAll(n.level, ORDER, `N${i + 1}.level`);
    if (o.level.q) o.level.q = pickAll(o.level.q, Q_ORDER, `N${i + 1}.level.q`);
    return o;
  }), null, 2);
  fs.writeFileSync(NEWS, news.src.slice(0, news.m.index + news.m[1].length) + nbody +
                         news.src.slice(news.m.index + news.m[1].length + news.m[2].length));
  console.log(`vocalised ${data.length} missions and ${news.data.length} news bulletins ` +
              `(${changed} spoken fields rewritten)`);
}

main();
