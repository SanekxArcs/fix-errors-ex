// Marketing copy for the Chrome Web Store images, one block per listing language.
// HTML is allowed: <em> highlights, <br> forces a line break. Every claim is backed by the code
// (see docs/chrome-web-store/SOURCES.md).
export const COPY = {
  en: {
    fix: {
      eyebrow: 'Right-click · Fix in place',
      h1: 'Fix it <em>right where</em> you typed.',
      lead: 'Select text in any field and pick an action from the AI Text Tools menu. The corrected version replaces your selection.',
      items: ['Email, chat, comments and forms', 'Progress toast with one-click cancel', 'Keeps your text if a site blocks edits'],
      result: 'Replaced in place',
    },
    review: {
      eyebrow: 'Review before applying',
      h1: 'See it. Tweak it.<br><em>Then</em> apply.',
      lead: 'Alt+Shift+R opens an editing panel on the page. Switch actions, edit the result, then copy it back into place.',
      items: ['16 actions in one dropdown', 'Edit or regenerate the result', 'Opens with nothing selected, too'],
    },
    reply: {
      eyebrow: 'Reply Assist',
      h1: 'Replies that <em>fit the conversation.</em>',
      lead: 'Select your rough draft, press Alt+Shift+A, add a hint about the tone and get a clear reply in your own words.',
      items: ['Adds no ideas you didn\'t write', 'Context is only what you type', 'Goes straight back into the field'],
      result: 'Refined reply',
    },
    tone: {
      eyebrow: 'Tone · Translate · Format',
      h1: 'One sentence, <em>many voices.</em>',
      lead: 'Formal, casual, empathetic or with emojis. Translate to Polish, Ukrainian or English. Format for Markdown or Slack.',
      cards: ['Make more formal', 'Add emojis', 'Translate to Ukrainian'],
    },
    yours: {
      eyebrow: 'Your AI · Your device',
      h1: 'Your key.<br><em>Your model.</em>',
      lead: 'Google Gemini with your own API key, or LM Studio on your own computer. Settings, prompts and history stay in this browser.',
      items: ['Fallback provider and per-model budgets', 'Edit the prompt behind every action', 'No account, no analytics'],
    },
    small: 'Fix · Rewrite · Translate<br>in any text field',
    marquee: {
      h1: 'Fix, rewrite and translate<br><em>right where you type.</em>',
      lead: 'Grammar, tone, translation and replies in any text field, with your own Gemini key or a local model.',
    },
  },
};
