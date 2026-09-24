// Everything that makes one fight different from another lives here.
// Sides are SCREEN sides: 'L' is the glove on the left of your screen.
// `avoid` lists the player moves that make an attack miss. The rule the player learns:
// jabs miss any dodge, hooks and spins can be ducked, everything else — dodge away from the glowing glove.

export const ATTACKS = {
  jabL:   { kind: 'jab',   hand: 'L', windup: 0.55, strike: 0.10, recover: 0.55, dmg: 9,  avoid: ['left', 'right', 'duck'], interrupt: true },
  jabR:   { kind: 'jab',   hand: 'R', windup: 0.55, strike: 0.10, recover: 0.55, dmg: 9,  avoid: ['left', 'right', 'duck'], interrupt: true },
  hookL:  { kind: 'hook',  hand: 'L', windup: 0.72, strike: 0.15, recover: 0.8,  dmg: 15, avoid: ['right', 'duck'], interrupt: true },
  hookR:  { kind: 'hook',  hand: 'R', windup: 0.72, strike: 0.15, recover: 0.8,  dmg: 15, avoid: ['left', 'duck'], interrupt: true },
  upperL: { kind: 'upper', hand: 'L', windup: 0.85, strike: 0.13, recover: 1.0,  dmg: 20, avoid: ['right'] },
  upperR: { kind: 'upper', hand: 'R', windup: 0.85, strike: 0.13, recover: 1.0,  dmg: 20, avoid: ['left'] },
  smash:  { kind: 'smash', hand: 'R', windup: 1.0,  strike: 0.15, recover: 1.15, dmg: 24, avoid: ['left'] },
  throwR: { kind: 'throw', hand: 'R', windup: 0.6,  strike: 0.62, recover: 0.7,  dmg: 11, avoid: ['left', 'right', 'duck'] },
  // quick parry-counter after the player keeps punching a guard
  counter:{ kind: 'jab',   hand: 'R', windup: 0.30, strike: 0.08, recover: 0.5,  dmg: 8,  avoid: ['left', 'right', 'duck'] },
  // specials
  pivot:  { kind: 'special', pose: 'pivot', hand: 'R', windup: 1.15, strike: 0.16, recover: 1.1, dmg: 26, avoid: ['left', 'duck'] },
  takeover:{ kind: 'special', pose: 'takeover', hand: 'L', windup: 1.0, strike: 0.12, recover: 1.2, dmg: 22, avoid: ['right'] },
};

export const FLURRIES = {
  review:   { name: 'PERFORMANCE REVIEW', seq: ['jabL', 'jabR', 'hookL'], windup: 0.26 },
  doubleJab:{ name: null, seq: ['jabL', 'jabL'], windup: 0.3 },
  restructure: { name: 'RESTRUCTURING', seq: ['hookL', 'hookR', 'hookL', 'hookR', 'upperR'], windup: 0.24 },
  backInMyDay: { name: 'BACK IN MY DAY', seq: ['jabL', 'jabR', 'jabL', 'jabR', 'hookL', 'hookR', 'smash'], windup: 0.22 },
  layoffs:  { name: 'LAYOFFS', seq: ['hookR', 'jabL', 'hookL', 'upperR'], windup: 0.34, dark: true },
  synergy:  { name: 'SYNERGY', seq: ['jabR', 'upperL', 'hookR'], windup: 0.3 },
};

const THEMES = {
  mail:  { a: '#22e5ff', b: '#ff2e88', bg: '#050b14', signs: ['SMILE, YOU\'RE AN ASSET', 'HUSTLE HARDER', 'NO JOB TOO SMALL'], floorLabel: 'B1', floorName: 'MAILROOM', logo: 'PUNCH CLOCK', prop: 'parcels',
    // strip lights that buzz and stutter
    light: { key: '#e4fff0', keyInt: 0.9, fill: '#a8d8ff', fillInt: 1.3, hemi: 1.1, fog: 0.022, haze: 0.6, exposure: 1, flicker: true } },
  hr:    { a: '#b56cff', b: '#c6ff3d', bg: '#0b0514', signs: ['WE ARE A FAMILY', 'YOUR FEELINGS MATTER*', 'PER MY LAST EMAIL'], floorLabel: '03', floorName: 'HUMAN RESOURCES', logo: 'PUNCH CLOCK', prop: 'plant',
    // soft, even, beige 'wellness' light
    light: { key: '#ffe6cc', keyInt: 0.75, fill: '#e6ccff', fillInt: 2, hemi: 1.4, fog: 0.03, haze: 1.5, exposure: 1.05 } },
  vp:    { a: '#ff7a1a', b: '#1affc6', bg: '#120804', signs: ['SYNERGY', 'RISE & GRIND', 'DISRUPT EVERYTHING'], floorLabel: '12', floorName: 'SYNERGY DEPT.', logo: 'PUNCH CLOCK', prop: 'barbell',
    // hot orange gym light, hard shadows, sweaty air
    light: { key: '#ffb070', keyInt: 1.25, fill: '#ff9a50', fillInt: 0.5, hemi: 0.7, fog: 0.032, haze: 2, exposure: 1.05 } },
  cons:  { a: '#3dff7a', b: '#f4f4f4', bg: '#03100a', signs: ['BILLABLE HOURS', 'LEVERAGE', 'THINK OUTSIDE THE BOX'], floorLabel: '27', floorName: 'STRATEGY', logo: 'PUNCH CLOCK', prop: 'whiteboard',
    // clinical projector white
    light: { key: '#f4f9ff', keyInt: 1.1, fill: '#d0e4ff', fillInt: 1.4, hemi: 0.8, fog: 0.018, haze: 0.5, exposure: 1.05 } },
  board: { a: '#ff3355', b: '#ffcf4a', bg: '#12040a', signs: ['FOUNDED 1931', 'LEGACY', 'RESPECT YOUR ELDERS'], floorLabel: '44', floorName: 'THE BOARDROOM', logo: 'PUNCH CLOCK', prop: 'clock',
    // dim amber tungsten, deep shadows
    light: { key: '#ffb45a', keyInt: 0.8, fill: '#ff9e6a', fillInt: 0.35, hemi: 0.5, fog: 0.03, haze: 1.1, exposure: 0.95 } },
  ceo:   { a: '#ffc233', b: '#ff2244', bg: '#0e0903', signs: ['SHAREHOLDER VALUE', 'WE ARE NOT HIRING', 'THANK YOU FOR YOUR SACRIFICE'], floorLabel: 'PH', floorName: 'PENTHOUSE', logo: 'PUNCH CLOCK', prop: 'trophy',
    // everything is gold up here
    light: { key: '#ffd88a', keyInt: 1.1, fill: '#ffe0a0', fillInt: 1, hemi: 1, fog: 0.024, haze: 1.2, exposure: 1.12 } },
};

export const ROSTER = [
  {
    id: 'kyle', name: 'KYLE', title: 'UNPAID INTERN', floor: 'B1', theme: THEMES.mail,
    tagline: '"I\'m doing this for the exposure."',
    stats: [['AGE', '19'], ['WEIGHT', '128 LBS (WET)'], ['SALARY', '$0.00'], ['REACH', 'EXCEEDS GRASP']],
    look: { skin: '#f3c9a6', shirt: '#dfe7f2', shorts: '#2f45ff', gloves: '#3b82ff', trim: '#ffffff', bulk: 0.78, height: 0.97, belly: 0, head: 1.18,
      // noodle: long neck, big head, nothing in the arms
      shape: { torso: [0.8, 0.8, 0.82, 0.85, 0.8, 0.5], arm: [0.8, 0.65], fore: [0.7, 0.6], thigh: [0.8, 0.62], shin: [0.7, 0.55], leg: 1.08, neck: 1.4 },
      hair: 'messy', hairColor: '#6b4526', acc: ['glasses', 'lanyard', 'tie'], tie: '#1d2bb8',
      face: { brows: 'thin', freckles: true, mouth: 'nervous', eyes: 'round' } },
    music: { bpm: 118, root: 45, mood: 'drive' },
    hp: 70, knockdowns: 1, guardLeak: 0.35, comboCap: 6, blockCounterAt: 99,
    idle: [1.5, 2.6], tauntChance: 0.18, feintChance: 0, dmgScale: 0.8, speed: 1.35,
    moves: [{ id: 'jabR', w: 3 }, { id: 'jabL', w: 2 }, { id: 'hookL', w: 1.3 }, { id: 'throwR', w: 0.8, prop: 'coffee' }],
    taunt: 'phone', tutorial: true,
    lines: {
      intro: ['Is this... paid?', 'My mom says I\'m a natural.'],
      taunt: ['Hold on, my mom is calling.', 'Can I put this on LinkedIn?', 'Brb, coffee run.'],
      hit: ['OW. HR??', 'Not the glasses!', 'I\'m telling my manager!'],
      land: ['Sorry! Sorry!', 'Was that okay?', 'Networking!!'],
      down: ['I need this for college credit...'],
      up: ['Okay. Okay. I got this.'],
      ko: ['I quit!', 'Unpaid... and unconscious...'],
      win: ['Wait, I won?? Can I get paid now?'],
    },
    memo: 'Welcome to PUNCH CLOCK. Your first performance review is in the mailroom. Please do not hurt the intern (too much). He is our only unpaid employee.',
    promo: { title: 'INTERN (PAID, BARELY)', perk: 'Kyle\'s lanyard. It still says KYLE.' },
    feed: { channel: '#mailroom', online: '3 online', every: 8,
      chatter: ['kyle says he\'s "doing it for the exposure"', 'package #4411 is addressed to "THE CEO". kyle is guarding it with his life', 'the mailroom smells like fear and toner', 'the printer on 4 is on fire again', 'kyle\'s mom just called reception'] },
  },
  {
    id: 'brenda', name: 'BRENDA', title: 'FROM HR', floor: '03', theme: THEMES.hr,
    tagline: '"This is going in your file."',
    stats: [['TENURE', '31 YEARS'], ['COMPLAINTS FILED', '4,112'], ['MUG', 'WORLD\'S BEST HR'], ['EMPATHY', 'PENDING']],
    look: { skin: '#e9b48f', shirt: '#7b3fbf', shorts: '#2c1c45', gloves: '#c6ff3d', trim: '#2c1c45', bulk: 0.95, height: 0.95, belly: 0.25, head: 1.0,
      // pear: narrow shoulders, wide hips
      shape: { torso: [1.0, 1.0, 0.9, 0.8, 0.72, 0.45], sh: 0.85, hip: 1.25 },
      hair: 'bob', hairColor: '#a5522a', acc: ['glasses', 'lanyard', 'pearls'], tie: null,
      face: { brows: 'arched', lipstick: '#c2185b', lashes: true, mouth: 'tight', eyes: 'narrow' } },
    music: { bpm: 124, root: 43, mood: 'funk' },
    hp: 100, knockdowns: 2, guardLeak: 0.08, comboCap: 5, blockCounterAt: 5,
    idle: [1.1, 2.0], tauntChance: 0.15, feintChance: 0, dmgScale: 1, speed: 1.1,
    moves: [{ id: 'jabL', w: 2 }, { id: 'doubleJab', w: 2, flurry: true }, { id: 'hookR', w: 1.5 }, { id: 'hookL', w: 1.5 },
      { id: 'throwR', w: 1, prop: 'paper' }, { id: 'review', w: 1.2, flurry: true, minPhase: 1 }],
    taunt: 'sip',
    lines: {
      intro: ['Kyle told me everything. In crayon.', 'I\'ve scheduled a quick sync. With your face.'],
      taunt: ['*sips* Per my last email...', 'I\'ll need that in writing.', 'Let\'s circle back.'],
      hit: ['That\'s a formal complaint!', 'Inappropriate!', 'I\'m documenting this.'],
      land: ['Noted.', 'Consider yourself written up.', 'Thanks for your feedback!'],
      down: ['This is a hostile work environment...'],
      up: ['New policy: I win.'],
      ko: ['I\'m... filing... a...'],
      win: ['Please return your badge to the front desk.'],
    },
    memo: 'RE: The Mailroom Incident. Kyle has filed a formal complaint (in crayon). Brenda from HR would like to "have a word." Attendance is mandatory. Please bring your own gloves and a positive attitude.',
    promo: { title: 'ASSOCIATE (NO OPEN INVESTIGATIONS)', perk: 'Your HR file. All 4,112 pages. Brenda\'s handwriting is terrifying.' },
    feed: { channel: '#hr-confidential', online: '41 online', every: 6.5,
      chatter: ['who invited the whole company to #hr-confidential', 'kyle got your old job. temp, night shift. he cried', 'i got a calendar invite titled "you"', 'the printer fire reached 3. brenda wrote it up', 'package #4411 has been reclassified as a complaint'] },
  },
  {
    id: 'chad', name: 'CHAD', title: 'VP OF SYNERGY', floor: '12', theme: THEMES.vp,
    tagline: '"I wake up at 4 a.m. to get punched."',
    stats: [['BENCH', '405 LBS'], ['CRYPTO', '-92%'], ['PODCAST', '3 LISTENERS'], ['MINDSET', 'ALPHA (BETA)']],
    look: { skin: '#f09a55', shirt: '#101418', shorts: '#ff7a1a', gloves: '#ff7a1a', trim: '#101418', bulk: 1.35, height: 1.05, belly: 0, head: 0.78,
      // wedge: all chest and forearm, skipped leg day, no neck
      shape: { torso: [0.5, 0.58, 0.78, 0.95, 1.0, 0.7], sh: 1.2, arm: [1.1, 0.8], fore: [0.8, 1.35], thigh: [0.72, 0.55], shin: [0.62, 0.5], leg: 0.82, neck: 0.6, neckW: 1.6 },
      hair: 'fade', hairColor: '#e7c56a', acc: ['shades', 'earpiece'], tie: null,
      face: { brows: 'thick', jaw: true, mouth: 'grin', eyes: 'narrow', stubble: true } },
    music: { bpm: 132, root: 40, mood: 'drive' },
    hp: 115, knockdowns: 2, guardLeak: 0.05, comboCap: 4, blockCounterAt: 4,
    idle: [0.9, 1.7], tauntChance: 0.2, feintChance: 0.08, dmgScale: 1.1, speed: 1.0,
    moves: [{ id: 'jabR', w: 2 }, { id: 'upperL', w: 1.4 }, { id: 'upperR', w: 1.4 }, { id: 'hookL', w: 1.3 }, { id: 'hookR', w: 1.3 },
      { id: 'pivot', w: 1.1 }, { id: 'synergy', w: 1, flurry: true, minPhase: 1 }],
    taunt: 'flex',
    lines: {
      intro: ['You beat BRENDA? Bro. She had tenure.', 'You miss 100% of the punches you don\'t throw. — Me'],
      taunt: ['Rise and GRIND.', 'Do you even synergize, bro?', 'This is my cheat day.'],
      hit: ['Bro. BRO.', 'That\'s not very growth mindset!', 'That\'s feedback. I don\'t DO feedback.'],
      land: ['PIVOT!', 'Circle back to THAT.', 'That\'s called leverage.'],
      down: ['Cold plunge... needed...'],
      up: ['Failure is just success that hasn\'t pivoted.'],
      ko: ['I... am... disrupted...'],
      win: ['Let\'s get you on my podcast. As a cautionary tale.'],
    },
    memo: 'Brenda\'s investigation into you is paused (Brenda is unconscious). Chad, VP of Synergy, wants to "align on blockers." You are the blocker. Tip: when he spins, he is not dancing.',
    promo: { title: 'VP OF SYNERGY (ACTING)', perk: 'Chad\'s podcast. All 3 listeners. One is Chad.' },
    feed: { channel: '#synergy-wins', online: '212 online', every: 5,
      chatter: ['kyle is "shadowing leadership" now??', 'he did 400 pushups in the elevator on the way down', 'is he wearing shades indoors to hide his fear', 'chad says the printer fire is "a growth opportunity"', 'every time chad gets hit his crypto drops'] },
  },
  {
    id: 'derek', name: 'DEREK', title: 'CONSULTANT, $900/HR', floor: '27', theme: THEMES.cons,
    tagline: '"I\'ve made a slide deck about your weaknesses."',
    stats: [['RATE', '$900/HR'], ['SLIDES', '212'], ['VALUE ADDED', 'N/A'], ['ALMA MATER', 'YES']],
    look: { skin: '#d8a37e', shirt: '#1b2a24', shorts: '#0c1612', gloves: '#3dff7a', trim: '#f4f4f4', bulk: 0.92, height: 1.12, belly: 0, head: 0.98,
      // tall and narrow, like a lamp post in a vest
      shape: { torso: [0.8, 0.8, 0.82, 0.86, 0.84, 0.55], sh: 0.95 },
      hair: 'slick', hairColor: '#1a1410', acc: ['headset', 'tie', 'vest'], tie: '#3dff7a',
      face: { brows: 'thin', mouth: 'smirk', eyes: 'narrow' } },
    music: { bpm: 128, root: 42, mood: 'dark' },
    hp: 105, knockdowns: 2, guardLeak: 0.04, comboCap: 4, blockCounterAt: 3,
    idle: [0.7, 1.4], tauntChance: 0.12, feintChance: 0.3, dmgScale: 1.05, speed: 0.85,
    moves: [{ id: 'jabL', w: 2 }, { id: 'jabR', w: 2 }, { id: 'hookL', w: 1.3 }, { id: 'hookR', w: 1.3 }, { id: 'throwR', w: 1.2, prop: 'card' },
      { id: 'restructure', w: 1.2, flurry: true, minPhase: 1 }, { id: 'upperR', w: 0.8 }],
    taunt: 'invoice', bills: true,
    lines: {
      intro: ['I\'ve analysed your fight with Chad. 212 slides.', 'This fight is billable.'],
      taunt: ['That\'ll be $900.', 'Let me just take this call.', 'Have you considered... being worse?'],
      hit: ['I\'m billing you for that.', 'Out of scope!', 'Let me loop in my manager.'],
      land: ['Value: added.', 'Invoice sent.', 'Best practice.'],
      down: ['Recommend... restructuring... me...'],
      up: ['New deck. New me.'],
      ko: ['Engagement... terminated...'],
      win: ['My recommendation: fire you. That\'ll be $40,000.'],
    },
    memo: 'Following the Chad Situation, we have hired a consultant to assess your performance. He bills us $900 for every punch you take. Please take fewer punches.',
    promo: { title: 'SENIOR PARTNER, $1,800/HR', perk: 'Derek\'s deck. Every slide says "LEVERAGE."' },
    feed: { channel: '#strategy-offsite', online: '1,208 online', every: 4.2,
      chatter: ['how much has derek billed so far', 'kyle just got a company card', 'we paid derek to tell us to hire derek', 'derek billed us for the printer fire', 'finance here. please stop getting hit.'] },
  },
  {
    id: 'margaret', name: 'MARGARET', title: 'CHAIRWOMAN OF THE BOARD, 94', floor: '44', theme: THEMES.board,
    tagline: '"I founded this company with my bare hands. And this is them."',
    stats: [['AGE', '94'], ['NET WORTH', 'YES'], ['HIP', 'REPLACED (TWICE)'], ['NAPS', 'LETHAL']],
    look: { skin: '#f0cdb5', shirt: '#e7a2c0', shorts: '#6e2140', gloves: '#ff3355', trim: '#ffffff', bulk: 0.82, height: 0.82, belly: 0.1, head: 1.3, hunch: 0.35,
      // big head, stick legs, enormous gloves
      shape: { torso: [0.9, 0.95, 0.9, 0.82, 0.7, 0.45], thigh: [0.55, 0.45], shin: [0.5, 0.42], leg: 0.9, glove: 1.25 },
      hair: 'bun', hairColor: '#e8e8ef', acc: ['glasses', 'pearls'], tie: null,
      face: { brows: 'thin', wrinkles: true, lipstick: '#d81b60', lashes: true, mouth: 'tight', eyes: 'small' } },
    music: { bpm: 136, root: 41, mood: 'dark' },
    hp: 120, knockdowns: 3, guardLeak: 0.05, comboCap: 4, blockCounterAt: 4,
    idle: [1.0, 2.0], tauntChance: 0.18, feintChance: 0.1, dmgScale: 1.2, speed: 0.95,
    moves: [{ id: 'jabR', w: 1.5 }, { id: 'smash', w: 1.3 }, { id: 'hookL', w: 1.3 }, { id: 'hookR', w: 1.3 }, { id: 'upperR', w: 1 },
      { id: 'throwR', w: 1.1, prop: 'dentures' }, { id: 'backInMyDay', w: 1, flurry: true, minPhase: 1 }],
    taunt: 'nap',
    lines: {
      intro: ['Derek billed me to watch you. I want my money\'s worth.', 'I\'ve outlived four CEOs, dear.'],
      taunt: ['Zzz...', '*falls asleep standing up*'],
      hit: ['I have a lawyer, sweetie.', 'Oh, you\'re in the will now. As a warning.', 'How RUDE.'],
      land: ['That one\'s from the Depression. I saved it.', 'That\'s for the pension cuts.', 'Mmhm.'],
      down: ['I\'ve fallen... and I\'m FURIOUS.'],
      up: ['Now I\'m awake.'],
      ko: ['Tell the board... I said... hi...'],
      win: ['Go to your room.'],
    },
    memo: 'Derek\'s final report recommends you be "removed." It cost $1.2M. The Board will hear the matter. The Board is Margaret. She is 94 and has never lost a vote or a fist fight. If she falls asleep, do not wake her. Or do. It is your career.',
    promo: { title: 'CHAIR OF THE BOARD (YOUNGEST BY 70 YEARS)', perk: 'Margaret\'s seat. It is still warm. It is always warm.' },
    feed: { channel: '#board-eyes-only', online: '9,450 online', every: 3.6,
      chatter: ['is margaret... asleep?', 'kyle has a parking spot. i don\'t have a parking spot', 'she founded this company in 1931 with her FISTS', 'margaret\'s son is watching from the penthouse', 'the printer fire has been promoted to VP'] },
  },
  {
    id: 'roland', name: 'ROLAND VANTABLACK III', title: 'CEO', floor: 'PH', theme: THEMES.ceo,
    tagline: '"I\'m not a monster. I\'m a job creator."',
    stats: [['COMPENSATION', '$81M + JET'], ['YACHTS', '3 (SMALL)'], ['LAYOFFS', 'ALL OF THEM'], ['SOUL', 'OFFSHORE']],
    look: { skin: '#e6b594', shirt: '#15151c', shorts: '#15151c', gloves: '#ffc233', trim: '#15151c', bulk: 1.2, height: 1.03, belly: 0.35, head: 1.0,
      // barrel on short legs
      shape: { torso: [0.95, 1.0, 1.0, 0.95, 0.85, 0.55], leg: 0.85 },
      hair: 'slick', hairColor: '#9a9aa6', acc: ['tie', 'suit'], tie: '#ff2244', goldGloves: true,
      face: { brows: 'thick', mouth: 'smirk', eyes: 'narrow', goldTooth: true, mustache: true } },
    music: { bpm: 146, root: 38, mood: 'boss' },
    hp: 140, knockdowns: 3, guardLeak: 0.03, comboCap: 4, blockCounterAt: 3,
    idle: [0.6, 1.3], tauntChance: 0.1, feintChance: 0.25, dmgScale: 1.25, speed: 0.8,
    moves: [{ id: 'jabL', w: 1.6 }, { id: 'jabR', w: 1.6 }, { id: 'hookL', w: 1.3 }, { id: 'hookR', w: 1.3 }, { id: 'upperL', w: 1 },
      { id: 'takeover', w: 1.1 }, { id: 'throwR', w: 1, prop: 'cash' }, { id: 'layoffs', w: 1.2, flurry: true, minPhase: 1 }],
    taunt: 'cash', boss: true,
    lines: {
      intro: ['You knocked out MOTHER? I was saving that for the AGM.', 'Let\'s talk about equity. You have none.'],
      taunt: ['*on phone* No, keep the jet running. This won\'t take long.', 'I made more money while you blinked.', '*on phone* Sell. No, the employee. Sell the employee.'],
      hit: ['My shareholders felt that!', 'Legal will hear about this.', 'That\'s coming out of YOUR bonus.'],
      land: ['Let\'s call that a voluntary departure.', 'Restructured.', 'You\'re a line item.'],
      down: ['Deploy... the golden parachute...'],
      up: ['The jacket comes OFF.', 'The TIE comes off. MOTHER, I\'M HANDLING IT.'],
      ko: ['...I\'m going to need a bailout.'],
      win: ['Security will escort you out. Also, security is me.'],
    },
    memo: 'Margaret has been moved to the Emeritus Wing (a bench in the lobby). Her son, the CEO, has cleared 4 minutes to fight you personally. This is the greatest honour an employee can receive. There is no next floor.',
    promo: { title: 'CEO', perk: 'The golden parachute. And the jet. (Small.)' },
    feed: { channel: '#all-company', online: '48,002 online · 📈 shareholders watching', every: 2.8, censor: 0.18,
      pinned: 'This channel is now read-only. Enjoy the fight responsibly.',
      chatter: ['the stock goes up every time you get hit', 'kyle is in the penthouse?? he\'s holding a clipboard', 'roland has disabled reactions', 'is the jet idling on the roof??', 'the printer fire is now the only department with a union'],
      ko: ['@channel ROLAND HAS LEFT THE COMPANY', 'roland has been added to #mailroom', 'found my yogurt in the ceo fridge. label says SHAREHOLDER VALUE', 'reacted with 🥊 x48,002', 'first act as CEO: unlock this channel please'] },
  },
];

// Your job title on floor B1. Each win promotes you into the job of whoever you just beat.
export const START_TITLE = 'TEMP, NIGHT SHIFT';

// Company chat, by fight event. {opp} is the opponent's first name.
export const FEED = {
  start: ['is someone fighting {opp} rn', '{opp}?? on a tuesday??', 'who booked the ring over the all-hands', 'can we get this on the big screen', 'putting my status on "in a meeting" and watching this'],
  oppHit: ['OHHH', '💀💀💀', 'that\'s a write-up', 'adding that to the incident log (the ceiling)', 'saving this for the holiday party', 'HR is typing...', 'legal wants to know who\'s winning', '{opp} felt that in their 401k'],
  playerHit: ['oof', 'that looked expensive', 'the dental plan does NOT cover that', 'that\'s a workers comp claim if i\'ve ever seen one', 'is that allowed', 'ouch. anyway, standup at 10?', 'ok that one was personal'],
  perfect: ['did they just DODGE {opp}', 'more agile than our sprints', 'ok the new hire is kinda cracked', 'dodged that like a meeting invite', 'teach me that for when my manager calls'],
  oppDown: ['{opp} IS DOWN', 'counting along from my desk', 'putting this in the newsletter', 'somebody get {opp} a stress ball', 'THE ORG CHART IS SHAKING'],
  playerDown: ['get UP', 'should i call someone', 'defibrillator is behind the vending machine btw', 'dibs on their desk', 'their plant is so thirsty. get up for the plant'],
  taunt: ['{opp} isn\'t even looking at you', 'HIT THEM WHILE THEY\'RE BUSY', 'disrespectful. punish it.', '{opp} is multitasking. rude.'],
  haymaker: ['OVERTIME?? who approved overtime', 'OVERTIME!!! (unpaid)', 'that punch had a cost center'],
  ko: ['GG', '{opp} has left the channel', 'rip {opp} 🕯️', 'who gets {opp}\'s parking spot', 'someone update the org chart', 'reacted with 🥊 x40'],
  idle: ['did anyone take my yogurt', 'reply-all: please stop replying all', 'is the wifi down or just me', 'who microwaved fish', 'friendly reminder: timesheets due', 'mandatory fun is at 5. attendance is being taken'],
  // people you've beaten, heckling from the sidelines
  ghosts: {
    kyle: ['hi it\'s kyle. they hit me too. it\'s fine. i\'m fine', 'can i put "got knocked out" on linkedin', 'the hospital gave me a sandwich. first paid meal here'],
    brenda: ['I am documenting this from the ICU.', 'Per my last email: hit them in the face.', 'This entire chat is going in everyone\'s file.'],
    chad: ['bro keep your hands UP 🔥', 'honestly this is a growth moment for them', 'this is giving pre-seed energy. keep swinging'],
    derek: ['fwiw I\'d have dodged left. invoice to follow.', 'I\'ve been retained by both sides. Congratulations to me.', 'I\'ve billed 0.1 hours for this message.'],
    margaret: ['In my day we watched fights on the RADIO.', 'Roland, you were a breech birth AND a breach of contract.', 'Roland, sit up straight. And block.'],
  },
};

export const GRADES = [
  { min: 0.86, letter: 'S', label: 'EXCEEDS EXPECTATIONS', color: '#ffd23f' },
  { min: 0.7, letter: 'A', label: 'STRONG PERFORMER', color: '#3dff7a' },
  { min: 0.5, letter: 'B', label: 'MEETS EXPECTATIONS', color: '#22e5ff' },
  { min: 0.3, letter: 'C', label: 'NEEDS IMPROVEMENT', color: '#ff9f1a' },
  { min: -1, letter: 'D', label: 'PERFORMANCE IMPROVEMENT PLAN', color: '#ff2e55' },
];

// Mean one-liners on the review card, by grade letter.
export const REVIEW_NOTES = {
  S: ['Frighteningly efficient. Please stop.', 'Promoted. Also, we are scared of you.', 'HR has flagged you as "a lot."'],
  A: ['Solid. Would be punched by again.', 'Great hustle. No raise.', 'Leadership material, sadly.'],
  B: ['Adequate. Like the coffee.', 'You showed up. That counts, legally.', 'Meets the bare minimum, admirably.'],
  C: ['Took a lot of hits. Very "team player."', 'We admire your face\'s resilience.', 'Consider a lateral move.'],
  D: ['Won, technically. We\'re reviewing the tape.', 'Survived. Barely. Like the company.', 'Your face has filed for disability.'],
};

export const FIRED_LINES = [
  'Your position has been eliminated.',
  'We\'re going in a different direction.',
  'We\'ve chosen to pursue other candidates. Specifically, the one who hit you.',
  'Please clear out your desk. And your teeth.',
  'Thank you for your service. Security will see you out.',
];

// Pop-up words, by event.
export const CALLOUTS = {
  counter: ['COUNTER!', 'PUNISHED!', 'CORRECTED!'],
  perfect: ['PERFECT!', 'UNTOUCHABLE', 'NOT TODAY'],
  disrespect: ['DISRESPECT!', 'RUDE!', 'UNPROFESSIONAL!'],
  haymaker: ['HAYMAKER!!', 'FIRED!!', 'TERMINATED!!'],
  interrupt: ['INTERRUPTED!', 'NOT NOW!'],
  combo: ['NICE', 'BRUTAL', 'SAVAGE', 'TAX DEDUCTIBLE', 'OVERTIME', 'BONUS ELIGIBLE', 'LAWSUIT PENDING'],
};
