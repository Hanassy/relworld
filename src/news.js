/* =========================================================================
   REL WORLD — חדשות מתפרצות. One mission a week, built on whatever actually
   happened in tech that week.

   These are NOT career floors. The tower is 110 floors and stays 110 floors:
   a news mission is picked from the panel on the main menu, played on its own,
   and never moves the career counter. That keeps the ladder, the save file and
   LEVELS.md stable no matter how many weeks go by.

   Each entry is:
     id        stable slug, never reused — the one thing a save could key on
     date      the day the story broke, ISO, shown in the panel and sorted on
     headline  what the panel shows, and what the anchor reads first
     blurb     one line under it, so you can pick a mission by what it is about
     source    what really happened, in one line. This is the real part.
     bulletin  the broadcast before the briefing: anchor, reporter, anchor.
               `text` is read on screen, `say` is the phonetic half, same rule
               as a mission (see tools/vocalize.js).
     level     an ordinary level object. Same shape as src/levels.js, same
               fields, same type numbers — it goes through the same machinery.

   The satire rule from levels.js applies here and applies harder, because the
   story is this week's and the people in it are reading the news too: the
   event in `source` is real and the closing quote is real, which is exactly
   why the mission, the plot and the behaviour in it are invented.

   To add this week's: node tools/news-add.js (see the header there).
   ========================================================================= */
(function () {
  'use strict';

  const REL_NEWS =
[
  {
    "id": "tesla-roadster-flight-2026-10",
    "date": "2026-10-15",
    "headline": "טסלה חשפה מכונית מעופפת",
    "blurb": "ה-Roadster קפץ, ריחף ונחת. הצוות שבנה אותו עמד בצד.",
    "source": "ב-15 באוקטובר 2026 חשפה טסלה במתקן של SpaceX בוואקו, טקסס, אב-טיפוס של ה-Roadster שממריא על סילוני אוויר. מאסק קרא לזה מכונית מעופפת; ייצור הובטח ל-2028.",
    "bulletin": [
      {
        "who": "📺 קריין",
        "text": "ערב טוב, ואנחנו פותחים בשידור מיוחד. בטקסס הסתיימה הרגע חשיפה שאיש לא האמין שתגיע: מכונית ספורט שעולה באוויר על סילונים.",
        "say": "עֶרֶב טוֹב, וַאֲנַחנוּ פּוֹתחִים בֵּשִׁידוּר מֵיוּחַד. בֵּטֵקסַס הִסתַיימָה הָרֶגַע חֲשִׂיפָה שֵׁאִישׁ לֹא הֵאֵמִין שֵׁתַגִיעַ: מֵכוֹנִית ספּוֹרט שֵׁעוֹלָה בָּאֲווִיר עַל סִילוֹנִים."
      },
      {
        "who": "🎤 כתב בשטח",
        "text": "המכונית קפצה, ריחפה שלוש שניות ונחתה. הקהל השתגע. צוות המכונאים שבנה אותה עמד בצד, והמנכ\"ל כבר עלה לבמה לבדו.",
        "say": "הַמֵכוֹנִית קָפצָה, רִיחֲפָה שָׁלוֹשׁ שׁנִיוֹת וֵנָחֲתָה. הַקָהַל הִשׁתַגֵעַ. צֶווֶת הַמֵכוֹנָאִים שֶׁבָּנָה אוֹתָה עָמַד בַּצַד, וֵהַמַנכָּ\"ל כּבָר עָלָה לַבָּמָה לֵבַדוֹ."
      },
      {
        "who": "📺 קריין",
        "text": "ומכאן זה כבר עניין של קרדיט. חוזרים אליך, לקומה.",
        "say": "וּמִכָּאן זֶה כּבָר עִניָין שֶׁל קרֵדִיט. חוֹזרִים אֵלֵיךָ, לַקוֹמָה."
      }
    ],
    "level": {
      "name": "מי הרים את המכונית",
      "sub": "אילון רוצה את כל הקרדיט",
      "saySub": "אִילוֹן רוֹצֶה אֶת כּוֹל הַקרֵדִיט",
      "type": 2,
      "goal": "הבמה",
      "goalName": "הבמה 🎤",
      "scene": "cinema",
      "era": 2026,
      "text": "צוות המכונאים הגיע לפריצת דרך: המכונית מרחפת. הם הכינו מצגת מרשימה, אבל אילון לא מסופק — הוא רוצה את הבמה ואת כל הקרדיט. עקוף את ראש הצוות, נעל אותו מאחורי דלת, והגע למכונית ראשון. חלק צ'אפחות הצלחה לכל העובדים עד שיבינו מי המנהל כאן.",
      "say": "צֶווֶת הַמֵכוֹנָאִים הִגִיעַ לִפרִיצַת דֵרֶך: הַמֵכוֹנִית מֵרַחֶפֶת. הֵם הֵכִינוּ מַצֶגֶת מַרשִׁימָה, אַבָל אִילוֹן לֹא מֵסוּפַּק — הוּא רוֹצֶה אֶת הַבָּמָה וֵאֶת כּוֹל הַקרֵדִיט. עֲקוֹף אֶת רֹאשׁ הַצֶווֶת, נֵעַל אוֹתוֹ מֵאַחוֹרֵי דֶלֶת, וֵהַגַע לַמֵכוֹנִית רִאשׁוֹן. חַלֵק צַ'פּחוֹת הַצלָחָה לֵכוֹל הָעוֹבדִים עַד שֶׁיָבִינוּ מִי הַמֵנַהֵל כָּאן.",
      "q": {
        "t": "זו לא בהכרח מכונית ממוטבת לבטיחות.",
        "who": "אילון מאסק, על ה-Roadster המעופף (כפי שדווח)",
        "year": 2026
      }
    }
  }
];

  if (typeof module !== 'undefined' && module.exports) module.exports = REL_NEWS;
  if (typeof window !== 'undefined') window.REL_NEWS = REL_NEWS;
})();
