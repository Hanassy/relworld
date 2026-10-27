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
               as a mission (see tools/vocalize.js). Each entry is one CUT:
               the caption changes with it and `who` names the speaker in the
               lower third. The emoji at the head of `who` is the role badge
               worn on the figure's shoulder, not the figure itself.
               `shots` is what appears on the screen over their shoulder while
               they talk — [icon, label] pairs that cycle every ~2s, so the
               thing being described is the thing on the wall. Name the people
               the story is about: that is what the screen is for.
     level     an ordinary level object. Same shape as src/levels.js, same
               fields, same type numbers — it goes through the same machinery,
               plus two fields a career floor never has:

       twist   the thing this mission does that the tower cannot, and the
               reason it is worth a week instead of being floor 111 with a red
               border. Reaching the first goal hands you the thing, turns you
               into it (`avatar`), and moves the goal to the far side of the
               floor (`goal`, `goalName`), with `bonus` seconds added because
               the second half is a different journey. `announce` is shouted
               at the moment it happens. Required.
       outro   the closing line, read out on the clear screen before the real
               quote. The joke; the quote is the true part. Required.

   The satire rule from levels.js applies here and applies harder, because the
   story is this week's and the people in it are reading the news too: the
   event in `source` is real and the closing quote is real, which is exactly
   why the mission, the plot and the behaviour in it are invented.

   And the aim is narrower than "satire". The joke should be one the people
   who made the news would laugh at — funny, a little true, and gentle. It is
   about the situation, never about anybody's competence or character, and it
   accuses nobody of anything. Where reporting conflicts, `source` says so
   rather than picking the version that makes the better story.

   To add this week's: node tools/news-add.js (see the header there).
   ========================================================================= */
(function () {
  'use strict';

  const REL_NEWS =
[
  {
    "id": "tesla-roadster-flight-2026-10",
    "date": "2026-10-15",
    "headline": "טסלה הקפיצה את ה-Roadster לאוויר",
    "blurb": "סילוני גז קר, גלגול באוויר, נחיתה. ואז התחיל הוויכוח מי נוסע ראשון.",
    "source": "ב-15 באוקטובר 2026 הציגה טסלה בטקסס את ה-Roadster מדור שני, שמזנק לאוויר ומסתובב על סילוני גז קר של SpaceX. יעד הייצור שהוכרז הוא 2028, ולרכב אין אישור לנסיעה בכביש. פרטי ההדגמה — המקום המדויק והנתונים — דווחו בגרסאות שונות.",
    "bulletin": [
      {
        "who": "📺 קריין",
        "text": "ערב טוב. אילון מאסק הקפיץ היום בטקסס מכונית ספורט לאוויר, היא הסתובבה סביב עצמה ונחתה על הגלגלים. עד כאן החלק המתוכנן.",
        "say": "עֶרֶב טוֹב. אִילוֹן מַסק הִקפִּיץ הַיוֹם בֵּטֵקסַס מֵכוֹנִית ספּוֹרט לָאֲוִיר, הִיא הִסתוֹבּבָה סָבִיב עַצמָה וֵנָחֲתָה עַל הַגַלגַלִים. עַד כָּאן הַחֵלֶק הַמֵתוּכנָן.",
        "shots": [
          [
            "🚗",
            "ה-Roadster"
          ],
          [
            "🧑‍🦱",
            "אילון מאסק"
          ],
          [
            "🔥",
            "סילוני גז קר"
          ]
        ]
      },
      {
        "who": "🎤 כתב בשטח",
        "text": "אחרי הנחיתה כל הצוות עמד סביב המכונית, ואז מישהו שאל מי נוסע בה ראשון. אני עדיין פה. הוויכוח עדיין נמשך.",
        "say": "אַחֲרֵי הַנחִיתָה כּוֹל הַצֶוֶת עָמַד סָבִיב הַמֵכוֹנִית, וֵאָז מִישֶׁהוּ שָׁאַל מִי נוֹסֵעַ בָּה רִאשׁוֹן. אֲנִי עֲדַיִין פֹּה. הַוִיכּוּחַ עֲדַיִין נִמשָׁך.",
        "shots": [
          [
            "🛬",
            "אחרי הנחיתה"
          ],
          [
            "🧑‍🔧",
            "הצוות"
          ],
          [
            "🗝️",
            "מי ראשון?"
          ]
        ]
      },
      {
        "who": "📺 קריין",
        "text": "אז המכונית עפה, והאנשים תקועים. חוזרים אליך, לקומה.",
        "say": "אָז הַמֵכוֹנִית עָפָה, וֵהָאֲנָשִׁים תקוּעִים. חוֹזרִים אֵלֵיךָ, לַקוֹמָה.",
        "shots": [
          [
            "🏁",
            "המסלול"
          ],
          [
            "🏢",
            "חזרה לקומה"
          ]
        ]
      }
    ],
    "level": {
      "name": "מי נוסע ראשון",
      "sub": "קח את המכונית, רוץ איתה למסלול",
      "saySub": "קַח אֶת הַמֵכוֹנִית, רוּץ אִיתָה לַמַסלוּל",
      "type": 2,
      "goal": "המכונית",
      "goalName": "המכונית 🚗",
      "goalIcon": "@car",
      "scene": "cinema",
      "era": 2026,
      "avatar": "🕴️",
      "text": "המכונית עובדת, וזאת כבר לא הבעיה. כל הצוות עומד סביבה ומתווכח מי נוסע בה ראשון. קח את המכונית לפני כולם — ומהרגע הזה אתה המכונית. ברח איתה למסלול שבקצה השני, ובדרך חלק צ'אפחות הצלחה לכולם ועקוף את ראש הצוות.",
      "say": "הַמֵכוֹנִית עוֹבֶדֶת, וֵזוֹת כּבָר לֹא הַבֵּעָיָה. כּוֹל הַצֶוֶת עוֹמֵד סבִיבָה וּמִתוַכֵּחַ מִי נוֹסֵעַ בָּה רִאשׁוֹן. קַח אֶת הַמֵכוֹנִית לִפנֵי כּוּלָם — וּמֵהָרֶגַע הַזֶה אַתָה הַמֵכוֹנִית. בּרַח אִיתָה לַמַסלוּל שֵׁבַּקָצֶה הַשֵׁנִי, וּבַדֶרֶך חַלֵק צַ'פּחוֹת הַצלָחָה לֵכוּלָם וַעֲקוֹף אֶת רֹאשׁ הַצֶוֶת.",
      "twist": {
        "avatar": "@car",
        "goal": "המסלול",
        "goalName": "מסלול ה-180 🏁",
        "bonus": 45,
        "announce": "המכונית שלך. עכשיו לברוח למסלול.",
        "sayAnnounce": "הַמֵכוֹנִית שֵׁלךָ. עַכשָׁיו לִברוֹחַ לַמַסלוּל.",
        "goalIcon": "🏁",
        "loop": true
      },
      "outro": {
        "text": "בסוף המכונית ברחה ונסעה בעצמה.",
        "say": "בַּסוֹף הַמֵכוֹנִית בָּרחָה וֵנָסעָה בֵּעַצמָה."
      },
      "q": {
        "t": "זאת המכונית היחידה שטסלה מייצרת שנוהגים בה ביד.",
        "sayT": "זוֹת הַמֵכוֹנִית הַיֵחִידָה שֵׁטֵסלָה מֵייַצֶרֶת שֵׁנוֹהֲגִים בָּה בַּיָד.",
        "who": "אילון מאסק, בחשיפת ה-Roadster (כפי שדווח)",
        "sayWho": "אִילוֹן מַסק, בַּחֲשִׂיפַת הַ-Roadster (כּפִי שֵׁדוּוַח)",
        "year": 2026
      }
    }
  }
];

  if (typeof module !== 'undefined' && module.exports) module.exports = REL_NEWS;
  if (typeof window !== 'undefined') window.REL_NEWS = REL_NEWS;
})();
