// Language switch and demo data for the store screenshots and the promo video.
// Only English exists today; add a key to DEMO (and COPY in store-copy.mjs) for a new listing language.
// Everything here is invented demo content: no real people, keys or email addresses.

export const LANGS = ['en'];

export function parseLang(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--lang');
  const lang = i >= 0 ? argv[i + 1] : 'en';
  if (!LANGS.includes(lang)) throw new Error(`Unknown --lang ${lang}; use ${LANGS.join(', ')}`);
  return lang;
}

const DEMO = {
  en: {
    mail: {
      folders: ['Inbox', 'Starred', 'Drafts', 'Sent', 'Archive'],
      to: 'Marta K.',
      subject: 'Q3 report notes',
      greeting: 'Hi Marta,',
      typo: 'Thanks for sending teh report. I recieve it yesterday and definately want to go thru it before friday, its looking realy good so far.',
      fixed: 'Thanks for sending the report. I received it yesterday and definitely want to go through it before Friday. It\'s looking really good so far.',
      ask: 'Could we seperate the budget part into it\'s own document? That would make the review much more easyer for the hole team.',
      signoff: ['Best,', 'Alex'],
    },
    // Review-panel answers for mail.ask, keyed by action id (constants.js DEFAULT_PROMPTS).
    ask: {
      fixGrammar: 'Could we separate the budget part into its own document? That would make the review much easier for the whole team.',
      addPolish: 'Could we move the budget section into a separate document? It would make the review far easier for the whole team.',
      toneFormal: 'Would it be possible to move the budget section into a separate document? It would simplify the team\'s review.',
      toneCasual: 'Can we split the budget bit into its own doc? It\'d make the review way easier for everyone.',
      toneEmpathetic: 'I know everyone has a lot on their plate, so could we move the budget part into its own document? It would make the review much easier for the whole team.',
      toneEmojis: 'Could we split the budget part into its own document? 📄 That would make the review so much easier for the whole team! 🙌',
      makeShorter: 'Could we move the budget into its own document? It would make the review easier for everyone.',
      translateUkrainian: 'Чи могли б ми винести бюджетну частину в окремий документ? Так усій команді буде значно легше її переглянути.',
      translatePolish: 'Czy moglibyśmy wydzielić część budżetową do osobnego dokumentu? Całemu zespołowi będzie wtedy znacznie łatwiej ją przejrzeć.',
    },
    chat: {
      workspace: 'Northwind',
      channels: ['general', 'design', 'client-demo', 'releases'],
      active: 'client-demo',
      people: [
        { name: 'Jordan', color: '#e8a33d', time: '10:42', text: 'Hey! Are you still able to join the client demo on Thursday at 3? We\'d love you to walk them through the new dashboard.' },
        { name: 'Priya', color: '#5aa6e0', time: '10:44', text: 'Slides are in the shared folder. I can cover the intro if needed.' },
      ],
      draft: 'cant do thursday sorry, have the dentist. friday morning works or i can record a video of the dashboard',
      context: 'Keep it friendly and offer both options.',
      reply: 'Sorry, I can\'t make Thursday. I have a dentist appointment. Friday morning works for me, or I can record a short walkthrough of the new dashboard if that\'s easier.',
    },
    // A text typed in the wrong keyboard layout; background.js translitKeyboard turns it into "привіт, як справи?".
    translit: 'ghbdsn, zr cghfdb?',
    // Chat thread for the keyboard-layout scene of the promo video (demo-page.html ?thread=translit).
    translitThread: {
      channel: 'design',
      people: [{ name: 'Oksana', color: '#8b6fd6', time: '11:05', text: 'Привіт! Я вже повернулась з відпустки.' }],
    },
    history: [
      { minutesAgo: 3, action: 'fixGrammar', original: 'Thanks for sending teh report. I recieve it yesterday.', fixed: 'Thanks for sending the report. I received it yesterday.', input: 92, output: 18, ms: 840 },
      { minutesAgo: 9, action: 'toneFormal', original: 'Could we seperate the budget part into it\'s own document?', fixed: 'Would it be possible to move the budget section into a separate document?', input: 101, output: 22, ms: 1130 },
      { minutesAgo: 26, action: 'replyAssist', original: 'cant do thursday sorry, have the dentist', fixed: 'Sorry, I can\'t make Thursday. I have a dentist appointment.', input: 188, output: 27, ms: 1420 },
      { minutesAgo: 64, action: 'translateUkrainian', original: 'See you at the planning call tomorrow.', fixed: 'До зустрічі завтра на плануванні.', input: 74, output: 16, ms: 910 },
      { minutesAgo: 180, action: 'formatSlack', original: 'release notes: new export button, faster search, fixed login bug', fixed: '*Release notes*\n• New export button\n• Faster search\n• Fixed login bug', input: 113, output: 30, ms: 1260 },
      { minutesAgo: 1500, action: 'makeShorter', original: 'I just wanted to quickly follow up on the message I sent you last week about the invoice.', fixed: 'Following up on last week\'s invoice message.', input: 97, output: 12, ms: 760 },
    ],
    lifetime: { count: 412, totalTimeMs: 418000, totalTokens: 61200 },
  },
};

export const demo = (lang) => DEMO[lang];

/** Canned AI answers for the demo server: action id → selected text → answer. */
export function cannedAnswers(lang) {
  const D = DEMO[lang];
  const table = {};
  const put = (action, text, answer) => ((table[action] ??= {})[norm(text)] = answer);
  put('fixGrammar', D.mail.typo, D.mail.fixed);
  for (const [action, answer] of Object.entries(D.ask)) put(action, D.mail.ask, answer);
  put('replyAssist', D.chat.draft, D.chat.reply);
  return table;
}

export const norm = (s) => String(s).replace(/[​\s]+/g, ' ').trim();
