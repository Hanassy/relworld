/* =========================================================================
   The one file that knows about the company. Edit this; nothing else.

   The credit is deliberately quiet. It appears in two places — the bottom of
   the main menu, and the end of a career — and nowhere during play. The game
   should read as a game that somebody made, not as an advertisement with a
   game attached: a player who feels sold to does not share the link, and the
   sharing is the whole point.
   ========================================================================= */
(function () {
  'use strict';

  const BRAND = {
    name: 'HanassyRnD',
    tagline: 'פיתוח מערכות משובצות AI',
    url: 'https://hanassy.com/',
    /* A stand-in until the real mark is dropped in. Replace with
       `logoImg: 'assets/logo.svg'` and it is used instead of the glyph. */
    logo: '💡',
    logoImg: '',

    /* Where this copy of the game lives. Used for the share button and for
       the link card, so change it if the game moves off GitHub Pages. */
    shareUrl: 'https://hanassy.github.io/relworld/',

    /* Tagged so the visits that came from the game are tellable apart from
       the ones that came from the post about the game. */
    utm: 'utm_source=relworld&utm_medium=game',

    /* Cookie-free analytics, inert until configured. Fill in a script URL and
       its data- attributes (Cloudflare Web Analytics, Plausible, Umami — they
       all work this way) and it loads; leave src empty and nothing is sent
       anywhere, which is the default.

       `events` additionally reports a handful of counts — a career started, a
       floor cleared and which one, how far a career got, a share, a click on
       the credit. That is what answers "did the post work and did anyone play
       past floor three"; plain page views cannot. No personal data is in any
       of them, and they are silent unless a provider is actually loaded.
       Cloudflare's free tier does not take custom events — pick Umami or
       Plausible if the drop-off curve is what you are after. */
    analytics: { src: '', attrs: {}, events: true }
  };

  /** The brand URL with the campaign tag, so clicks are attributable. */
  BRAND.link = function (where) {
    const sep = BRAND.url.indexOf('?') >= 0 ? '&' : '?';
    return `${BRAND.url}${sep}${BRAND.utm}&utm_content=${encodeURIComponent(where || 'game')}`;
  };

  /* The satire notice. The floors are built on documented events and the
     closing quotes are real, which is exactly why the rest has to be marked
     as invented — a player should never take a mission for reporting. */
  BRAND.disclaimerShort = 'סאטירה. האירועים שברקע אמיתיים — המשימות, הדמויות והעלילה אינן.';
  BRAND.disclaimerFull =
    'REL WORLD הוא משחק סאטירי. כל קומה נשענת על אירוע מתועד מתולדות ההיי-טק, ' +
    'והציטוט שבסופה מובא ממקור אמיתי — ציטוט מיוחס, משוחזר או שנוי במחלוקת מסומן ככזה. ' +
    'המשימות, הדמויות, העלילה וההתנהגות המתוארת בהן בדיוניות לחלוטין ונכתבו כבדיחה. ' +
    'כל קשר בינן לבין אנשים, חברות או אירועים אמיתיים הוא מקרי בהחלט, ואין בהן כדי לתאר ' +
    'התנהלות אמיתית של אף אדם או גוף. שמות חברות ומוצרים הם סימני מסחר של בעליהם ומוזכרים ' +
    'לשם פרודיה ופרשנות בלבד; המשחק אינו מסונף לאיש מהם ואינו נתמך על ידם.';

  if (typeof module !== 'undefined' && module.exports) module.exports = BRAND;
  if (typeof window !== 'undefined') window.REL_BRAND = BRAND;
})();
