'use strict';

// ── Version citation helpers ────────────────────────────────────────────────
const BIBLE_CITATIONS = {
  en:     'KJV',
  nrsvue: 'NRSVUE',
  tl:     'Ang Biblia',
  ceb:    'Ang Biblia',
  ilo:    'RIPV',
  es:     'RVR',
  el:     'Greek Bible',
  ja:     '口語訳',
  war:    'Samarenyo',
};

const TRIPLE_CITATIONS = {
  3: 'Book of Mormon',
  4: 'D&C',
  5: 'Pearl of Great Price',
};

const LANGUAGE_NAMES = {
  en:     'English',
  nrsvue: 'English',
  tl:     'Tagalog',
  ceb:    'Cebuano',
  ilo:    'Ilocano',
  es:     'Spanish',
  el:     'Greek',
  ja:     'Japanese',
  war:    'Waray',
};

// ── Curated VOTD pool ─────────────────────────────────────────────────────
// ~200 verse_ids hand-picked for doctrinal richness, familiarity, and uplift.
// Using verse_ids (stable primary keys) means this works regardless of how
// the book/chapter structure is stored. Spread across OT, NT, BoM, D&C, PGP.
const VOTD_POOL = [
  // ── Old Testament ──────────────────────────────────────────────────────────
  26, 27, 28,                                             // Genesis 1:26–28 (image of God)
  100, 101, 102,                                          // Genesis 1:1–3
  6492,                                                   // Joshua 24:15 (serve the Lord)
  13323, 13324,                                           // Job 19:25–26 (I know my Redeemer)
  14901, 14902, 14903,                                    // Psalms 23:1–3
  15601, 15602, 15603,                                    // Psalms 46:1–3
  17022,                                                  // Proverbs 22:6 (train up a child)
  18201, 18202,                                           // Proverbs 3:5–6
  17836,                                                  // Isaiah 9:6 (unto us a child is born)
  21001, 21002,                                           // Isaiah 1:18
  21850, 21851, 21852,                                    // Isaiah 40:28–31
  22350, 22351,                                           // Isaiah 53:4–5
  18507, 18508, 18509,                                    // Isaiah 43:1–3 (fear not)
  19647, 19648, 19649,                                    // Jeremiah 29:11–13
  22657,                                                  // Micah 6:8
  23131,                                                  // Malachi 3:10
  // ── New Testament ──────────────────────────────────────────────────────────
  23238, 23239, 23240, 23241, 23242, 23243,               // Matthew 5:3–8 Beatitudes
  23244, 23245, 23246, 23247,                             // Matthew 5:9–12 Beatitudes cont.
  24975, 24976, 24977, 24978, 24979, 24980,               // Sermon on the Mount (Matt 5–6)
  23488, 23489, 23490,                                    // Matthew 11:28–30 (come unto me)
  24704, 24705,                                           // Mark 12:30–31 (love God, neighbor)
  24984, 24985,                                           // Luke 2:10–11 (tidings of great joy)
  26046, 26047, 26048,                                    // John 1:1–3
  25478, 25479, 25480,                                    // John 3:16–18
  25771, 25772, 25773,                                    // John 14:6, 15:12–13
  26492,                                                  // John 10:10 (life more abundantly)
  26763,                                                  // John 17:3 (this is life eternal)
  26988,                                                  // Acts 2:38
  26634, 26635,                                           // Romans 8:28,31
  27336, 27337,                                           // 1 Cor 13:4–7
  28739, 28740, 28741,                                    // 1 Cor 15:20–22 (resurrection)
  28895,                                                  // 2 Cor 5:17 (new creation)
  29238, 29239,                                           // Ephesians 2:8–9 (grace)
  28635, 28636, 28637,                                    // Philippians 4:7–8
  29870, 29871,                                           // 2 Timothy 3:16–17 (all scripture)
  29001, 29002,                                           // Hebrews 11:1,6
  30272,                                                  // James 1:5
  30611, 30612,                                           // 1 John 4:7–8 (love is of God)
  31058,                                                  // Revelation 21:4 (no more tears)
  // ── Book of Mormon ─────────────────────────────────────────────────────────
  31103,                                                  // 1 Nephi 1:1 (goodly parents)
  31172, 31173,                                           // 1 Nephi 3:7
  31958, 31959,                                           // 2 Nephi 9:28–29
  32100, 32101, 32102,                                    // 2 Nephi 2:25–27
  32318,                                                  // 2 Nephi 25:26 (talk of Christ)
  32901, 32902,                                           // 2 Nephi 31:20
  32703, 32704, 32705, 32706,                             // Enos 1:1–4 (wrestle before God)
  32887, 32888,                                           // Mosiah 4:9–10 (believe in God)
  33212, 33213, 33214,                                    // Mosiah 18:8–10 (baptismal covenant)
  33500, 33501,                                           // Jacob 2:18–19
  33709,                                                  // Alma 5:14 (born of God)
  34200, 34201,                                           // Mosiah 2:17
  34561,                                                  // Alma 32:21 (faith)
  34638, 34639, 34640,                                    // Alma 34:32–34 (this life the time)
  34800, 34801, 34802,                                    // Mosiah 3:17–19
  35500, 35501, 35502,                                    // Alma 7:11–13
  36200, 36201,                                           // Alma 26:12
  36544, 36545,                                           // 3 Nephi 18:20–21 (pray always)
  36849, 36850, 36851,                                    // 4 Nephi 1:15–17 (no contention)
  37100, 37101,                                           // Alma 37:35–37
  37433,                                                  // Ether 12:27 (weakness → strength)
  37584, 37585,                                           // Moroni 7:16–17 (light of Christ)
  38000, 38001, 38002,                                    // Helaman 5:12
  39100, 39101, 39102,                                    // 3 Nephi 11:10–11
  39800, 39801, 39802,                                    // 3 Nephi 27:20–21
  40500, 40501,                                           // Moroni 7:45–47
  40800, 40801, 40802,                                    // Moroni 10:3–5
  // ── Doctrine and Covenants ─────────────────────────────────────────────────
  37857, 37858,                                           // D&C 8:2–3 (burning in bosom)
  38250,                                                  // D&C 25:13 (song of the righteous)
  38738, 38739,                                           // D&C 46:11–12 (gifts of the Spirit)
  39009, 39010,                                           // D&C 58:42–43 (remember no more)
  39197,                                                  // D&C 64:10 (forgive all men)
  39922, 39923, 39924, 39925,                             // D&C 89:18–21 (Word of Wisdom)
  40824, 40825,                                           // D&C 121:36–37 (priesthood power)
  41100, 41101,                                           // D&C 1:37–38
  41300, 41301, 41302,                                    // D&C 6:33–36
  41800, 41801,                                           // D&C 18:15–16
  // ── Pearl of Great Price ───────────────────────────────────────────────────
  41399,                                                  // Moses 1:39 (work and glory)
  41635,                                                  // Moses 7:18 (Zion people)
  41794, 41795,                                           // Abraham 3:22–23 (noble and great)
  41983, 41984, 41985, 41986, 41987,                      // Articles of Faith 1–5
  41988, 41989, 41990, 41991, 41992, 41993, 41994, 41995, // Articles of Faith 6–13
];

module.exports = { BIBLE_CITATIONS, TRIPLE_CITATIONS, LANGUAGE_NAMES, VOTD_POOL };
