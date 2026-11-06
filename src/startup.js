/* =========================================================================
   REL WORLD — הסטארטאפ שלך. The meta-layer between floors.

   The premise: the tower is unbearable, so from floor two you are also
   building something of your own in a garage. Money earned on a floor buys
   parts; enough parts of one era assemble into a product; a finished product
   makes the NEXT floors easier. That last word matters —

     PRODUCTS GRANT ADVANTAGES, NEVER PERMISSION.

   No floor may ever become unplayable because the shop was ignored. A player
   who never opens it finishes all 110; a player who uses it feels clever.
   The alternative — a part the company cannot source, so the floor is locked
   until your startup has built it — reads better on paper and turns an
   optional system into a mandatory second game, with a wall for anyone who
   spent their money elsewhere. There is a test that fails if any perk ever
   becomes a requirement.

   Everything here is pinned to the hardware ladder in src/levels.js, so the
   chronology takes care of itself: a 1984 garage cannot buy an SSD, and the
   console you build in the eighties is a console, not a phone. `from` is the
   year a part becomes purchasable, and it is the REL_TECH year wherever the
   part IS that rung.

   Prices are in ₪ and are deliberately coarse. The fund earns roughly 400-900
   a floor, so an era's product costs about three floors of saving: often
   enough to feel like progress, rarely enough to buy everything at once.
   ========================================================================= */
(function () {
  'use strict';

  /* The space you work in. It grows with everything you have ever bought, not
     with what you currently own, so upgrading never feels like a punishment
     for having spent. `slots` is how many things the room can show at once. */
  const SPACES = [
    { id: 'garage', name: 'גראז\'', from: 0, slots: 6, cols: 3 },
    { id: 'office', name: 'משרד', from: 3000, slots: 10, cols: 5 },
    { id: 'floor', name: 'קומה משלך', from: 9000, slots: 15, cols: 5 },
    { id: 'tower', name: 'בניין', from: 20000, slots: 20, cols: 5 }
  ];

  /* What the shop sells. `from` keeps a part out of the catalogue until its
     year, so the garage fills up in the order history actually happened. */
  const PARTS = [
    { id: 'bench', from: 0, price: 300, icon: '🧰', name: 'שולחן עבודה' },
    { id: 'solder', from: 0, price: 350, icon: '🔌', name: 'מלחם ורכיבים' },
    { id: 'crt', from: 1977, price: 600, icon: '📺', name: 'מסך CRT' },
    { id: 'pc', from: 1981, price: 900, icon: '💻', name: 'מחשב אישי' },
    { id: 'chip', from: 1981, price: 800, icon: '🔲', name: 'שבב מותאם' },
    { id: 'floppy', from: 1983, price: 450, icon: '💾', name: 'כונן תקליטונים' },
    { id: 'hdd', from: 1985, price: 1100, icon: '🗄️', name: 'דיסק קשיח' },
    { id: 'modem', from: 1990, price: 950, icon: '☎️', name: 'מודם' },
    { id: 'optics', from: 1990, price: 1300, icon: '🔭', name: 'עדשות ואופטיקה' },
    { id: 'cd', from: 1996, price: 700, icon: '💿', name: 'צורב' },
    { id: 'server', from: 1999, price: 2200, icon: '🖥️', name: 'שרת' },
    { id: 'lcd', from: 2004, price: 1400, icon: '🖼️', name: 'מסך שטוח' },
    { id: 'ssd', from: 2007, price: 1500, icon: '⚡', name: 'כונן SSD' },
    { id: 'rack', from: 2010, price: 3200, icon: '🗃️', name: 'ארון שרתים' },
    { id: 'gpu', from: 2017, price: 4000, icon: '🟩', name: 'כרטיס GPU' },
    { id: 'h100', from: 2022, price: 7000, icon: '🧠', name: 'מאיץ H100' }
  ];

  /* The products. Each one assembles itself the moment you own its parts —
     there is no build button, because a build button is a second click that
     teaches nothing. `perk` is what it changes on every later floor, and each
     one is a single number applied at floor start; see applyPerks in game.js.

     `was` is the real thing it is a joke about, shown in the shop, because the
     chronology is the point: the console really is 1977-1983, and the first
     VR headsets really did arrive before the web did. */
  const PRODUCTS = [
    {
      id: 'console', from: 1981, name: 'קונסולת משחקים', icon: '🕹️',
      needs: ['bench', 'solder', 'crt', 'chip'],
      perk: { kind: 'time', value: 30 },
      blurb: 'ארבעה משחקים, שלושה מהם אותו משחק.',
      was: 'עידן ה-Atari 2600 וה-ColecoVision, 1977–1983'
    },
    {
      id: 'vr', from: 1990, name: 'קסדת VR', icon: '🥽',
      needs: ['pc', 'optics', 'crt'],
      perk: { kind: 'masterKey' },
      blurb: 'שדה ראייה מלא, שלוש פריימים בשנייה.',
      was: 'ה-Virtuality 1000 ו-Sega VR, תחילת שנות התשעים'
    },
    {
      id: 'bbs', from: 1990, name: 'שירות מקוון', icon: '📡',
      needs: ['modem', 'hdd'],
      perk: { kind: 'key', value: 1 },
      blurb: 'תפוס. נסה שוב בעוד שעה.',
      was: 'ה-BBS, ואחריו AOL ו-CompuServe'
    },
    {
      id: 'search', from: 1999, name: 'מנוע חיפוש', icon: '🔎',
      needs: ['server', 'cd'],
      perk: { kind: 'compass' },
      blurb: 'מוצא הכל חוץ ממה שחיפשת.',
      was: 'AltaVista, ואז מי שבא אחריה'
    },
    {
      id: 'saas', from: 2010, name: 'מוצר בענן', icon: '☁️',
      needs: ['rack', 'ssd', 'lcd'],
      perk: { kind: 'shield' },
      blurb: 'תשעים ותשע נקודה תשע אחוז זמינות, בחודש טוב.',
      was: 'עשור ה-SaaS: Salesforce, ואז כולם'
    },
    {
      id: 'model', from: 2022, name: 'מודל שפה', icon: '🧠',
      needs: ['gpu', 'h100', 'rack'],
      perk: { kind: 'slowRivals', value: 1.3 },
      blurb: 'בטוח מאוד בתשובה. התשובה שגויה.',
      was: 'עידן ה-LLM, מ-2022 והלאה'
    }
  ];

  /** Everything purchasable in a given year: the catalogue grows with the
      career instead of showing a 2022 accelerator to a 1981 garage. */
  function catalogueFor(era) {
    return PARTS.filter(p => era >= p.from);
  }

  /** The space a total spend has earned. Always the largest one reached. */
  function spaceFor(spent) {
    let s = SPACES[0];
    for (const sp of SPACES) if (spent >= sp.from) s = sp;
    return s;
  }

  /** Which products are finished, given a set of owned part ids. */
  function builtFrom(owned) {
    const have = new Set(owned);
    return PRODUCTS.filter(p => p.needs.every(n => have.has(n)));
  }

  const REL_STARTUP = { SPACES, PARTS, PRODUCTS, catalogueFor, spaceFor, builtFrom };

  if (typeof module !== 'undefined' && module.exports) module.exports = REL_STARTUP;
  if (typeof window !== 'undefined') window.REL_STARTUP = REL_STARTUP;
})();
