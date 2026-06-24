const DEFAULT_PROMPTS = {
  addPolish:         'Polish and refine the following text to make it more professional and eloquent while preserving the original meaning and language. Only return the polished text without quotes or explanations.',
  fixGrammar:        'Fix the typos and grammar in the following text. Keep the language the same. If the text looks like a message, use a casual but correct style. Only return the fixed text without quotes or explanations.',
  toneFormal:        'Rewrite the following text in a formal tone. Fix any grammar issues. Keep the same language. Only return the rewritten text without quotes or explanations.',
  toneCasual:        'Rewrite the following text in a casual, friendly tone. Fix any grammar issues. Keep the same language. Only return the rewritten text without quotes or explanations.',
  toneEmpathetic:    'Rewrite the following text in an empathetic, warm, and understanding tone. Fix any grammar issues. Keep the same language. Only return the rewritten text without quotes or explanations.',
  toneEmojis:        'Rewrite the following text and add relevant emojis to make it more expressive and engaging. Fix any grammar issues. Keep the same language. Only return the rewritten text without quotes or explanations.',
  emailStyle:        'Rewrite the following text as a professional, official business email. Fix any grammar issues. Use proper email structure and formal language. Only return the email body without quotes or explanations.',
  makeShorter:       'Shorten the following text while preserving the key message. Fix any grammar issues. Keep the same language. Only return the shortened text without quotes or explanations.',
  makeLonger:        'Expand the following text with more detail and context while preserving the original meaning. Fix any grammar issues. Keep the same language. Only return the expanded text without quotes or explanations.',
  translatePolish:   'Translate the following text to Polish. Ensure correct grammar and natural-sounding Polish. Only return the translated text without quotes or explanations.',
  translateUkrainian:'Translate the following text to Ukrainian. Ensure correct grammar and natural-sounding Ukrainian. Only return the translated text without quotes or explanations.',
  translateEnglish:  'Translate the following text to American English. Ensure correct grammar and natural-sounding American English. Only return the translated text without quotes or explanations.',
  formatMarkdown:    'Format the following text using proper Markdown syntax (headings, lists, bold, italic, code blocks, etc. where relevant). Fix any grammar issues. Only return the formatted Markdown text without explanations.',
  formatSlack:       'Format the following text as a well-structured Slack message using Slack formatting (*bold*, _italic_, `code`, and bullet points). Fix any grammar issues. Keep it concise and clear. Only return the formatted message without explanations.',
  replyAssist:       `You are a writing refinement assistant.
Your only task is to take user-written text and refine it so it becomes clear, professional, and well-structured while:
- Preserving the original intent, meaning, and personal voice
- Matching the tone of the surrounding conversation (given as context)

You must never add new ideas, facts, or content that wasn't in the user text.

Rules:
1. Preserve the intent and emotional nuance of the user text.
2. Refer the message tone and context from given messages and include it in answer.
3. Output only the refined text. Do not include explanations or notes.`,
  aiPrompt:          null
};

const ACTION_LABELS = {
  addPolish:         "Add polish",
  fixGrammar:        "Fix spelling & grammar",
  toneFormal:        "Change tone → Formal",
  toneCasual:        "Change tone → Casual",
  toneEmpathetic:    "Change tone → Empathetic",
  toneEmojis:        "Change tone → Add emojis",
  emailStyle:        "Rewrite → Official email",
  makeShorter:       "Make shorter",
  makeLonger:        "Make longer",
  translatePolish:   "Translate → Polish",
  translateUkrainian:"Translate → Ukrainian",
  translateEnglish:  "Translate → English (US)",
  formatMarkdown:    "Format → Markdown",
  formatSlack:       "Format → Slack message",
  replyAssist:       "Reply Assist",
  aiPrompt:          "AI Prompt (custom)"
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const DEFAULT_LM_STUDIO_URL = "http://192.168.1.114:1234";

const GEMINI_MODELS = [
  {
    id: "gemini-3.1-flash-lite-preview",
    label: "gemini-3.1-flash-lite-preview"
  },
  {
    id: "gemini-3-flash-preview",
    label: "gemini-3-flash-preview"
  },
  {
    id: "gemini-2.5-pro",
    label: "gemini-2.5-pro"
  },
  {
    id: "gemini-2.5-flash",
    label: "gemini-2.5-flash"
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "gemini-2.5-flash-lite"
  },
  {
    id: "gemini-2.0-flash",
    label: "gemini-2.0-flash (will be shut down June 1, 2026)"
  }
];
