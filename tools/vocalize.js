/* =========================================================================
   Generates the SPOKEN half of every mission in src/levels.js.

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

/** Points one string. Returns the text plus any word the list does not know. */
function vocalize(text) {
  const unknown = [];
  const out = bare(text).replace(WORD, w => {
    if (!HEBREW.test(w)) return w;
    if (DICT[w]) return DICT[w];
    unknown.push(w);
    return w;
  });
  return { out, unknown };
}

function main() {
  const check = process.argv.includes('--check');
  const src = fs.readFileSync(LEVELS, 'utf8');
  const m = /(const REL_LEVELS =\n)(\[[\s\S]*?\n {2}\])(;\n)/.exec(src);
  if (!m) throw new Error('could not find the level data in src/levels.js');
  const data = JSON.parse(m[2]);

  const unknown = new Set();
  const misaligned = [];
  const words = t => (String(t).match(/\S+/g) || []).length;
  let changed = 0;
  data.forEach((level, i) => {
    for (const [plain, spoken] of [['text', 'say'], ['sub', 'saySub']]) {
      const r = vocalize(level[plain]);
      r.unknown.forEach(w => unknown.add(w));
      if (r.out !== level[spoken]) changed++;
      level[spoken] = r.out;
      // the read-along maps word N of one onto word N of the other, so a
      // mismatch here would silently light up the wrong word
      if (words(level[plain]) !== words(level[spoken])) {
        misaligned.push(`L${i + 1}.${plain}: ${words(level[plain])} shown vs ${words(level[spoken])} spoken`);
      }
    }
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
  if (check) {
    console.log(changed
      ? `${changed} spoken fields are stale — run node tools/vocalize.js`
      : `all ${data.length} missions have an up-to-date, word-aligned spoken half`);
    process.exit(changed ? 1 : 0);
  }

  const ORDER = ['name', 'sub', 'saySub', 'type', 'goal', 'goalName', 'scene',
                 'era', 'avatar', 'text', 'say', 'q'];
  const ordered = data.map(l => {
    const o = {};
    for (const k of ORDER) if (l[k] !== undefined) o[k] = l[k];
    return o;
  });
  let body = JSON.stringify(ordered, null, 2)
    .split('\n').map(line => (line.trim() ? '  ' + line : line)).join('\n').replace(/^ {2}/, '');
  fs.writeFileSync(LEVELS, src.slice(0, m.index + m[1].length) + body + src.slice(m.index + m[1].length + m[2].length));
  console.log(`vocalised ${data.length} missions (${changed} spoken fields rewritten)`);
}

main();
