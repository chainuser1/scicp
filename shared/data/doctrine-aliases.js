'use strict';

// ─── Doctrine Alias Map ───────────────────────────────────────────────────────
//  Maps plain-language doctrinal queries → keyword expansions that FTS5 can
//  match against scripture text. Evaluated before FTS5 runs, costs 0ms.
//  Extend this map whenever a real-world presenter query stumps the system.
// ─────────────────────────────────────────────────────────────────────────────
const DOCTRINE_ALIASES = {

  // ── Plan of Salvation ─────────────────────────────────────────────────────
  '_plan_of_salvation': {
    phrases: [
      'great plan of the Eternal God',
      'great plan of happiness',
      'plan of salvation',
      'plan of redemption',
      'plan prepared from the foundation of the world',
      'plan of happiness',
      'before the world was',
      'foundation of the world'
    ],
    terms: [
      'salvation', 'redemption', 'happiness', 'immortality', 'eternal life',
      'atonement', 'resurrection', 'exaltation', 'prepared', 'foundation',
      'joy', 'chosen', 'foreordained'
    ],
  },
  '_plan_of_redemption': {
    phrases: ['plan prepared from the foundation of the world', 'plan of redemption', 'plan of salvation', 'plan of happiness'],
    terms:   ['redemption', 'salvation', 'eternal life', 'atonement', 'prepared', 'foundation'],
  },
  '_plan_of_happiness': {
    phrases: ['great plan of happiness', 'plan of happiness', 'plan of salvation'],
    terms:   ['happiness', 'salvation', 'eternal life', 'joy', 'redemption'],
  },
  '_premortal_life': {
    phrases: [
      'before the world was',
      'chosen before',
      'choses before the foundation of the world',
      'foundation of the world',
      'pre-earth life',
      'pre-earth life',
      'council in heaven',
      'foreordained'
    ],
    terms: [
      'foreordained', 'chosen', 'foundation', 'spirits',
      'council', 'heaven', 'premortal'
    ],
  },
  '_war_in_heaven': {
    phrases: ['and he became Satan, yea, even the devil, the father of all lies, to deceive', 'neither was their place found anymore in heaven', 'third part of the host of heaven', 'third part of the stars', 'fought against the dragon', 'war in heaven', 'devil and his angels', 'cast out', 'because of their agency', 'they were cast out'],
    terms:   ['war', 'heaven', 'cast', 'rebel', 'devil', 'dragon', 'third', 'stars'],
  },
  '_spirit_world': {
    phrases: ['spirit world', 'world of spirits', 'paradise of God', 'spirit prison', 'prison house'],
    terms:   ['spirit', 'dead', 'prison', 'paradise', 'resurrection', 'disembodied'],
  },
  '_degrees_of_glory': {
    phrases: ['celestial kingdom', 'terrestrial kingdom', 'telestial kingdom', 'degrees of glory', 'many mansions', 'glory of the sun', 'glory of the moon', 'glory of the stars'],
    terms:   ['celestial', 'terrestrial', 'telestial', 'glory', 'kingdom', 'mansion', 'sun', 'moon', 'stars'],
  },

  // ── Atonement ─────────────────────────────────────────────────────────────
  '_atonement': {
    phrases: [
      'suffered for our sins',
      'he was wounded for our transgressions',
      'he bore our griefs',
      'by his stripes we are healed',
      'he was broken for our iniquities',
      'took upon him our sicknesses',
      'carried our sorrows',
      'bore our sins in his own body',
      'atonement of Christ',
      'atonement of Jesus Christ',
      'infinite atonement',
      'atoning sacrifice',
      'atoning blood',
      'blood of Christ',
      'garden of Gethsemane',
      'suffer in Gethsemane',
      'blood from every pore',
      'sweat as it were great drops',
      'eternal sacrifice'
    ],
    terms: [
      'atone', 'redeem', 'suffer', 'reconcile', 'ransom', 'sacrifice',
      'expiate', 'infinite', 'eternal', 'sins', 'all mankind', 'gethsemane',
      'cup', 'bleed', 'pore', 'agony', 'garden', 'wound', 'transgression',
      'grief', 'stripe', 'heal', 'bore', 'carried'
    ],
  },

  // ── Abrahamic Covenant ────────────────────────────────────────────────────
  '_abrahamic_covenant': {
    phrases: [
      'Abraham shall be a father of many nations',
      'Abraham was a father of many nations',
      'Abraham rejoiced to see my day, and he saw it and was glad',
      'make thee exceeding fruitful, and I will make nations of thee, and kings shall come out of thee',
      'circumcise the flesh of thy foreskin, and it shall be a token of the covenant',
      'and the Lord God shall give to Abraham a land of plenty and of good',
      'familes of the earth blessed through Abraham',
      'seed as the stars of heaven',
      'seed as the sand upon the seashore',
      'blessings of Abraham',
      'Abrahamic blessings',
      'unto thy seed give I this land, promise land',
      'inherit the land of Canaan',
      'father of many nations',
      'father of a multitude of nations',
      'in thy seed shall all the nations of the earth be blessed',
      'priesthood shall continue in thy seed forever',
      'covenant of circumcision',
      'sign of the covenant',
      'everlasting covenant',
      'covenant made with Abraham',
      'covenant of the priesthood',
      'Abrahamic covenant',
      'eternal marriage',
      'priesthood lineage',
      'covenant of Abraham',
      'seed of Abraham',
      'covenant with Abraham',
      'blessings of Abraham',
      'as the stars of heaven'
    ],
    terms: [
      'abrahamic', 'covenant', 'Abraham', 'Isaac', 'Jacob', 'seed',
      'blessing', 'nations', 'stars', 'sand', 'posterity', 'eternal',
      'marriage', 'lineage'
    ],
  },

  '_grace': {
    phrases: [
      'saved by grace',
      'grace of God',
      'grace of Christ',
      'after all we can do'
    ],
    terms: [
      'grace', 'mercy', 'favour', 'unmerited', 'enable', 'divine help'
    ],
  },
  '_grace_vs_works': {
    phrases: [
      'saved by grace',
      'after all we can do',
      'faith without works',
      'works of righteousness'
    ],
    terms: [
      'grace', 'works', 'faith', 'justified', 'saved', 'merit'
    ],
  },
  '_redemption': {
    phrases: ['redemption of Christ', 'redemption through Christ', 'plan of redemption', 'redeemed from the fall'],
    terms:   ['redeem', 'ransom', 'bought', 'price', 'redemption', 'deliver'],
  },

  // ── Christology ───────────────────────────────────────────────────────────
  '_jesus_christ': {
    phrases: ['Jesus Christ', 'Son of God', 'Son of Man', 'Lamb of God', 'Messiah', 'Holy One of Israel', 'Redeemer of Israel', 'Lord and Savior'],
    terms:   ['Jesus', 'Christ', 'Savior', 'Redeemer', 'Messiah', 'Lord'],
  },
  '_second_coming': {
    phrases: ['second coming', 'coming of the Son of Man', 'day of the Lord', 'great and dreadful day', 'coming in glory', 'at his coming'],
    terms:   ['second', 'coming', 'return', 'clouds', 'glory', 'parousia', 'millennium'],
  },
  '_millennium': {
    phrases: ['thousand years', 'reign of Christ', 'millennial reign', 'new heaven and new earth'],
    terms:   ['millennium', 'thousand', 'reign', 'peace', 'Satan bound', 'rest'],
  },
  '_resurrection': {
    phrases: [
      'resurrection of the dead',
      'resurrection of Christ',
      'brought to pass the resurrection',
      'rise from the dead',
      'first resurrection',
      'resurrection of the just',
      'life after death',
      'we shall live again'
    ],
    terms: [
      'resurrect', 'rise', 'dead', 'immortal', 'body', 'alive',
      'quicken', 'eternal', 'death', 'live'
    ],
  },

  // ── Godhead ───────────────────────────────────────────────────────────────
  '_godhead': {
    phrases: ['the Father and the Son', 'God the Father', 'Holy Ghost', 'three separate', 'Godhead', 'three personages'],
    terms:   ['father', 'son', 'holy ghost', 'godhead', 'personage', 'one'],
  },
  '_nature_of_god': {
    phrases: ['God is a God of truth', 'body of flesh and bones', 'eternal God', 'immortal God', 'perfections of God'],
    terms:   ['god', 'eternal', 'immortal', 'omniscient', 'omnipotent', 'flesh', 'bones', 'perfection'],
  },
  '_holy_ghost': {
    phrases: ['Holy Ghost', 'Holy Spirit', 'gift of the Holy Ghost', 'Comforter', 'Spirit of God', 'Spirit of the Lord'],
    terms:   ['holy ghost', 'comforter', 'spirit', 'confirm', 'receive', 'witness', 'gift'],
  },
  '_first_vision': {
    phrases: ['pillar of light', 'two personages', 'Father and the Son appeared', 'grove of trees'],
    terms:   ['vision', 'light', 'pillar', 'personage', 'grove', 'appeared', 'Joseph'],
  },

  // ── Faith & Repentance ────────────────────────────────────────────────────
  '_faith': {
    phrases: ['faith in Christ', 'faith in Jesus Christ', 'faith in the Lord', 'faith unto repentance', 'faith and works'],
    terms:   ['faith', 'believe', 'trust', 'hope', 'assurance', 'confidence'],
  },
  '_repentance': {
    phrases: ['repent and be baptized', 'repentance of sins', 'broken heart and contrite spirit', 'godly sorrow', 'forsake your sins'],
    terms:   ['repent', 'forsake', 'confess', 'sorrow', 'contrite', 'broken heart', 'change'],
  },
  '_forgiveness': {
    phrases: ['forgiveness of sins', 'sins are forgiven', 'I the Lord will forgive', 'remember no more', 'blot out transgressions'],
    terms:   ['forgive', 'pardon', 'remit', 'cleanse', 'blot', 'remember no more', 'merciful'],
  },
  '_born_again': {
    phrases: ['born again', 'born of God', 'born of the Spirit', 'new creature in Christ', 'spiritual rebirth', 'mighty change of heart', 'mighty change of heart', 'changed from their carnal', 'no more disposition to do evil', 'become new creatures in Christ'],
    terms:   ['born', 'spirit', 'new', 'creature', 'change', 'heart', 'rebirth', 'mighty', 'carnal', 'disposition', 'evil', 'good'],
  },
  '_doubt': {
    phrases: ['doubt not', 'fear not', 'O ye of little faith', 'wavering in faith'],
    terms:   ['doubt', 'fear', 'unbelief', 'waver', 'unstable', 'weak'],
  },

  // ── Ordinances & Priesthood ───────────────────────────────────────────────
  '_baptism': {
    phrases: ['baptized in the name', 'baptism by immersion', 'born of water', 'enter by the gate', 'remission of sins by baptism'],
    terms:   ['baptize', 'immerse', 'water', 'spirit', 'gate', 'covenant', 'remission'],
  },
  '_baptism_for_the_dead': {
    phrases: ['baptized for the dead', 'baptism for the dead', 'proxy ordinance', 'work for the dead', 'salvation for the dead'],
    terms:   ['baptized', 'dead', 'proxy', 'vicarious', 'salvation', 'temple'],
  },
  '_gift_of_holy_ghost': {
    phrases: ['gift of the Holy Ghost', 'receive the Holy Ghost', 'confirmed a member', 'laying on of hands for the gift'],
    terms:   ['holy ghost', 'gift', 'confirm', 'receive', 'laying', 'hands'],
  },
  '_sacrament': {
    phrases: ['bread and wine', 'bless and break bread', 'in remembrance of me', 'body and blood', 'sacrament of the Lord'],
    terms:   ['sacrament', 'bread', 'wine', 'cup', 'remember', 'body', 'blood', 'covenant'],
  },
  '_priesthood': {
    phrases: ['Melchizedek Priesthood', 'Aaronic Priesthood', 'holy priesthood', 'keys of the kingdom', 'authority of God', 'ordained to the priesthood'],
    terms:   ['priesthood', 'authority', 'ordain', 'keys', 'melchizedek', 'aaronic', 'hold'],
  },
  '_melchizedek_priesthood': {
    phrases: ['Melchizedek Priesthood', 'higher priesthood', 'holy order of God', 'after the order of the Son of God'],
    terms:   ['melchizedek', 'higher', 'priesthood', 'order', 'authority', 'high priest'],
  },
  '_aaronic_priesthood': {
    phrases: ['Aaronic Priesthood', 'lesser priesthood', 'Levitical priesthood', 'preparatory priesthood'],
    terms:   ['aaronic', 'lesser', 'levitical', 'deacon', 'teacher', 'priest', 'preparatory'],
  },
  '_laying_on_of_hands': {
    phrases: ['laid their hands upon', 'laying on of hands', 'by the laying on', 'hands were laid'],
    terms:   ['hands', 'laid', 'ordained', 'blessed', 'healed', 'consecrated'],
  },
  '_endowment': {
    phrases: ['endowed with power', 'endowment from on high', 'clothed with power', 'receive your endowment'],
    terms:   ['endow', 'power', 'high', 'holy', 'clothe', 'temple', 'ordinance'],
  },
  '_sealing': {
    phrases: ['sealed for time and all eternity', 'sealed by the Holy Spirit of Promise', 'bind on earth', 'bind in heaven', 'sealing power', 'keys of sealing'],
    terms:   ['seal', 'bind', 'loose', 'keys', 'heaven', 'earth', 'eternity', 'family'],
  },
  '_temple': {
    phrases: ['house of the Lord', 'holy temple', 'temple of God', 'enter into the temple', 'holy of holies'],
    terms:   ['temple', 'holy', 'house', 'Lord', 'sacred', 'ordinance', 'endowment', 'sealing'],
  },

  // ── Eternal Life & Exaltation ─────────────────────────────────────────────
  '_eternal_life': {
    phrases: ['eternal life', 'life eternal', 'immortality and eternal life', 'inherit eternal life', 'the greatest of all the gifts of God'],
    terms:   ['eternal', 'life', 'immortality', 'exaltation', 'inherit', 'gift', 'God'],
  },
  '_exaltation': {
    phrases: ['exalted in the celestial kingdom', 'joint heirs with Christ', 'heirs of God', 'thrones and dominions', 'eternal increase'],
    terms:   ['exalt', 'celestial', 'inherit', 'throne', 'dominion', 'heir', 'eternal', 'increase'],
  },
  '_eternal_family': {
    phrases: ['families are forever', 'sealed for eternity', 'eternal family', 'together forever', 'time and all eternity'],
    terms:   ['family', 'sealed', 'eternal', 'together', 'forever', 'eternity', 'children'],
  },
  '_life_after_death': {
    phrases: ['resurrection of the dead', 'spirit world', 'life after death', 'immortality', 'we shall live again'],
    terms:   ['resurrect', 'spirit', 'world', 'eternal', 'death', 'live', 'immortal'],
  },
  '_judgement': {
    phrases: ['stand before God', 'bar of God', 'judgment bar', 'judged according to works', 'books were opened', 'day of judgment'],
    terms:   ['judgment', 'bar', 'God', 'stand', 'account', 'works', 'books', 'judged'],
  },
  '_outer_darkness': {
    phrases: ['outer darkness', 'sons of perdition', 'weeping and wailing', 'gnashing of teeth', 'perdition', 'second death'],
    terms:   ['outer', 'darkness', 'perdition', 'weeping', 'gnashing', 'sons', 'second death'],
  },

  // ── Families & Covenant ───────────────────────────────────────────────────
  '_covenant': {
    phrases: ['covenant with God', 'everlasting covenant', 'new covenant', 'covenant people', 'keep my covenant', 'enter into a covenant'],
    terms:   ['covenant', 'promise', 'oath', 'swear', 'bind', 'agree', 'testament', 'keep'],
  },
  '_gathering_of_israel': {
    phrases: ['gather Israel', 'remnant of Israel', 'house of Israel', 'return to the promised land', 'scattered Israel', 'ten tribes'],
    terms:   ['gather', 'israel', 'remnant', 'return', 'promised', 'land', 'scattered', 'tribes'],
  },
  '_zion': {
    phrases: [
      'come down from heaven',
      'bride of the Lamb',
      'Zion shall flourish',
      'City of Zion',
      'city of Enoch',
      'pure in heart',
      'New Jerusalem',
      'establish Zion',
      'holy city'
    ],
    terms: [
      'zion', 'pure', 'heart', 'city', 'enoch', 'jerusalem',
      'establish', 'flourish', 'new', 'holy', 'heaven', 'bride'
    ],
  },

  // ── Revelation & Spiritual Gifts ──────────────────────────────────────────
  'revelation': {
    phrases: ['revelation from God', 'word of the Lord', 'thus saith the Lord', 'voice of the Lord', 'spirit of revelation', 'open vision'],
    terms:   ['revelation', 'prophet', 'vision', 'manifest', 'spirit', 'saith', 'Lord'],
  },
  'still_small_voice': {
    phrases: ['still small voice', 'voice of the Spirit', 'Spirit whispered', 'spirit of the Lord came upon'],
    terms:   ['still', 'small', 'voice', 'spirit', 'whisper', 'quiet', 'gentle'],
  },
  '_grace_and_works': {
    phrases: [
      'after all we can do',
      'saved by grace',
      'grace of God',
      'grace of Christ',
      'faith without works',
      'works of righteousness'
    ],
    terms: [
      'grace', 'mercy', 'favour', 'unmerited', 'enable', 'divine help',
      'works', 'faith', 'justified', 'saved', 'merit'
    ],
  },
  '_spiritual_gifts': {
    phrases: ['gifts of the Spirit', 'gift of prophecy', 'gift of tongues', 'gift of healing', 'speaking in tongues', 'discerning of spirits'],
    terms:   ['gift', 'spirit', 'prophecy', 'tongues', 'heal', 'discern', 'miracle'],
  },
  '_prophecy': {
    phrases: ['thus saith the Lord', 'the word of the Lord came', 'prophesy in my name', 'spirit of prophecy'],
    terms:   ['prophecy', 'prophet', 'saith', 'Lord', 'foretell', 'vision', 'declare'],
  },
  '_angels': {
    phrases: ['angel of the Lord', 'ministering angels', 'angel appeared', 'angels of God', 'holy angels'],
    terms:   ['angel', 'ministering', 'appeared', 'messenger', 'holy', 'heaven', 'sent'],
  },

  // ── Prayer & Worship ──────────────────────────────────────────────────────
  '_prayer': {
    phrases: ['pray always', 'pray without ceasing', 'ask and ye shall receive', 'ask of God', 'bow in prayer'],
    terms:   ['pray', 'ask', 'father', 'name', 'faith', 'petition', 'kneel'],
  },
  '_fasting': {
    phrases: ['fast and pray', 'fasting and prayer', 'humbled himself with fasting'],
    terms:   ['fast', 'fasting', 'abstain', 'prayer', 'humble', 'soul'],
  },
  '_sabbath': {
    phrases: ['keep the sabbath', 'sabbath day', 'day of rest', 'holy day', 'remember the sabbath'],
    terms:   ['sabbath', 'day', 'rest', 'holy', 'Lord', 'keep', 'remember'],
  },
  '_tithing': {
    phrases: ['pay tithing', 'bring all the tithes', 'tenth part', 'storehouse', 'windows of heaven', 'tithing and offerings'],
    terms:   ['tithe', 'tenth', 'storehouse', 'offering', 'windows', 'heaven', 'pour out'],
  },
  '_gratitude': {
    phrases: ['give thanks', 'thankful in all things', 'praise the Lord', 'grateful heart', 'acknowledge the hand of God'],
    terms:   ['thank', 'grateful', 'praise', 'acknowledge', 'bless', 'glorify', 'hand of God'],
  },

  // ── Agency & Mortal Experience ────────────────────────────────────────────
  '_agency': {
    phrases: ['free to choose', 'agency of man', 'choose liberty', 'choose eternal life', 'enticed by the one or the other', 'moral agency'],
    terms:   ['agency', 'choose', 'free', 'will', 'liberty', 'choose', 'entice', 'act'],
  },
  '_opposition': {
    phrases: ['opposition in all things', 'bitter and the sweet', 'good and evil', 'compound in one'],
    terms:   ['opposition', 'contrary', 'bitter', 'sweet', 'good', 'evil', 'compound'],
  },
  '_natural_man': {
    phrases: ['natural man is an enemy to God', 'carnal mind', 'fallen man', 'put off the natural man', 'yield to the enticings'],
    terms:   ['natural', 'man', 'enemy', 'carnal', 'fallen', 'yield', 'enticings', 'saint'],
  },
  'temptation': {
    phrases: ['led into temptation', 'tempted of the devil', 'overcome temptation', 'resist the devil', 'fiery darts'],
    terms:   ['tempt', 'devil', 'adversary', 'overcome', 'resist', 'fiery', 'darts', 'snare'],
  },
  '_trials': {
    phrases: ['endure to the end', 'in the midst of affliction', 'all these things shall give thee experience', 'refiner fire'],
    terms:   ['trial', 'tribulation', 'affliction', 'suffer', 'adversity', 'trouble', 'refine', 'endure'],
  },
  '_comfort_in_trials': {
    phrases: ['I will not leave you comfortless', 'peace I leave with you', 'I am with thee', 'be still and know', 'bear up your burdens'],
    terms:   ['comfort', 'peace', 'affliction', 'bear', 'burden', 'strengthen', 'consolation', 'still'],
  },

  // ── Service & Discipleship ────────────────────────────────────────────────
  '_service': {
    phrases: ['serve one another', 'in the service of your God', 'minister to the poor', 'succor the weak', 'pure religion'],
    terms:   ['serve', 'minister', 'lift', 'poor', 'needy', 'hands', 'succor', 'strengthen'],
  },
  '_consecration': {
    phrases: ['consecrate thy performance', 'dedicate to the Lord', 'consecrate to the Lord', 'law of consecration', 'all things in common', 'have all things equal'],
    terms:   ['consecrate', 'dedicate', 'steward', 'all', 'law', 'performance', 'equal', 'common'],
  },
  '_charity': {
    phrases: ['charity never faileth', 'pure love of Christ', 'charity is the pure love', 'clothe yourself with charity'],
    terms:   ['charity', 'love', 'pure', 'Christ', 'faileth', 'greatest', 'bond'],
  },
  '_humility': {
    phrases: ['humble yourself before God', 'broken heart and contrite spirit', 'meek and lowly in heart', 'humble yourselves'],
    terms:   ['humble', 'meek', 'lowly', 'submissive', 'contrite', 'broken', 'heart'],
  },
  '_obedience': {
    phrases: ['obedience to the commandments', 'keep my commandments', 'hearken unto my voice', 'do all things whatsoever the Lord commands'],
    terms:   ['obey', 'keep', 'commandment', 'observe', 'hearken', 'follow', 'law'],
  },

  // ── Scripture & Restoration ───────────────────────────────────────────────
  '_restoration': {
    phrases: ['restoration of all things', 'restored church', 'dispensation of the fullness of times', 'restitution of all things'],
    terms:   ['restoration', 'restore', 'dispensation', 'fullness', 'times', 'church', 'restitution'],
  },
  '_book_of_mormon': {
    phrases: ['another testament of Jesus Christ', 'record of the Nephites', 'fulness of the gospel', 'stick of Joseph', 'gold plates'],
    terms:   ['nephite', 'lamanite', 'record', 'plates', 'gospel', 'fullness', 'testament'],
  },
  '_word_of_god': {
    phrases: ['word of God', 'word of the Lord', 'living word', 'iron rod', 'hold fast to the rod'],
    terms:   ['word', 'god', 'scripture', 'commandment', 'truth', 'rod', 'iron'],
  },
  '_liahona': {
    phrases: ['Liahona', 'ball of curious workmanship', 'director', 'faith and diligence'],
    terms:   ['liahona', 'director', 'faith', 'diligence', 'compass', 'spindle', 'work'],
  },
  '_apostasy': {
    phrases: ['great apostasy', 'falling away', 'darkness covered the earth', 'plain and precious truths removed'],
    terms:   ['apostasy', 'apostate', 'fall', 'away', 'darkness', 'plain', 'precious', 'removed'],
  },
  '_prophet': {
    phrases: ['called of God', 'living prophet', 'voice of the prophet', 'follow the prophet', 'word of the prophet'],
    terms:   ['prophet', 'seer', 'revelator', 'called', 'God', 'voice', 'follow', 'living'],
  },

  // ── Specific LDS Doctrinal Phrases ────────────────────────────────────────
  '_by_their_fruits': {
    phrases: ['by their fruits ye shall know them', 'good tree bringeth forth', 'corrupt tree'],
    terms:   ['fruits', 'know', 'tree', 'good', 'corrupt', 'bring', 'forth'],
  },
  '_iron_rod': {
    phrases: ['rod of iron', 'hold fast to the rod', 'word of God', 'strait and narrow path', 'hold fast', 'strait and narrow'],
    terms:   ['rod', 'iron', 'hold', 'fast', 'word', 'god', 'strait', 'narrow', 'path'],
  },
  '_light_of_christ': {
    phrases: ['light of Christ', 'spirit of Christ', 'given to every man', 'true light', 'light and life'],
    terms:   ['light', 'Christ', 'spirit', 'every', 'man', 'conscience', 'truth'],
  },
  '_love_of_god': {
    phrases: ['love of God', 'God so loved the world', 'charity is the love of God', 'he first loved us'],
    terms:   ['love', 'God', 'world', 'gave', 'son', 'charity', 'first'],
  },
  '_armor_of_god': {
    phrases: ['whole armor of God', 'breastplate of righteousness', 'shield of faith', 'sword of the Spirit', 'helmet of salvation'],
    terms:   ['armor', 'breastplate', 'shield', 'faith', 'sword', 'spirit', 'helmet', 'salvation'],
  },
  '_new_jerusalem': {
    phrases: ['New Jerusalem', 'city of Zion', 'holy city', 'come down from heaven', 'bride of the Lamb'],
    terms:   ['new', 'jerusalem', 'zion', 'city', 'holy', 'heaven', 'bride'],
  },
  '_abide_in_me': {
    phrases: ['abide in me', 'I am the vine', 'branch cannot bear fruit', 'abide in my love'],
    terms:   ['abide', 'vine', 'branch', 'fruit', 'love', 'remain', 'dwell'],
  },
  '_prayer_of_faith': {
    phrases: ['prayer of faith', 'pray with faith', 'ask in faith', 'ask of God', 'receive according to your faith', 'nothing wavering'],
    terms:   ['prayer', 'faith', 'ask', 'waver', 'believe', 'receive', 'heal'],
  },
  '_power_of_god': {
    phrases: ['power of God', 'arm of the Lord', 'by the power of God', 'omnipotent God', 'mighty to save', 'strength of the Lord', 'mighty God', 'omnipotent arm', 'omnipotent power', 'matchless power of God'],
    terms:   ['power', 'God', 'arm', 'Lord', 'omnipotent', 'mighty', 'strength'],
  },
  '_endure_to_the_end': {
    phrases: ['endure to the end', 'hold out faithful', 'patient in tribulation', 'endure tribulation', 'faithful unto the end', 'trials and tribulations', 'trial of your faith', 'worketh patience', 'patience in thy affliction', 'run with endurance'],
    terms:   ['endure', 'end', 'faithful', 'patient', 'tribulation', 'run', 'persevere'],
  },
  '_steadfast': {
    phrases: ['steadfast and immovable', 'firm and steadfast in the faith', 'hold fast'],
    terms:   ['steadfast', 'immovable', 'firm', 'faith', 'hold', 'fast', 'constant'],
  },
};

module.exports = { DOCTRINE_ALIASES };
