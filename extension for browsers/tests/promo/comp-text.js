// On-screen copy for the promo video, one block per listing language (only English today).
// "*word*" is accent-coloured, "\n" breaks the line. Claims match docs/chrome-web-store/SOURCES.md.
window.PROMO_TEXT = {
  en: {
    // Intro: typos that pop up all over the screen, then get fixed.
    typos: [
      ['teh', 'the'], ['recieve', 'receive'], ['definately', 'definitely'], ['thru', 'through'], ['seperate', 'separate'],
      ["it's own", 'its own'], ['realy', 'really'], ['easyer', 'easier'], ['untill', 'until'], ['wich', 'which'],
      ['alot', 'a lot'], ['tommorow', 'tomorrow'], ['occured', 'occurred'], ['begining', 'beginning'], ['wierd', 'weird'],
      ['beleive', 'believe'], ['freind', 'friend'], ['calender', 'calendar'], ['neccessary', 'necessary'], ['adress', 'address'],
      ['goverment', 'government'], ['enviroment', 'environment'], ['noticable', 'noticeable'], ['acommodate', 'accommodate'],
      ['reccomend', 'recommend'], ['existance', 'existence'], ['grammer', 'grammar'], ['independant', 'independent'],
      ['knowlege', 'knowledge'], ['truely', 'truly'], ['arguement', 'argument'], ['libary', 'library'],
    ],
    familiar: 'Typos. *Everywhere.*',
    tagline: 'Fix, rewrite and translate right where you type.',
    scenes: {
      fix: ['Right-click · Fix in place', 'Fix it *right\nwhere* you typed.', 'Select text in any field and pick an action. The corrected version replaces your selection.'],
      review: ['Review before applying', 'See it. Tweak it.\n*Then* apply.', 'Switch between 16 actions, edit the result, then put it back in one click.'],
      reply: ['Reply Assist', 'Replies that\n*fit the conversation.*', 'Add a hint about the tone. You get a clear reply in your own words.'],
      translit: ['Wrong keyboard layout?', 'ghbdsn →\n*привіт.*', 'Text typed in the wrong layout is fixed instantly, right on your device.'],
      popup: ['History · Prompts · Settings', 'Every edit,\n*on the record.*', 'See past edits and stats, and change the prompt behind any action.'],
    },
    privacy: ['Your *key.*', 'Your *model.*', 'No *analytics.*'],
    privacyNote: 'Google Gemini with your own API key, or LM Studio on your computer.\nSettings and history stay in this browser.',
    outroTag: 'Write it right, right where you type.',
    outroMeta: 'Chrome extension · Gemini or LM Studio',
  },
};
