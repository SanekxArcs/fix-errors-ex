const { DEFAULT_GEMINI_MODEL } = require('../shared/constants');
const { getPrompts } = require('./store');
const { DEFAULT_PROMPTS } = require('../shared/constants');

function isCapacityError(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes("high demand") || m.includes("overloaded") || m.includes("overload") ||
    m.includes("resource_exhausted") || m.includes("service unavailable") ||
    m.includes("temporarily unavailable") || m.includes("capacity");
}

function stripSurroundingQuotes(str) {
  if (str.length > 1 &&
      ((str.startsWith('"') && str.endsWith('"')) ||
       (str.startsWith("'") && str.endsWith("'")))) {
    return str.slice(1, -1);
  }
  return str;
}

// ─── Keyboard layout translit (UA ↔ EN) ──────────────────────────────────────

const UA_TO_EN_MAP = {
  'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ї':']',
  'ф':'a','і':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','є':"'",
  'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.',
  'Й':'Q','Ц':'W','У':'E','К':'R','Е':'T','Н':'Y','Г':'U','Ш':'I','Щ':'O','З':'P','Х':'{','Ї':'}',
  'Ф':'A','І':'S','В':'D','А':'F','П':'G','Р':'H','О':'J','Л':'K','Д':'L','Ж':':','Є':"\"",
  'Я':'Z','Ч':'X','С':'C','М':'V','И':'B','Т':'N','Ь':'M','Б':'<','Ю':'>'
};

const EN_TO_UA_MAP = {
  'q':'й','w':'ц','e':'у','r':'к','t':'е','y':'н','u':'г','i':'ш','o':'щ','p':'з',
  'a':'ф','s':'і','d':'в','f':'а','g':'п','h':'р','j':'о','k':'л','l':'д',
  'z':'я','x':'ч','c':'с','v':'м','b':'и','n':'т','m':'ь',
  'Q':'Й','W':'Ц','E':'У','R':'К','T':'Є','Y':'Н','U':'Г','I':'Ш','O':'Щ','P':'З',
  'A':'Ф','S':'І','D':'В','F':'А','G':'П','H':'Р','J':'О','K':'Л','L':'Д',
  'Z':'Я','X':'Ч','C':'С','V':'М','B':'И','N':'Т','M':'Ь',
  '[':'х',']':'ї','{':'Х','}':'Ї',';':'ж',"'":'є',':':'Ж','"':'Є',
  ',':'б','.':'ю','<':'Б','>':'Ю'
};

function translitKeyboard(text) {
  const cyrillicCount = [...text].filter(ch => /[а-яА-ЯіІїЇєЄ]/.test(ch)).length;
  const latinCount    = [...text].filter(ch => /[a-zA-Z]/.test(ch)).length;
  if (cyrillicCount === 0 && latinCount === 0) return text;
  const map = cyrillicCount >= latinCount ? UA_TO_EN_MAP : EN_TO_UA_MAP;
  return [...text].map(ch => map[ch] ?? ch).join('');
}

function buildPrompt(action, text, context, history) {
  const customPrompts = getPrompts();
  const template = customPrompts[action] || DEFAULT_PROMPTS[action] || DEFAULT_PROMPTS.fixGrammar;

  if (action === "aiPrompt") {
    return text;
  }
  if (action === "replyAssist") {
    const contextPart = context ? `\n\nContext (surrounding conversation):\n"${context}"` : "";
    return `${template}${contextPart}\n\nText to refine:\n"${text}"`;
  }
  if (history && history.length > 0) {
    const historyText = history.slice(0, 5).reverse().map(h => `Original: ${h.original}\nFixed: ${h.fixed}`).join("\n---\n");
    return `Here is some context from previous requests:\n${historyText}\n\n---\n\n${template}\n\nText: "${text}"`;
  }
  return `${template}\n\nText: "${text}"`;
}

async function callGeminiAI(text, apiKey, action, primaryModel = DEFAULT_GEMINI_MODEL, fallbackModel = "", history = [], signal = null, context = "") {
  const prompt = buildPrompt(action, text, context, history);

  const modelsToTry = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) {
    modelsToTry.push(fallbackModel);
  }

  let lastError;

  for (const model of modelsToTry) {
    if (signal?.aborted) throw new Error("AbortError");
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        signal: signal || AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || response.statusText);
      }

      const data = await response.json();
      const aiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!aiResponseText) throw new Error("No response from AI");
      const usage = data.usageMetadata || {};
      const tokens = {
        input: usage.promptTokenCount ?? null,
        output: usage.candidatesTokenCount ?? null,
        total: usage.totalTokenCount ?? null
      };
      return { text: stripSurroundingQuotes(aiResponseText.trim()), tokens };
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model failed: ${model}`, error);
    }
  }

  if (modelsToTry.length > 1) {
    throw new Error(`Primary and fallback model failed. ${lastError?.message || "Unknown error"}`);
  }

  throw lastError || new Error("Gemini request failed");
}

async function callLMStudioAI(text, baseUrl, model, action, history = [], signal = null, context = "") {
  const prompt = buildPrompt(action, text, context, history);
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      stream: false
    }),
    signal: signal || AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `LM Studio error: ${response.statusText}`);
  }

  const data = await response.json();
  const aiResponseText = data.choices?.[0]?.message?.content;
  if (!aiResponseText) throw new Error("No response from LM Studio");
  const usage = data.usage || {};
  const tokens = {
    input: usage.prompt_tokens ?? null,
    output: usage.completion_tokens ?? null,
    total: usage.total_tokens ?? null
  };
  return { text: stripSurroundingQuotes(aiResponseText.trim()), tokens };
}

module.exports = {
  isCapacityError,
  stripSurroundingQuotes,
  translitKeyboard,
  callGeminiAI,
  callLMStudioAI
};
