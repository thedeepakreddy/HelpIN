import type { Kind, Precision, ProblemStatus, ProgressStatus, Urgency } from '@helpin/config';
import type { LatLng } from '@helpin/geo';

/** Internal (server-side) records of the mock. Never returned directly: see mockApi `present*`. */

export interface UserRec {
  id: string;
  displayName: string;
  fullName: string;
  initials: string;
  color: string;
  karma: number;
  neighboursHelped: number;
  reliability: number | null;
  languages: string[];
  isNewcomer: boolean;
  bio: string;
  memberSince: string;
  phone: string;
}

export interface UpdateRec {
  id: string;
  authorId: string;
  authorRole: 'asker' | 'helper' | 'affected';
  progressStatus: ProgressStatus;
  body: string | null;
  createdAt: number;
}

export interface OfferRec {
  id: string;
  problemId: string;
  helperId: string;
  message: string | null;
  status: 'offered' | 'accepted' | 'declined' | 'withdrawn' | 'credited' | 'closed';
  createdAt: number;
  claimedSolved: boolean;
  conversationId: string | null;
}

export interface ProblemRec {
  id: string;
  incidentId: string;
  askerId: string;
  anonymous: boolean;
  title: string;
  description: string;
  categoryId: string;
  kind: Kind;
  urgency: Urgency;
  status: ProblemStatus;
  /** Exact point: private (L-03). */
  exact: LatLng;
  precision: Precision;
  locality: string;
  district: string;
  languageNeeded: string | null;
  createdAt: number;
  lastActivityAt: number;
  lastRaiserResponseAt: number | null;
  responseDueAt: number | null;
  photoCount: number;
  affected: string[];
  fixedVotes: string[];
  updates: UpdateRec[];
  creditedHelperIds: string[];
}

export interface ConversationRec {
  id: string;
  problemId: string;
  askerId: string;
  helperId: string;
  readOnly: boolean;
}

export interface MessageRec {
  id: string;
  conversationId: string;
  senderId: string | null;
  type: 'text' | 'image' | 'location' | 'system';
  body: string | null;
  location: LatLng | null;
  createdAt: number;
}

export interface PostRec {
  id: string;
  kind: 'photo' | 'thank_you' | 'welcome';
  authorId: string;
  communityId: string | null;
  caption: string | null;
  image: string | null;
  createdAt: number;
  likedBy: string[];
  baseLikes: number;
  comments: number;
  problemId: string | null;
  thankedIds: string[];
  district: string;
}

export interface CommunityRec {
  id: string;
  name: string;
  type: 'district' | 'language_culture' | 'students' | 'civic_environment' | 'interest';
  description: string;
  members: string[];
  baseMembers: number;
  newPosts: number;
  color: string;
}

export interface NotificationRec {
  id: string;
  userId: string;
  type:
    | 'response_due'
    | 'solve_claimed'
    | 'karma'
    | 'nearby_problem'
    | 'offer_received'
    | 'offer_accepted'
    | 'problem_updated'
    | 'community'
    | 'message';
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  link: string;
  problemId: string | null;
}

export interface KarmaRec {
  id: string;
  userId: string;
  /** The asker who credited (pair rules K-05/K-06). */
  sourceUserId?: string;
  amount: number;
  reason:
    | 'solve_award'
    | 'closing_award'
    | 'pair_cooldown'
    | 'pair_cap'
    | 'ineligible_account'
    | 'abandonment_penalty'
    | 'fake_problem_penalty'
    | 'reversal';
  label: string;
  createdAt: number;
}

export interface MockDb {
  users: UserRec[];
  problems: ProblemRec[];
  offers: OfferRec[];
  conversations: ConversationRec[];
  messages: MessageRec[];
  posts: PostRec[];
  communities: CommunityRec[];
  notifications: NotificationRec[];
  karma: KarmaRec[];
  seq: number;
}

const H = 3_600_000;
const D = 24 * H;

export function createSeed(now = Date.now()): MockDb {
  const ago = (ms: number) => now - ms;

  const users: UserRec[] = [
    {
      id: 'u_zsofi',
      displayName: 'Zsófi K.',
      fullName: 'Zsófi Kovács',
      initials: 'ZK',
      color: 'brand',
      karma: 210,
      neighboursHelped: 31,
      reliability: 0.98,
      languages: ['hu', 'en', 'de'],
      isNewcomer: false,
      bio: 'Budapest local · language buddy. Happy to translate letters, explain offices and show you the best lángos in District XI.',
      memberSince: '2026-09-02',
      phone: '+36301234567',
    },
    {
      id: 'u_arjun',
      displayName: 'Arjun S.',
      fullName: 'Arjun Sharma',
      initials: 'AS',
      color: 'amber',
      karma: 12,
      neighboursHelped: 1,
      reliability: null,
      languages: ['en', 'hi'],
      isNewcomer: true,
      bio: "Master's student at BME, three weeks in Budapest. Can help with English, Hindi and spreadsheets.",
      memberSince: '2026-09-14',
      phone: '+36309876543',
    },
    {
      id: 'u_bence',
      displayName: 'Bence T.',
      fullName: 'Bence Tóth',
      initials: 'BT',
      color: 'sapphire',
      karma: 45,
      neighboursHelped: 4,
      reliability: 0.9,
      languages: ['hu', 'en'],
      isNewcomer: false,
      bio: 'Engineer, cyclist, District XI since forever.',
      memberSince: '2026-09-05',
      phone: '+36301112222',
    },
    {
      id: 'u_david',
      displayName: 'Dávid S.',
      fullName: 'Dávid Szabó',
      initials: 'DS',
      color: 'coral',
      karma: 12,
      neighboursHelped: 1,
      reliability: null,
      languages: ['hu', 'es'],
      isNewcomer: false,
      bio: 'Works near the Kormányablak on Bocskai út.',
      memberSince: '2026-09-20',
      phone: '+36303334444',
    },
    {
      id: 'u_lili',
      displayName: 'Lili R.',
      fullName: 'Lili Rácz',
      initials: 'LR',
      color: 'sapphire',
      karma: 88,
      neighboursHelped: 9,
      reliability: 0.95,
      languages: ['hu', 'en', 'fr'],
      isNewcomer: false,
      bio: 'Organiser of the Feneketlen-tó clean-ups.',
      memberSince: '2026-09-03',
      phone: '+36305556666',
    },
    {
      id: 'u_olena',
      displayName: 'Olena K.',
      fullName: 'Olena Kovalenko',
      initials: 'OK',
      color: 'tram',
      karma: 20,
      neighboursHelped: 2,
      reliability: 1,
      languages: ['uk', 'ru', 'en'],
      isNewcomer: true,
      bio: 'Teacher from Kharkiv, now in Budapest with my daughter.',
      memberSince: '2026-09-10',
      phone: '+36307778888',
    },
    {
      id: 'u_reka',
      displayName: 'Réka M.',
      fullName: 'Réka Molnár',
      initials: 'RM',
      color: 'mint',
      karma: 64,
      neighboursHelped: 6,
      reliability: 0.92,
      languages: ['hu', 'en'],
      isNewcomer: false,
      bio: 'Block C rep for our társasház.',
      memberSince: '2026-09-04',
      phone: '+36309990000',
    },
    {
      id: 'u_wei',
      displayName: 'Wei L.',
      fullName: 'Wei Lin',
      initials: 'WL',
      color: 'coral',
      karma: 8,
      neighboursHelped: 1,
      reliability: null,
      languages: ['zh', 'en'],
      isNewcomer: true,
      bio: 'PhD student, new in town, very good at fixing bikes.',
      memberSince: '2026-09-22',
      phone: '+36301010101',
    },
  ];

  const upd = (
    id: string,
    authorId: string,
    authorRole: UpdateRec['authorRole'],
    progressStatus: ProgressStatus,
    body: string | null,
    at: number,
  ): UpdateRec => ({ id, authorId, authorRole, progressStatus, body, createdAt: at });

  const problems: ProblemRec[] = [
    {
      id: 'p_letter',
      incidentId: 'i_letter',
      askerId: 'u_arjun',
      anonymous: false,
      title: 'Help reading a letter from the district office',
      description:
        "I moved here 3 weeks ago for my master's. This letter is about my address registration, but I can't tell what it's asking me to do or by when. My name and ID numbers are covered in the photos.",
      categoryId: 'paperwork_offices',
      kind: 'request',
      urgency: 'medium',
      status: 'open',
      exact: { lat: 47.47721, lng: 19.04802 },
      precision: 'standard',
      locality: 'Bartók Béla út',
      district: 'XI',
      languageNeeded: 'hu>en',
      createdAt: ago(5 * H),
      lastActivityAt: ago(1 * H),
      lastRaiserResponseAt: ago(30 * H),
      responseDueAt: ago(30 * H) + 48 * H,
      photoCount: 2,
      affected: [],
      fixedVotes: [],
      updates: [
        upd('up_l3', 'u_arjun', 'asker', 'partly_solved', "Zsófi translated page 1, thank you! I still don't understand what to bring to the Kormányablak.", ago(1 * H)),
        upd('up_l2', 'u_zsofi', 'helper', 'making_progress', 'Page 1 translated in the chat. Doing page 2 tonight.', ago(3 * H)),
      ],
      creditedHelperIds: [],
    },
    {
      id: 'p_water',
      incidentId: 'i_water',
      askerId: 'u_reka',
      anonymous: false,
      title: 'No water in our buildings since 7 am',
      description:
        'All of Block A, B and C on our street have no running water since this morning. Elderly neighbours on the upper floors need bottled water.',
      categoryId: 'water_supply',
      kind: 'issue',
      urgency: 'serious',
      status: 'open',
      exact: { lat: 47.47188, lng: 19.05432 },
      precision: 'standard',
      locality: 'Október huszonharmadika utca',
      district: 'XI',
      languageNeeded: null,
      createdAt: ago(6 * H),
      lastActivityAt: ago(20 * 60_000),
      lastRaiserResponseAt: null,
      responseDueAt: null,
      photoCount: 1,
      affected: Array.from({ length: 22 }, (_, i) => `u_anon${i}`),
      fixedVotes: [],
      updates: [
        upd('up_w2', 'u_reka', 'asker', 'making_progress', 'Waterworks say the repair crew arrives by 4 pm. Bottled water at Block C entrance.', ago(20 * 60_000)),
      ],
      creditedHelperIds: [],
    },
    {
      id: 'p_pond',
      incidentId: 'i_pond',
      askerId: 'u_lili',
      anonymous: false,
      title: 'Plastic waste piling up at Feneketlen-tó',
      description:
        'Bottles and bags along the east shore after the weekend. Let’s clean it together. Bags and gloves provided!',
      categoryId: 'water_bodies',
      kind: 'issue',
      urgency: 'basic',
      status: 'open',
      exact: { lat: 47.47962, lng: 19.03983 },
      precision: 'exact',
      locality: 'Feneketlen-tó',
      district: 'XI',
      languageNeeded: null,
      createdAt: ago(2 * D),
      lastActivityAt: ago(2 * H),
      lastRaiserResponseAt: null,
      responseDueAt: null,
      photoCount: 3,
      affected: ['u_bence', 'u_arjun', 'u_x1', 'u_x2', 'u_x3', 'u_x4', 'u_x5', 'u_x6'],
      fixedVotes: [],
      updates: [upd('up_p1', 'u_lili', 'asker', 'making_progress', 'Clean-up on Sunday 10:00. Bags provided!', ago(2 * H))],
      creditedHelperIds: [],
    },
    {
      id: 'p_cat',
      incidentId: 'i_cat',
      askerId: 'u_olena',
      anonymous: true,
      title: 'Lost grey cat near Gellért tér',
      description: 'Grey cat with white paws, very shy, answers to "Murka". Please check balconies and cellars.',
      categoryId: 'pets_animals',
      kind: 'request',
      urgency: 'medium',
      status: 'open',
      exact: { lat: 47.48392, lng: 19.05318 },
      precision: 'wider',
      locality: 'Gellért tér',
      district: 'XI',
      languageNeeded: null,
      createdAt: ago(20 * H),
      lastActivityAt: ago(5 * H),
      lastRaiserResponseAt: ago(5 * H),
      responseDueAt: ago(5 * H) + 48 * H,
      photoCount: 1,
      affected: [],
      fixedVotes: [],
      updates: [upd('up_c1', 'u_olena', 'asker', 'making_progress', 'Seen near the tram stop last night!', ago(5 * H))],
      creditedHelperIds: [],
    },
    {
      id: 'p_light',
      incidentId: 'i_light',
      askerId: 'u_david',
      anonymous: false,
      title: 'Streetlight out on Bocskai út',
      description: 'Three lamps in a row are dark near the school crossing. Reported to the district office.',
      categoryId: 'streetlights',
      kind: 'issue',
      urgency: 'basic',
      status: 'open',
      exact: { lat: 47.47321, lng: 19.04402 },
      precision: 'standard',
      locality: 'Bocskai út',
      district: 'XI',
      languageNeeded: null,
      createdAt: ago(3 * D),
      lastActivityAt: ago(1 * D),
      lastRaiserResponseAt: null,
      responseDueAt: null,
      photoCount: 1,
      affected: Array.from({ length: 11 }, (_, i) => `u_l${i}`),
      fixedVotes: [],
      updates: [upd('up_s1', 'u_david', 'asker', 'note', 'Reported to the district office, ref #4471.', ago(1 * D))],
      creditedHelperIds: [],
    },
    {
      id: 'p_gp',
      incidentId: 'i_gp',
      askerId: 'u_olena',
      anonymous: false,
      title: 'Looking for an English-speaking GP nearby',
      description: 'My daughter needs a check-up for school. We speak Ukrainian, Russian and English.',
      categoryId: 'finding_services',
      kind: 'request',
      urgency: 'basic',
      status: 'open',
      exact: { lat: 47.48122, lng: 19.06204 },
      precision: 'standard',
      locality: 'Ráday utca',
      district: 'IX',
      languageNeeded: 'hu>en',
      createdAt: ago(9 * H),
      lastActivityAt: ago(4 * H),
      lastRaiserResponseAt: ago(4 * H),
      responseDueAt: ago(4 * H) + 48 * H,
      photoCount: 0,
      affected: [],
      fixedVotes: [],
      updates: [],
      creditedHelperIds: [],
    },
    {
      id: 'p_drill',
      incidentId: 'i_drill',
      askerId: 'u_wei',
      anonymous: false,
      title: 'Can someone lend a drill for an hour?',
      description: 'Need to mount one shelf. I will bring it back the same day, promise. Can fix your bike in return!',
      categoryId: 'borrow_lend',
      kind: 'request',
      urgency: 'basic',
      status: 'open',
      exact: { lat: 47.46905, lng: 19.03811 },
      precision: 'standard',
      locality: 'Fehérvári út',
      district: 'XI',
      languageNeeded: null,
      createdAt: ago(3 * H),
      lastActivityAt: ago(3 * H),
      lastRaiserResponseAt: null,
      responseDueAt: null,
      photoCount: 0,
      affected: [],
      fixedVotes: [],
      updates: [],
      creditedHelperIds: [],
    },
  ];

  const offer = (
    id: string,
    problemId: string,
    helperId: string,
    message: string,
    status: OfferRec['status'],
    at: number,
    conversationId: string | null = null,
  ): OfferRec => ({ id, problemId, helperId, message, status, createdAt: at, claimedSolved: false, conversationId });

  const offers: OfferRec[] = [
    offer('o_zsofi_letter', 'p_letter', 'u_zsofi', "Hi Arjun! I'm from Budapest, happy to translate and explain. Send me page 2 in the chat?", 'accepted', ago(4.5 * H), 'c_letter'),
    offer('o_bence_letter', 'p_letter', 'u_bence', 'I did my address card last year. I can tell you exactly what to bring, or come along.', 'offered', ago(26 * H)),
    offer('o_david_letter', 'p_letter', 'u_david', 'I work near the Kormányablak on Bocskai út, happy to meet you there.', 'offered', ago(3 * H)),
    offer('o_zsofi_gp', 'p_gp', 'u_zsofi', 'My GP on Ráday utca speaks great English. I can call and ask if they take new patients.', 'accepted', ago(8 * H), 'c_gp'),
    offer('o_lili_gp', 'p_gp', 'u_lili', 'Try the clinic on Lónyay utca, they have English-speaking doctors.', 'offered', ago(6 * H)),
    offer('o_bence_pond', 'p_pond', 'u_bence', "I'll join the clean-up on Sunday with two friends.", 'offered', ago(1 * D)),
  ];

  const conversations: ConversationRec[] = [
    { id: 'c_letter', problemId: 'p_letter', askerId: 'u_arjun', helperId: 'u_zsofi', readOnly: false },
    { id: 'c_gp', problemId: 'p_gp', askerId: 'u_olena', helperId: 'u_zsofi', readOnly: false },
  ];

  const msg = (
    id: string,
    conversationId: string,
    senderId: string | null,
    type: MessageRec['type'],
    body: string | null,
    at: number,
  ): MessageRec => ({ id, conversationId, senderId, type, body, location: null, createdAt: at });

  const messages: MessageRec[] = [
    msg('m1', 'c_letter', null, 'system', "Arjun accepted Zsófi's offer to help", ago(4.4 * H)),
    msg('m2', 'c_letter', 'u_zsofi', 'text', "Hi Arjun! Can you send me a photo of page 2? Cover your name and ID numbers first.", ago(4.3 * H)),
    msg('m3', 'c_letter', 'u_arjun', 'image', "Here's page 2!", ago(3.2 * H)),
    msg('m4', 'c_letter', 'u_zsofi', 'text', 'It says you need to register your new address within 30 days. Bring your passport, residence permit and rental contract.', ago(3 * H)),
    msg('m5', 'c_letter', 'u_arjun', 'text', 'Thank you so much! Where is the nearest Kormányablak?', ago(2.8 * H)),
    msg('m6', 'c_letter', 'u_zsofi', 'text', 'On Bocskai út. I can come with you on Thursday and translate at the desk, if you like.', ago(2.7 * H)),
    msg('m7', 'c_gp', null, 'system', "Olena accepted Zsófi's offer to help", ago(7.9 * H)),
    msg('m8', 'c_gp', 'u_zsofi', 'text', 'I called my GP, they take new patients on Tuesdays! Shall I send you the address?', ago(5 * H)),
    msg('m9', 'c_gp', 'u_olena', 'text', 'Yes please, that would be wonderful. Дякую!', ago(4 * H)),
  ];

  const communities: CommunityRec[] = [
    { id: 'cm_xi', name: 'District XI neighbours', type: 'district', description: 'Everything Újbuda: news, help, events and welcomes.', members: ['u_zsofi', 'u_lili', 'u_bence', 'u_arjun', 'u_reka'], baseMembers: 1240, newPosts: 4, color: 'brand' },
    { id: 'cm_huen', name: 'Hungarian–English exchange', type: 'language_culture', description: 'Practise Hungarian or English with friendly neighbours. Coffee meet-ups every Thursday.', members: ['u_zsofi', 'u_arjun'], baseMembers: 386, newPosts: 1, color: 'sapphire' },
    { id: 'cm_students', name: 'International students Budapest', type: 'students', description: 'For everyone studying in Budapest: housing tips, paperwork help and Friday hangouts.', members: ['u_arjun', 'u_wei'], baseMembers: 2105, newPosts: 9, color: 'tram' },
    { id: 'cm_pond', name: 'Feneketlen-tó friends', type: 'civic_environment', description: 'Keeping our pond and park clean, one Sunday at a time.', members: ['u_lili', 'u_bence'], baseMembers: 214, newPosts: 2, color: 'mint' },
    { id: 'cm_ukr', name: 'Ukrainian community in Budapest', type: 'language_culture', description: 'Support, news and friendship for Ukrainians in Budapest.', members: ['u_olena'], baseMembers: 932, newPosts: 3, color: 'tram' },
    { id: 'cm_parents', name: 'Parents of District XI', type: 'interest', description: 'Schools, playgrounds, babysitting swaps and hand-me-downs.', members: ['u_reka'], baseMembers: 517, newPosts: 0, color: 'coral' },
  ];

  const post = (p: Omit<PostRec, 'likedBy'> & { likedBy?: string[] }): PostRec => ({ likedBy: [], ...p });

  const posts: PostRec[] = [
    post({ id: 'po_thanks', kind: 'thank_you', authorId: 'u_arjun', communityId: null, caption: 'Huge thanks to Zsófi, who translated my letter and explained everything. Three weeks in Budapest and it already feels like home.', image: 'thanks', createdAt: ago(2 * H), baseLikes: 48, comments: 12, problemId: 'p_letter', thankedIds: ['u_zsofi'], district: 'XI' }),
    post({ id: 'po_picnic', kind: 'photo', authorId: 'u_lili', communityId: 'cm_xi', caption: 'Welcome picnic for newcomers this Saturday at Bikás park! Bring something from home to share. Locals very welcome too.', image: 'picnic', createdAt: ago(4 * H), baseLikes: 31, comments: 8, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_sunset', kind: 'photo', authorId: 'u_zsofi', communityId: null, caption: 'Evening walk up Gellért Hill. Never gets old.', image: 'sunset', createdAt: ago(9 * H), baseLikes: 76, comments: 5, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_cleanup', kind: 'photo', authorId: 'u_lili', communityId: 'cm_pond', caption: '14 neighbours, 22 bags of rubbish. Thank you all!', image: 'cleanup', createdAt: ago(5 * D), baseLikes: 120, comments: 19, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_tram', kind: 'photo', authorId: 'u_zsofi', communityId: null, caption: 'Tram 4-6 at golden hour.', image: 'tram', createdAt: ago(2 * D), baseLikes: 54, comments: 3, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_langos', kind: 'photo', authorId: 'u_zsofi', communityId: 'cm_huen', caption: 'Lángos lesson for our exchange group: sour cream, cheese, a little garlic.', image: 'langos', createdAt: ago(3 * D), baseLikes: 63, comments: 11, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_bridge', kind: 'photo', authorId: 'u_zsofi', communityId: null, caption: 'Liberty Bridge lit up tonight.', image: 'bridge', createdAt: ago(4 * D), baseLikes: 88, comments: 6, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_dog', kind: 'photo', authorId: 'u_zsofi', communityId: null, caption: 'Walked Bodza for my neighbour while she recovers. Best boy.', image: 'dog', createdAt: ago(6 * D), baseLikes: 140, comments: 22, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_poster', kind: 'photo', authorId: 'u_zsofi', communityId: 'cm_xi', caption: 'Making posters for the welcome picnic!', image: 'poster', createdAt: ago(7 * D), baseLikes: 40, comments: 4, problemId: null, thankedIds: [], district: 'XI' }),
    post({ id: 'po_bench', kind: 'thank_you', authorId: 'u_wei', communityId: null, caption: 'Thanks Zsófi for showing me how to get a BKK monthly pass!', image: 'thanks', createdAt: ago(10 * D), baseLikes: 22, comments: 2, problemId: null, thankedIds: ['u_zsofi'], district: 'XI' }),
  ];

  const note = (
    id: string,
    userId: string,
    type: NotificationRec['type'],
    title: string,
    body: string,
    at: number,
    link: string,
    problemId: string | null = null,
    read = false,
  ): NotificationRec => ({ id, userId, type, title, body, createdAt: at, read, link, problemId });

  const notifications: NotificationRec[] = [
    note('n1', 'u_arjun', 'response_due', 'Bence offered to help with your letter and is waiting', 'Help reading a letter · 18 h left to respond', ago(6 * H), '/p/p_letter', 'p_letter'),
    note('n2', 'u_arjun', 'offer_received', 'Dávid can help with your letter', '"I work near the Kormányablak on Bocskai út…"', ago(3 * H), '/p/p_letter', 'p_letter'),
    note('n3', 'u_arjun', 'community', '3 new members said hello in District XI neighbours', 'Say hi in the Welcome thread', ago(1 * D), '/community/communities', null, true),
    note('n4', 'u_zsofi', 'offer_accepted', 'Arjun accepted your help', 'Help reading a letter from the district office', ago(4.4 * H), '/chat/c_letter', 'p_letter'),
    note('n5', 'u_zsofi', 'karma', '+10 karma', 'Wei confirmed you helped with a BKK monthly pass', ago(10 * D), '/profile', null, true),
    note('n6', 'u_zsofi', 'nearby_problem', 'New nearby: someone needs Hungarian help', 'Looking for an English-speaking GP · ~1.2 km', ago(9 * H), '/p/p_gp', 'p_gp'),
    note('n7', 'u_zsofi', 'message', 'Olena sent you a message', 'Yes please, that would be wonderful. Дякую!', ago(4 * H), '/chat/c_gp', 'p_gp'),
    note('n8', 'u_zsofi', 'community', '3 new members said hello in District XI neighbours', 'Say hi in the Welcome thread', ago(1 * D), '/community/communities', null, true),
  ];

  const karma: KarmaRec[] = [
    { id: 'k1', userId: 'u_zsofi', amount: 10, reason: 'solve_award', label: 'Helped Wei with a BKK monthly pass', createdAt: ago(10 * D) },
    { id: 'k2', userId: 'u_zsofi', amount: 10, reason: 'solve_award', label: 'Clean-up at Feneketlen-tó', createdAt: ago(5 * D) },
    { id: 'k3', userId: 'u_zsofi', amount: 2, reason: 'closing_award', label: 'Closed "Broken bench in Bikás park"', createdAt: ago(12 * D) },
    { id: 'k4', userId: 'u_arjun', amount: 10, reason: 'solve_award', label: 'Helped Wei set up a Hungarian SIM', createdAt: ago(6 * D) },
    { id: 'k5', userId: 'u_arjun', amount: 2, reason: 'closing_award', label: 'Closed "Which bank accepts students?"', createdAt: ago(8 * D) },
  ];

  return { users, problems, offers, conversations, messages, posts, communities, notifications, karma, seq: 1000 };
}
