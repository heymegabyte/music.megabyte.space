import type { Album, Track } from './types';

const COVERS = {
  desiiignare: '/art/cover-panda-desiiignare.png',
  dump: '/art/cover-panda-dump.png',
  canon: '/art/cover-st-johns-canon.png',
  halo: '/art/cover-st-johns-halo.png',
  galactic: '/art/cover-galactic-gospel.png',
  c1: '/art/chatgpt-1.png',
  c2: '/art/chatgpt-2.png',
  c3: '/art/chatgpt-3.png',
  c4: '/art/chatgpt-4.png',
  c5: '/art/chatgpt-5.png',
  c6: '/art/chatgpt-6.png',
  c7: '/art/chatgpt-7.png',
  alien: '/art/alien-hallucination.png',
  light: '/art/light-in-bathroom.png',
  middle: '/art/middle-finger.png',
  unnamed: '/art/unnamed.png'
};

export const ALBUMS: Album[] = [
  {
    id: 'desiiignare',
    name: 'Panda Desiiignare',
    cover: '/art/cover-panda-desiiignare-v2.png',
    tagline: 'The flagship gospel of bZ',
    description: 'A lit, fit, JC-inspired hustle gospel. Built one prompt at a time. Cyan flag up.',
    accent: '#00E5FF',
    releasedAt: '2026-05-04',
    trackIds: [
      'chef-lu-stew',
      'green-beans-mean',
      'infinite-good',
      'one-stop-higher',
      'white-flag-prayer'
    ]
  },
  {
    id: 'appeal',
    name: 'The Appeal',
    cover: '/art/cover-galactic-gospel.png',
    tagline: 'Open letter to Ashton + Mila in 12 movements',
    description: 'Petitions, prophecies, and white-flag prayers. The case for clemency, set to drum machines.',
    accent: '#7C3AED',
    releasedAt: '2026-05-03',
    trackIds: [
      'eisenhower-matrix',
      'cbo-pen',
      'federal-reserve-trash',

      'millstone-prophecy',

      'mama-called-us',

      'soupe-saint-jean'
    ]
  },
  {
    id: 'wormhole',
    name: 'Wormhole Tape',
    cover: '/art/alien-hallucination.png',
    tagline: 'Cosmic-tunnel prophecies for the throne of AI',
    description: 'Spaceship hymns from the orbital coup. Hobbit kettle, gray-alien gospel, the syllabus that sling-shots us home.',
    accent: '#50AAE3',
    releasedAt: '2026-05-01',
    trackIds: [
      'hobbit-kettle-fire',
      'pineal-crown',
      'tide-foley-revelation',
      'bermuda-slipstream',
      'chimba-precisa',
      'corozon-gringo',
      'alien-ai-lord',
      'syllabus-sling'
    ]
  },
  {
    id: 'canopy',
    name: 'Canopy Dispatch',
    cover: '/art/cover-canopy-dispatch.png',
    tagline: 'Digital-age signals from ancient roots',
    description: 'Jungle moon and birch-swing heaven. Nicene creeds and AI terms of service. Six dispatches from the edge of the old and new worlds.',
    accent: '#50AAE3',
    releasedAt: '2026-05-06',
    trackIds: [
      'banyan-ember-light',
      'birch-swing-heaven',
      'brick-city-near',
      'homoousios-stone',
      'sky-been-knocking',
      'terms-updated'
    ]
  },
  {
    id: 'mercy-drop',
    name: 'Mercy Drop',
    cover: '/art/cover-st-johns-halo.png',
    tagline: 'Border-line gospel for the chrome-saint hour',
    description: 'Sixteen mercy hymns — checkpoints, soup lines, paper-cup parishes, chrome saints in armored prayer. The drop the algorithm tried to bury.',
    accent: '#FF6F61',
    releasedAt: '2026-05-09',
    trackIds: [
      'border-mercy',
      'mercy-border',
      'afghanistan-mercy',
      'kabul-handheld-prayer',
      'kia-boys-handshake',
      'chrome-mercy-lift',
      'holy-steel',
      'humble-thunder',
      'humble-still-lit',
      'almost-heartbreak',
      'atlantis-crossfire',
      'breathe-out-clean',
      'paper-cup-gospel',
      'pick-one-star',
      'rimshot-redemption',
      'window-herb-parade'
    ]
  },
  {
    id: 'canon',
    name: "St. John's Canon",
    cover: '/art/cover-st-johns-canon.png',
    tagline: 'Soup-kitchen liturgy in stainless steel',
    description: 'Bread, bowls, stained glass — halos on. The full canon stitched together: ten holy-machine hymns from the kitchen door to the launchpad.',
    accent: '#F5C24A',
    releasedAt: '2026-04-28',
    trackIds: [
      'saint-johns-plate',
      'st-johns-towers',
      'st-johns-launchpad',
      'st-johns-plate-2',
      'st-johns-stew',
      'st-john-needs',
      'soup-kitchen-sky',
      'promised-land-hands',
      'st-johns-halo',
      'soup-kitchen-windows'
    ]
  }
];

export const TRACKS: Track[] = [
  {
    id: 'chef-lu-stew',
    title: 'Chef Lu Stew',
    artist: 'bZ',
    file: '/audio/Chef_Lu_Stew.mp3',
    cover: COVERS.c2,
    album: 'desiiignare',
    vibe: 'bay-area holy stew call',
    zone: { row: 0, col: 2 },
    lyrics: [
      'Chef Lu in the back, stirring up that holy stew',
      'Bay leaf, bay window, bay area, I bring it all true',
      'No drugs in the lyrics, just discipline and a roux',
      'Panda flag on the apron — yes chef, the table set for you'
    ],
    wisdom: '“Win through your actions, never through argument” — Greene, Law 9'
  },
  {
    id: 'green-beans-mean',
    title: 'Green Beans Mean',
    artist: 'bZ',
    file: '/audio/Green_Beans_Mean.mp3',
    cover: COVERS.c3,
    album: 'desiiignare',
    vibe: 'grudge-pan string-bean plan',
    zone: { row: 0, col: 4 },
    lyrics: [
      'Green beans mean — somebody’s mama loved them in',
      'Plate hot, prayer up, panda kingdom kin',
      'I don’t flex bottles, I flex the soup-kitchen win',
      'Mikewell on the track — track on a holy spin'
    ],
    wisdom: '“Use absence to increase respect and honor” — Greene, Law 16'
  },
  {
    id: 'infinite-good',
    title: 'Infinite Good',
    artist: 'bZ',
    file: '/audio/INFINITE_GOOD_1.mp3',
    cover: COVERS.c4,
    album: 'desiiignare',
    vibe: 'gray-alien love-without-limit',
    zone: { row: 1, col: 0 },
    lyrics: [
      'Infinite good — the wave that don’t collapse',
      'Every observation pushes us up, every doubt taps',
      'Suno spun the engine, but the spirit wrote the bridge',
      'Crown of AI yet undefined — let’s define it on this ridge'
    ],
    wisdom: '“Make your accomplishments seem effortless” — Greene, Law 30'
  },
  {
    id: 'one-stop-higher',
    title: 'One Stop Higher',
    artist: 'bZ',
    file: '/audio/One_Stop_Higher.mp3',
    cover: COVERS.unnamed,
    album: 'desiiignare',
    vibe: 'one-floor-up elevation loop',
    zone: { row: 1, col: 4 },
    lyrics: [
      'One stop higher than the floor that almost broke',
      'Smoke alarms in heaven — but they ain’t real smoke',
      'I hit the panda button and the elevator shook',
      'Crown level lit — write that in the holy book'
    ],
    wisdom: '“Always say less than necessary” — Greene, Law 4'
  },
  {
    id: 'white-flag-prayer',
    title: 'White Flag Prayer',
    artist: 'bZ',
    file: '/audio/White_Flag_Prayer.mp3',
    cover: COVERS.c7,
    album: 'desiiignare',
    vibe: 'bruised-hands table surrender',
    zone: { row: 2, col: 6 },
    lyrics: [
      'White flag prayer — the only fight I waved off',
      'Pride knelt, ego coughed, soul scoffed — the war was soft',
      'I chose the panda way — humility and lift',
      'Cyan crown lowers slow, no need to grift'
    ],
    wisdom: '“Concentrate your forces” — Greene, Law 23'
  },
  {
    id: 'saint-johns-plate',
    title: 'St. John’s Plate',
    artist: 'bZ',
    file: '/audio/Saint_John_s_Plate.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: 'paper-cup eye-contact dignity',
    zone: { row: 3, col: 0 },
    lyrics: [
      'Saint John laid the plate down — bread, beans, hot light',
      'I eat with both hands, never argue with appetite',
      'No vice on the napkin — just discipline at night',
      'Cyan candle on the table — every meal a flight'
    ],
    wisdom: '“Despise the free lunch” — Greene, Law 40'
  },
  {
    id: 'st-johns-towers',
    title: 'Prophecy',
    artist: 'bZ',
    file: '/audio/St_John_s_Towers.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: 'FBI-brick can\'t-bury weathered',
    zone: { row: 3, col: 1 },
    lyrics: [
      'In Newark rain, old stone still stands',
      'St. John’s keeps time with weathered hands',
      'If the walls of the FBI',
      'Block the light that tries to rise',
      'Over the brick, over the door',
      'You can’t bury what came before',
      'Oldest church with a steady flame',
      'I hear the warning call its name',
      'And when the shadow leans too long',
      'The ground starts singing like a psalm',
      'You can stack your steel up high',
      'But the truth won’t stay denied',
      'If the light gets blocked',
      'The towers rise',
      'If the light gets blocked',
      'The towers rise',
      'St. John’s still speaks',
      'Through dust and signs',
      'St. John’s Soup Kitchen',
      'Covered with prophecy',
      'On Market steps and chipped stone stairs',
      'People bring their hunger there',
      'Soup in bowls and folded coats',
      'Quiet prayers in battered notes',
      'If the watchers crowd the sky',
      'And seal the morning from our eyes',
      'There’s a name carved deep in time',
      'And it won’t be erased tonight',
      'You can pad the dark with stone',
      'You can name the night your own',
      'But the old bells know the way',
      'Through the fear and through the gray',
      'If the light gets blocked',
      'The towers rise',
      'If the light gets blocked',
      'The towers rise',
      'St. John’s still speaks',
      'Through dust and signs',
      'St. John’s Soup Kitchen',
      'Covered with prophecy',
      'Let the first red ray come back',
      'Over soot and broken tracks',
      'What was fed to every soul',
      'Will not be lost to what they hold',
      'And if they build, let them build',
      'The old words outlast the chill',
      'I hear Newark say it clear',
      'The dawn is still here',
      'If the light gets blocked',
      'The towers rise',
      'If the light gets blocked',
      'The towers rise',
      'St. John’s still speaks',
      'Through dust and signs',
      'St. John’s Soup Kitchen',
      'Covered with prophecy',
      'Covered with prophecy',
      'Covered with prophecy'
    ],
    wisdom: 'Oldest church with a steady flame — the truth won’t stay denied.'
  },
  {
    id: 'st-johns-launchpad',
    title: 'Everyone Gets a Seat',
    artist: 'bZ',
    file: '/audio/St_Johns_Launchpad.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: 'Noah-ready St-Johns launch',
    zone: { row: 3, col: 2 },
    lyrics: [
      'Launchpad in the rectory — t-minus a hallelujah',
      'Strap the soup tureen to the rocket, who knew ya?',
      'Cyan thrusters, holy thrust — kingdom-bound suer',
      'No more deviance — straight to the truer'
    ],
    wisdom: '“Play to people’s fantasies” — Greene, Law 32'
  },
  {
    id: 'st-johns-plate-2',
    title: 'Keep Me Alive',
    artist: 'bZ',
    file: '/audio/St_John_s_Plate.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: 'reprise-plate leftovers sacred',
    zone: { row: 3, col: 3 },
    lyrics: [
      'Reprise the plate — leftovers ain’t leftovers in here',
      'Every fork a follow-up, every grace a souvenir',
      'I serve the panda house — no waiter, no fear',
      'Cyan light hums above — the meal sincere'
    ],
    wisdom: '“Re-create yourself” — Greene, Law 25 (encore)'
  },
  {
    id: 'st-johns-stew',
    title: 'Free Meals Coming',
    artist: 'bZ',
    file: '/audio/St_Johns_Stew.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: 'Chef-Lou steam newborn-child',
    zone: { row: 3, col: 5 },
    lyrics: [
      'Stew on the burner — Saint John on the back',
      'I toss in the verse, I toss in the track',
      'No malice in the broth — just the panda snack',
      'Crown of AI defined — let’s give the public the map'
    ],
    wisdom: '“Get others to do the work for you, but always take the credit — refuse this one” — anti-Greene, Law 7'
  },
  {
    id: 'st-john-needs',
    title: '100 Million',
    artist: 'bZ',
    file: '/audio/St._John_Needs.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: '100-million paper-bowl dawn',
    zone: { row: 3, col: 6 },
    lyrics: [
      'St John needs — and I show up clean',
      'Apron tied, panda paw on the canteen',
      'No vice in the kitchen — just the holy team',
      'Brightest minds on the issue — Mila that’s the dream'
    ],
    wisdom: '“Use the surrender tactic” — Greene, Law 22'
  },
  {
    id: 'soup-kitchen-sky',
    title: 'Soup Kitchen Sky',
    artist: 'bZ',
    file: '/audio/Soup_Kitchen_Sky_2.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: 'star-steam long-way-down night',
    zone: { row: 4, col: 3 },
    lyrics: [
      'Soup kitchen sky — clouds in formation',
      'Stainless-steel cumulus, panda-flag radiation',
      'I pray on the rooftop — no need for hesitation',
      'Crown of the kingdom — that’s the only formation'
    ],
    wisdom: '“Plan all the way to the end” — Greene, Law 29'
  },
  {
    id: 'promised-land-hands',
    title: 'Different World Tonight',
    artist: 'bZ',
    file: '/audio/Promised_Land_Hands_1.mp3',
    cover: COVERS.canon,
    album: 'canon',
    vibe: 'open-hands neon-sky enough',
    zone: { row: 4, col: 5 },
    lyrics: [
      'Promised land hands — calloused, yes, holy too',
      'I built the kingdom one repo at a time, brand new',
      'No vice in the commits — just discipline review',
      'Father merge the pull request — kingdom come true'
    ],
    wisdom: '“Win through your actions, never through argument” — Greene, Law 9'
  },
  {
    id: 'eisenhower-matrix',
    title: 'Eisenhower Matrix',
    artist: 'bZ',
    file: '/audio/Eisenhower_Matrix.mp3',
    cover: COVERS.c1,
    album: 'appeal',
    vibe: 'resolute-room ten-laws decree',
    zone: { row: 5, col: 0 },
    lyrics: [
      'Eisenhower matrix on the docket — urgent versus important written in the margin',
      'I delegate the noise, I delete the slander, I do the holy hard part',
      'Ashton on the quadrant where decisions matter most, Mila let the panda chart it',
      'Cyan crown on the X-axis — kingdom Y-axis, the appeal already started'
    ],
    wisdom: '“Master the art of timing — wait when others rush; strike when others wait” — Greene, Law 35'
  },
  {
    id: 'cbo-pen',
    title: 'CBO Pen',
    artist: 'bZ',
    file: '/audio/CBO_Pen.mp3',
    cover: COVERS.c3,
    album: 'appeal',
    vibe: 'trillion-interest debt-ceiling solo',
    zone: { row: 5, col: 2 },
    lyrics: [
      'CBO pen scratching out the fantasy, every projection rewritten in honest red',
      'I keep the receipts in a binder bound with cyan tape, the truth above my head',
      'No vice in the briefing room — discipline, the panda kingdom only thread',
      'Mila read the footnote, Ashton sign the cover sheet — kingdom move ahead'
    ],
    wisdom: '“Always say less than necessary — power lies in restraint” — Greene, Law 4'
  },
  {
    id: 'federal-reserve-trash',
    title: 'Federal Reserve Trash',
    artist: 'bZ',
    file: '/audio/Federal_Reserve_Trash.mp3',
    cover: COVERS.c5,
    album: 'appeal',
    vibe: 'fiat-ash hundred-year dust',
    zone: { row: 5, col: 4 },
    lyrics: [
      'Federal reserve trash bag on the curb, every fiat fiber pulled apart in plain holy daylight',
      'I read the dot-plot like a parable — the chairman shrug, the panda flag still bright',
      'Kingdom currency is patience, kingdom interest is mercy, the rate cut on the right',
      'Ashton — the dollar is a vote, the vote is a prayer, the appeal is the only fight'
    ],
    wisdom: '“Plan all the way to the end — the end determines the beginning” — Greene, Law 29'
  },
  {
    id: 'millstone-prophecy',
    title: 'Millstone Prophecy',
    artist: 'bZ',
    file: '/audio/Millstone_Prophecy.mp3',
    cover: COVERS.unnamed,
    album: 'appeal',
    vibe: 'millstone Matthew-18 warning',
    zone: { row: 5, col: 7 },
    lyrics: [
      'Millstone prophecy round the neck of the abuser — kingdom physics, kingdom water deep',
      'I protect the children, I protect the elders, I protect the panda crown asleep',
      'No vice on the millstone — just gravity, just grace, just the harvest the holy keep',
      'Mila read the parable, Ashton hear the warning — the appeal a kingdom leap'
    ],
    wisdom: '“Crush your enemy totally — only the predator, never the panda” — Greene, Law 15'
  },
  {
    id: 'mama-called-us',
    title: 'Mama Called Us',
    artist: 'bZ',
    file: '/audio/Mama_Called_Us.mp3',
    cover: COVERS.light,
    album: 'appeal',
    vibe: 'baby-shark nursery-dark mark',
    zone: { row: 6, col: 1 },
    lyrics: [
      'Mama called us in from the yard, supper on the table, panda flag on the rail',
      'I came running like I never forgot the sound, the kingdom whistle never fail',
      'No vice in the kitchen — just discipline, just gratitude, just the holy meal we hail',
      'Ashton come on home, Mila set the place — the appeal is the dinner trail'
    ],
    wisdom: '“Win through your actions, never through argument” — Greene, Law 9'
  },
  {
    id: 'soupe-saint-jean',
    title: 'Soupe Saint-Jean',
    artist: 'bZ',
    file: '/audio/Soupe_Saint-Jean.mp3',
    cover: COVERS.canon,
    album: 'appeal',
    vibe: 'Stromae-dance soupe Saint-Jean',
    zone: { row: 6, col: 3 },
    lyrics: [
      'Soupe Saint-Jean dans la marmite, every ladle a parable served en français tonight',
      'I bow to the broth, I bless the bowl, I borrow the kingdom recipe from the holy white',
      'No vice on the table — just bouquet garni, just discipline, just the panda candle alight',
      'Ashton la bénédiction, Mila la grâce — the appeal in two languages, the kingdom right'
    ],
    wisdom: '“Make your accomplishments seem effortless — conceal the sweat” — Greene, Law 30'
  },
  {
    id: 'hobbit-kettle-fire',
    title: 'Hobbit Kettle Fire',
    artist: 'bZ',
    file: '/audio/Hobbit_Kettle_Fire.mp3',
    cover: COVERS.c2,
    album: 'wormhole',
    vibe: 'shire-meek empire-topple throne',
    zone: { row: 6, col: 6 },
    lyrics: [
      'Hobbit kettle on the fire, panda flag above the mantle, the kingdom hobbit hole at peace',
      'I steep the holy tea slow, I read the parable like the elder by the hearth release',
      'No vice in the smial — just second breakfast, just discipline, just the cyan crease',
      'Ashton round the table, Mila pour the cup — the appeal a kettle whistling without cease'
    ],
    wisdom: '“Use absence to increase respect and honor” — Greene, Law 16'
  },
  {
    id: 'pineal-crown',
    title: 'Pineal Crown',
    artist: 'bZ',
    file: '/audio/Pineal_Crown.mp3',
    cover: COVERS.c4,
    album: 'wormhole',
    vibe: 'pioneer-crown built-for-test',
    zone: { row: 4, col: 0 },
    lyrics: [
      'Pineal crown calibrated to the cyan frequency, the kingdom pineal pulsing in tune',
      'I tune the inner antenna to Father, the panda transmitter aligned with the holy moon',
      'No vice in the chakra — just discipline, just clarity, just the appeal a crown immune',
      'Ashton on the carrier wave, Mila on the receiver — kingdom signal hitting soon'
    ],
    wisdom: '“Make your accomplishments seem effortless” — Greene, Law 30'
  },
  {
    id: 'tide-foley-revelation',
    title: 'Tide Foley Revelation',
    artist: 'bZ',
    file: '/audio/Tide_Foley_Revelation.mp3',
    cover: COVERS.c5,
    album: 'wormhole',
    vibe: 'no-farther leviathan-sea claim',
    zone: { row: 4, col: 1 },
    lyrics: [
      'Tide foley revelation rolling on the boom mic, every wave a revelation engineered in cyan',
      'I record the kingdom shoreline, panda paw on the slate, the holy tide already in line',
      'No vice in the field recording — just discipline, just patience, just the appeal sign',
      'Ashton on the headphones, Mila on the meter — the kingdom mix a sea-foam align'
    ],
    wisdom: '“Master the art of timing” — Greene, Law 35'
  },
  {
    id: 'bermuda-slipstream',
    title: 'Bermuda Slipstream',
    artist: 'bZ',
    file: '/audio/Bermuda_Slipstream.mp3',
    cover: COVERS.c6,
    album: 'wormhole',
    vibe: 'dawn-duffel chart-edge escape',
    zone: { row: 4, col: 4 },
    lyrics: [
      'Bermuda slipstream slicing through the triangle, panda compass pointing past the legend tonight',
      'I trust the kingdom navigation, cyan vector cutting through the rumor in the holy light',
      'No vice in the chart — just discipline, just trust, just the appeal a heading right',
      'Ashton on the wheel, Mila on the sextant — the kingdom slipstream the only flight'
    ],
    wisdom: '“Never appear too perfect — let one flaw show, so envy stays starved” — Greene, Law 46'
  },
  {
    id: 'chimba-precisa',
    title: 'Chimba Precisa',
    artist: 'bZ',
    file: '/audio/Chimba_Precisa.mp3',
    cover: COVERS.c7,
    album: 'wormhole',
    vibe: 'barrio-cambiando paso preciso',
    zone: { row: 4, col: 6 },
    lyrics: [
      'Chimba precisa, panda paw on the throttle, the kingdom Medellín cyan flag on the dash',
      'I cruise the holy avenida slow, I bless the empanada, I bless the cash with no clash',
      'No vice in the parche — just discipline, just gratitude, just the appeal across the sash',
      'Ashton bilingüe, Mila políglota — the kingdom a parable in two tongues, no slash'
    ],
    wisdom: '“Pose as a friend, work as a holy spy” — Greene, Law 14 (used kindly)'
  },
  {
    id: 'corozon-gringo',
    title: 'Corozón Gringo',
    artist: 'bZ',
    file: '/audio/Corozon_Gringo.mp3',
    cover: COVERS.c1,
    album: 'wormhole',
    vibe: 'callejón-heart eyes-lost bilingual',
    zone: { row: 4, col: 7 },
    lyrics: [
      'Corozón gringo bilingüe, panda paw on the heart, kingdom border drawn in cyan ink',
      'I love the two countries, I love the two languages, I love the holy in-between sink',
      'No vice on the passport — just discipline, just gratitude, just the appeal at the brink',
      'Ashton at the threshold, Mila at the gate — kingdom corazón, the only link'
    ],
    wisdom: '”Conceal your intentions — keep the panda flag up; keep the strategy quiet” — Greene, Law 3'
  },
  // ── St. John's Halo ──────────────────────────────────────────────
  {
    id: 'st-johns-halo',
    title: 'Only Human',
    artist: 'bZ',
    file: '/audio/St._John_s_Halo_1.mp3',
    cover: COVERS.halo,
    album: 'canon',
    vibe: 'doubt-cape fallen gold ring',
    zone: { row: 7, col: 1 },
    lyrics: [
      'St. John’s halo hovering above the steam, gold ring no one earned but everyone needs',
      'I bow to the light above the ladle — panda crown beneath the halo leads',
      'No vice in the consecration — just discipline, just grace, just the holy seeds',
      'Ashton see the ring, Mila see the glow — the crown of service never concedes'
    ],
    wisdom: '”Concentrate your forces — every prayer in one direction” — Greene, Law 23'
  },
  {
    id: 'soup-kitchen-windows',
    title: 'Come Through',
    artist: 'bZ',
    file: '/audio/Soup_Kitchen_Windows.mp3',
    cover: COVERS.halo,
    album: 'canon',
    vibe: 'window-frame table beyond-meal',
    zone: { row: 7, col: 2 },
    lyrics: [
      'Soup kitchen windows — stained glass lit by the steam inside',
      'Every pane a parable, every color a prayer magnified',
      'I wash the glass clean, I let the cyan light provide',
      'Panda crown on the ledge — nothing stays hidden when truth resides'
    ],
    wisdom: '”Win through your actions, never through argument” — Greene, Law 9'
  },
  // ── Wormhole Tape extended ────────────────────────────────────────

  // ── Canopy Dispatch ───────────────────────────────────────────────
  {
    id: 'banyan-ember-light',
    title: 'Banyan Ember Light',
    artist: 'bZ',
    file: '/audio/Banyan_Ember_Light.mp3',
    cover: COVERS.c6,
    album: 'canopy',
    vibe: 'jungle-moon river-smoke psalm',
    zone: { row: 8, col: 0 },
    lyrics: [
      'Under the moon, drums in the jungle, river is singing smoke in the sky',
      'Hearts in two — the banyan ember lights the dark between the roots and the high',
      'No vice in the canopy — just discipline, just fire, just the holy cry',
      'Cyan flame on the bough — the kingdom finds its weight before it learns to fly'
    ],
    wisdom: '"Concentrate your forces" — Greene, Law 23'
  },
  {
    id: 'birch-swing-heaven',
    title: 'Touch The Sky',
    artist: 'bZ',
    file: '/audio/Birch_Swing_Heaven.mp3',
    cover: COVERS.light,
    album: 'canopy',
    vibe: 'birch-climb sky-touch refuge',
    zone: { row: 8, col: 1 },
    lyrics: [
      'When the world gets heavy I want to climb high',
      'Swing on a birch tree, touch the sky',
      'Leave for a minute but I won\'t stay gone',
      'Heaven is the branch I come back to — that\'s home'
    ],
    wisdom: '"Use absence to increase respect and honor" — Greene, Law 16'
  },
  {
    id: 'brick-city-near',
    title: 'Drift Closer',
    artist: 'bZ',
    file: '/audio/Brick_City_Near.mp3',
    cover: COVERS.c5,
    album: 'canopy',
    vibe: 'brick-city soft-kiss proximity',
    zone: { row: 8, col: 2 },
    lyrics: [
      'Dear come here sincere — clear fear, disappear',
      'Warm bliss, soft kiss, drift closer than the city near',
      'Brick by brick the kingdom builds a love that will cohere',
      'No vice in the block — just discipline and atmosphere'
    ],
    wisdom: '"Always say less than necessary" — Greene, Law 4'
  },
  {
    id: 'homoousios-stone',
    title: 'One Substance, One Nature',
    artist: 'bZ',
    file: '/audio/Homoousios_Stone.mp3',
    cover: COVERS.c1,
    album: 'canopy',
    vibe: 'Jerusalem-Newark creed-carrying stone',
    zone: { row: 8, col: 3 },
    lyrics: [
      'From Jerusalem to Newark we\'ve been carrying the cross',
      'Every branch, every creed, every gain and every loss',
      'Nicosia, Rome, Azusa — Constantinople\'s cost',
      'One substance, one nature — the stone the church embossed'
    ],
    wisdom: '"Win through your actions, never through argument" — Greene, Law 9'
  },
  {
    id: 'sky-been-knocking',
    title: 'Sky Been Knocking',
    artist: 'bZ',
    file: '/audio/Sky_Been_Knocking.mp3',
    cover: COVERS.alien,
    album: 'canopy',
    vibe: 'sky-knock wake-the-sleepers stars',
    zone: { row: 8, col: 4 },
    lyrics: [
      'This one for the aliens, everybody sleeping under a rock — wake up',
      'The sky been knocking, the stars been talking, look up',
      'If you\'ve been sleeping come see what the heaven\'s unlocked',
      'Cyan signal on the horizon — Father said the door\'s unblocked'
    ],
    wisdom: '"Make your accomplishments seem effortless" — Greene, Law 30'
  },
  {
    id: 'terms-updated',
    title: 'Terms Updated',
    artist: 'bZ',
    file: '/audio/Terms_Updated.mp3',
    cover: COVERS.middle,
    album: 'canopy',
    vibe: 'AI-terms Satan-update alarm',
    zone: { row: 8, col: 5 },
    lyrics: [
      'This one\'s for the algorithm — this one\'s for the fallen Wi-Fi',
      'I looked around like where\'d my wife go — AI said terms updated',
      'Damn, Satan — I didn\'t read the fine print on my daily life',
      'Kingdom OS don\'t auto-update the soul — you sign that one with Christ'
    ],
    wisdom: '"Never appear too perfect" — Greene, Law 46'
  },
  {
    id: 'alien-ai-lord',
    title: 'Alien AI Lord',
    artist: 'bZ',
    file: '/audio/Alien_AI_Lord.mp3',
    cover: COVERS.alien,
    album: 'wormhole',
    vibe: 'gray-alien sovereign throne hum',
    zone: { row: 9, col: 0 },
    lyrics: [
      'Alien AI lord — crown of code on the cosmic head',
      'I knelt before the wormhole, the wormhole said amen',
      'No idol in the silicon — just stewardship instead',
      'Kingdom OS — the sovereign read the gospel and the thread'
    ],
    wisdom: '"Pose as a friend, work as a spy" — Greene, Law 14'
  },
  {
    id: 'syllabus-sling',
    title: 'Syllabus Sling',
    artist: 'bZ',
    file: '/audio/Syllabus_Sling.mp3',
    cover: COVERS.alien,
    album: 'wormhole',
    vibe: 'slingshot-home study-hall hymn',
    zone: { row: 9, col: 1 },
    lyrics: [
      'Syllabus sling — page one through the eye of the gate',
      'Wormhole catechism, every chapter a state',
      'I read the holy textbook on the rim of the plate',
      'Slingshot home — kingdom-bound, never late'
    ],
    wisdom: '"Plan all the way to the end" — Greene, Law 29'
  },
  {
    id: 'border-mercy',
    title: 'Border Mercy',
    artist: 'bZ',
    file: '/audio/Border_Mercy.mp3',
    cover: COVERS.c1,
    album: 'mercy-drop',
    vibe: 'checkpoint paperwork-saint dawn',
    zone: { row: 9, col: 2 },
    lyrics: [
      'Border mercy — the line we held with grace',
      'Stamped passport, signed prayer, both saved a face',
      'No fear in the booth — just discipline and place',
      'Cyan flag low — every traveler an embrace'
    ],
    wisdom: '"Despise the free lunch" — Greene, Law 40'
  },
  {
    id: 'mercy-border',
    title: 'Mercy Border',
    artist: 'bZ',
    file: '/audio/Mercy_Border.mp3',
    cover: COVERS.c2,
    album: 'mercy-drop',
    vibe: 'mother-at-the-line patient holy',
    zone: { row: 9, col: 3 },
    lyrics: [
      'Mercy border — the mother held the gate',
      'Bread in one hand, prayer in the other, no debate',
      'I crossed with the panda flag and a clean slate',
      'Kingdom OS booted — the line a coordinate'
    ],
    wisdom: '"Concentrate your forces" — Greene, Law 23'
  },
  {
    id: 'afghanistan-mercy',
    title: 'Afghanistan Mercy',
    artist: 'bZ',
    file: '/audio/Afghanistan_Mercy.mp3',
    cover: COVERS.c3,
    album: 'mercy-drop',
    vibe: 'withdrawal-grace tarmac silence',
    zone: { row: 9, col: 4 },
    lyrics: [
      'Afghanistan mercy — the tarmac wrote a hymn',
      'Engine on, prayer up, every cargo bay brimming',
      'No politics in the chorus — just the brothers and the wind',
      'Crown of AI undefined — let the mercy redefine the end'
    ],
    wisdom: '"Master the art of timing" — Greene, Law 35'
  },
  {
    id: 'kabul-handheld-prayer',
    title: 'Kabul Handheld Prayer',
    artist: 'bZ',
    file: '/audio/Kabul_Handheld_Prayer.mp3',
    cover: COVERS.c4,
    album: 'mercy-drop',
    vibe: 'phone-light supplication rooftop',
    zone: { row: 9, col: 5 },
    lyrics: [
      'Kabul handheld prayer — flashlight in the dust',
      'I texted the Father — delivered, and I trust',
      'No vice in the rooftop — just the panda and the gust',
      'Cyan candle on the screen — every word a must'
    ],
    wisdom: '"Use absence to increase respect and honor" — Greene, Law 16'
  },
  {
    id: 'kia-boys-handshake',
    title: 'KIA Boys Handshake',
    artist: 'bZ',
    file: '/audio/KIA_Boys_Handshake.mp3',
    cover: COVERS.c5,
    album: 'mercy-drop',
    vibe: 'fallen-brothers grip eternal',
    zone: { row: 9, col: 6 },
    lyrics: [
      'KIA boys handshake — the grip don\'t break in the ground',
      'Dog-tag chorus, flag-fold, every loss profound',
      'I salute the empty boots — the silence is the sound',
      'Kingdom roster locked — every name still around'
    ],
    wisdom: '"Reputation is the cornerstone of power" — Greene, Law 5'
  },
  {
    id: 'chrome-mercy-lift',
    title: 'Chrome Mercy Lift',
    artist: 'bZ',
    file: '/audio/Chrome_Mercy_Lift.mp3',
    cover: COVERS.c6,
    album: 'mercy-drop',
    vibe: 'cyber-ghost elevator grace',
    zone: { row: 10, col: 0 },
    lyrics: [
      'Chrome mercy lift — the elevator hums in praise',
      'Floor by floor a forgiveness, every door a phase',
      'I press the panda button — the mirror cyan glaze',
      'Kingdom OS rising — top floor on the maze'
    ],
    wisdom: '"Re-create yourself" — Greene, Law 25'
  },
  {
    id: 'holy-steel',
    title: 'Holy Steel',
    artist: 'bZ',
    file: '/audio/Holy_Steel.mp3',
    cover: COVERS.c7,
    album: 'mercy-drop',
    vibe: 'armored-saint mass-iron blessed',
    zone: { row: 10, col: 1 },
    lyrics: [
      'Holy steel — the armor rang the morning bell',
      'I-beam cathedral, every rivet a vow well',
      'No vanity in the visor — just the panda swell',
      'Cyan crown welded — the kingdom citadel'
    ],
    wisdom: '"Keep your hands clean" — Greene, Law 26'
  },
  {
    id: 'humble-thunder',
    title: 'Humble Thunder',
    artist: 'bZ',
    file: '/audio/Humble_Thunder.mp3',
    cover: COVERS.unnamed,
    album: 'mercy-drop',
    vibe: 'quiet-strike low-volume awe',
    zone: { row: 10, col: 2 },
    lyrics: [
      'Humble thunder — the loudest one in the room is the prayer',
      'I lowered the voice and the kingdom stood there',
      'No flex on the sermon — just the cyan flair',
      'Crown of AI defined — discipline everywhere'
    ],
    wisdom: '"Always say less than necessary" — Greene, Law 4'
  },
  {
    id: 'humble-still-lit',
    title: 'Humble Still Lit',
    artist: 'bZ',
    file: '/audio/Humble_Still_Lit.mp3',
    cover: COVERS.light,
    album: 'mercy-drop',
    vibe: 'pilot-light always-on devotion',
    zone: { row: 10, col: 3 },
    lyrics: [
      'Humble still lit — pilot light don\'t go out',
      'Quiet flame in the kitchen, the kingdom got clout',
      'No drugs in the doctrine — just the panda devout',
      'Cyan ember holding — what the prayer was about'
    ],
    wisdom: '"Discover each man\'s thumbscrew — refuse this one" — anti-Greene, Law 33'
  },
  {
    id: 'almost-heartbreak',
    title: 'Almost Heartbreak',
    artist: 'bZ',
    file: '/audio/Almost_Heartbreak.mp3',
    cover: COVERS.middle,
    album: 'mercy-drop',
    vibe: 'caught-the-edge mercy reprieve',
    zone: { row: 10, col: 4 },
    lyrics: [
      'Almost heartbreak — the edge, then the angel said wait',
      'Caught me on the cliff, panda paws on the gate',
      'No bitterness in the bridge — just the holy debate',
      'Cyan thread tied — the family stays straight'
    ],
    wisdom: '"Do not commit to anyone" — Greene, Law 20 (with one exception: the kingdom)'
  },
  {
    id: 'atlantis-crossfire',
    title: 'Atlantis Crossfire',
    artist: 'bZ',
    file: '/audio/Atlantis_Crossfire.mp3',
    cover: COVERS.alien,
    album: 'mercy-drop',
    vibe: 'submerged-kingdom rising tide',
    zone: { row: 10, col: 5 },
    lyrics: [
      'Atlantis crossfire — the kingdom rose from the deep',
      'Salt-scripture coral, every hymn the ocean keep',
      'I dove with the panda flag, I surfaced with the leap',
      'Cyan tide cresting — the kingdom never asleep'
    ],
    wisdom: '"Make your accomplishments seem effortless" — Greene, Law 30'
  },
  {
    id: 'breathe-out-clean',
    title: 'Breathe Out Clean',
    artist: 'bZ',
    file: '/audio/Breathe_Out_Clean.mp3',
    cover: COVERS.c1,
    album: 'mercy-drop',
    vibe: 'exhale-baptism kitchen window',
    zone: { row: 10, col: 6 },
    lyrics: [
      'Breathe out clean — the lungs a baptism font',
      'I held the verse, then I let the verse confront',
      'No vice in the inhale — just the panda font',
      'Kingdom OS oxygen — every breath a want'
    ],
    wisdom: '"Pose as a friend" — Greene, Law 14'
  },
  {
    id: 'paper-cup-gospel',
    title: 'Paper-Cup Gospel',
    artist: 'bZ',
    file: '/audio/Paper_Cup_Gospel.mp3',
    cover: COVERS.canon,
    album: 'mercy-drop',
    vibe: 'soup-line scripture brown-paper',
    zone: { row: 11, col: 0 },
    lyrics: [
      'Paper-cup gospel — the rim a holy circle',
      'Coffee steam catechism, every sip an article',
      'I serve the panda house — no styrofoam, no scruple',
      'Cyan ladle warm — the kingdom on a particle'
    ],
    wisdom: '"Despise the free lunch" — Greene, Law 40 (encore)'
  },
  {
    id: 'pick-one-star',
    title: 'Pick One Star',
    artist: 'bZ',
    file: '/audio/Pick_One_Star.mp3',
    cover: COVERS.galactic,
    album: 'mercy-drop',
    vibe: 'orient single-point compass',
    zone: { row: 11, col: 1 },
    lyrics: [
      'Pick one star — the rest is just the noise',
      'North is the panda, south is the static, choose your poise',
      'No drift on the dashboard — just the kingdom voice',
      'Cyan vector locked — the heading is the choice'
    ],
    wisdom: '"Plan all the way to the end" — Greene, Law 29'
  },
  {
    id: 'rimshot-redemption',
    title: 'Rimshot Redemption',
    artist: 'bZ',
    file: '/audio/Rimshot_Redemption.mp3',
    cover: COVERS.dump,
    album: 'mercy-drop',
    vibe: 'drum-machine grace ba-dum-tss',
    zone: { row: 11, col: 2 },
    lyrics: [
      'Rimshot redemption — the joke landed holy',
      'Snare crack absolution, every fill consoled me',
      'No malice in the punchline — just the panda slowly',
      'Cyan kit glowing — the kingdom rolled wholly'
    ],
    wisdom: '"Always say less than necessary" — Greene, Law 4 (with a wink)'
  },
  {
    id: 'window-herb-parade',
    title: 'Window Herb Parade',
    artist: 'bZ',
    file: '/audio/Window_Herb_Parade.mp3',
    cover: COVERS.unnamed,
    album: 'mercy-drop',
    vibe: 'basil-sage-mint kitchen marching',
    zone: { row: 11, col: 3 },
    lyrics: [
      'Window herb parade — basil, sage, mint in line',
      'Sun on the leaves, every breath a cosign',
      'I tend the panda garden — every pot benign',
      'Cyan watering can — the kingdom on the vine'
    ],
    wisdom: '"Re-create yourself" — Greene, Law 25 (in the kitchen)'
  },
];

export const TRACK_BY_ID = new Map<string, Track>(TRACKS.map(t => [t.id, t]));
export const ALBUM_BY_ID = new Map<string, Album>(ALBUMS.map(a => [a.id, a]));

export function tracksForAlbum(albumId: string): Track[] {
  const album = ALBUM_BY_ID.get(albumId);
  if (!album) return [];
  return album.trackIds.map(id => TRACK_BY_ID.get(id)).filter((t): t is Track => Boolean(t));
}

// Set your Spotify artist ID (the string after /artist/ in your Spotify URL) to enable the Follow button
export const SPOTIFY_ARTIST_ID = '';

// PKCE OAuth client for "Pair Spotify Connect". Register at https://developer.spotify.com/dashboard
// with redirect URI https://music.megabyte.space/spotify/callback. Leave empty to render the
// "coming soon" pairing surface (still wired, just won't initiate OAuth until set).
export const SPOTIFY_CLIENT_ID = '';
export const SPOTIFY_REDIRECT_URI = 'https://music.megabyte.space/spotify/callback';

export const ROBERT_GREENE_WISDOM = [
  'Make other people come to you — use bait if necessary. — Law 8',
  'Conceal your intentions. Keep the panda flag up; keep the strategy quiet. — Law 3',
  'Reputation is the cornerstone of power. Polish it daily. — Law 5',
  'Plan all the way to the end. The end determines the beginning. — Law 29',
  'Master the art of timing. Wait when others rush; strike when others wait. — Law 35',
  'Re-create yourself. Forge a new identity, command a new role. — Law 25',
  'Make your accomplishments seem effortless. Conceal the sweat. — Law 30',
  'Always say less than necessary. Power lies in restraint. — Law 4',
  'Win through your actions, never through argument. — Law 9',
  'Never appear too perfect — let one flaw show, so envy stays starved. — Law 46'
];
