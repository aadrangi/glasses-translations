// dev/mock-host.ts
var listeners = new Map;
var openCbs = new Set;
var closeCbs = new Set;
var settings = {
  targetLanguage: "es",
  displayLines: 5,
  displayWidth: 576,
  wordBreaking: true,
  showOriginalText: true,
  glassesDisplayMode: "translation"
};
var translations = [];
var displayPreview = null;
var SCRIPT = [
  {
    original: "Hello, how are you doing today?",
    es: "Hola, ¿cómo estás hoy?",
    fr: "Bonjour, comment ça va aujourd'hui ?",
    de: "Hallo, wie geht es dir heute?"
  },
  {
    original: "The weather is beautiful outside.",
    es: "El clima está hermoso afuera.",
    fr: "Il fait beau dehors.",
    de: "Das Wetter ist draußen wunderschön."
  },
  {
    original: "Can you repeat that, please?",
    es: "¿Puedes repetir eso, por favor?",
    fr: "Pouvez-vous répéter cela, s'il vous plaît ?",
    de: "Kannst du das bitte wiederholen?"
  },
  {
    original: "The meeting starts in ten minutes.",
    es: "La reunión empieza en diez minutos.",
    fr: "La réunion commence dans dix minutes.",
    de: "Das Treffen beginnt in zehn Minuten."
  }
];
function emit(channel, payload) {
  const cbs = listeners.get(channel);
  if (!cbs || cbs.size === 0)
    return;
  setTimeout(() => {
    for (const cb of [...cbs])
      cb(payload);
  }, 0);
}
function live(type, utteranceId, text, original) {
  return {
    type,
    id: `${utteranceId}-${type}`,
    utteranceId,
    speaker: "Speaker 1",
    text,
    originalText: original,
    sourceLanguage: "en",
    targetLanguage: settings.targetLanguage,
    timestamp: Date.now()
  };
}
function toEntry(data) {
  return {
    id: data.id,
    utteranceId: data.utteranceId,
    speaker: data.speaker,
    text: data.text,
    originalText: data.originalText,
    sourceLanguage: data.sourceLanguage,
    targetLanguage: data.targetLanguage,
    timestamp: data.timestamp,
    isFinal: data.type === "final"
  };
}
function wrapLines(text) {
  const maxChars = Math.max(12, Math.round(settings.displayWidth / 16));
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0)
      current = word;
    else if (current.length + 1 + word.length <= maxChars)
      current += " " + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0)
    lines.push(current);
  return lines.slice(0, settings.displayLines);
}
function emitPreview(text, isFinal) {
  displayPreview = { text, lines: wrapLines(text), isFinal, timestamp: Date.now() };
  emit("translation:display-preview", displayPreview);
}
function emitSnapshot() {
  const snapshot = {
    settings: { ...settings },
    translations: [...translations],
    displayPreview,
    cloudStatus: { status: "connected", audioTransport: "udp" }
  };
  emit("translation:snapshot", snapshot);
}
function updateSettings(patch) {
  Object.assign(settings, patch);
  emit("translation:settings-update", { ...settings });
}
var utterance = 0;
function runUtterance() {
  const phrase = SCRIPT[utterance % SCRIPT.length];
  const translated = phrase[settings.targetLanguage] ?? `[${settings.targetLanguage}] ${phrase.original}`;
  const original = phrase.original;
  const uid = `utt-${Date.now()}`;
  const words = translated.split(" ");
  const third = Math.max(1, Math.ceil(words.length / 3));
  emit("translation:live-translation", live("interim", uid, words.slice(0, third).join(" "), original));
  setTimeout(() => {
    emit("translation:live-translation", live("interim", uid, words.slice(0, third * 2).join(" "), original));
    emitPreview(words.slice(0, third * 2).join(" "), false);
  }, 1200);
  setTimeout(() => {
    const final = live("final", uid, translated, original);
    emit("translation:live-translation", final);
    translations.push(toEntry(final));
    emitPreview(translated, true);
  }, 2600);
  utterance++;
}
var opened = false;
function handleReady() {
  if (opened)
    return;
  opened = true;
  console.log("[dev mock-host] UI ready — streaming canned translations");
  setTimeout(() => {
    for (const cb of openCbs)
      cb();
  }, 0);
  runUtterance();
  setInterval(runUtterance, 9000);
}
function handleSend(channel, payload) {
  const p = payload;
  switch (channel) {
    case "translation:request-snapshot":
      emitSnapshot();
      break;
    case "translation:clear":
      translations.length = 0;
      displayPreview = null;
      emit("translation:translations-update", { translations: [] });
      emitPreview("", true);
      break;
    case "translation:set-target-language":
      updateSettings({ targetLanguage: String(p.targetLanguage) });
      break;
    case "translation:set-display-lines":
      updateSettings({ displayLines: Number(p.lines) });
      break;
    case "translation:set-display-width":
      updateSettings({ displayWidth: Number(p.width) });
      break;
    case "translation:set-word-breaking":
      updateSettings({ wordBreaking: Boolean(p.enabled) });
      break;
    case "translation:set-show-original-text":
      updateSettings({ showOriginalText: Boolean(p.enabled) });
      break;
    case "translation:set-glasses-display-mode":
      updateSettings({ glassesDisplayMode: p.mode });
      break;
    default:
      console.warn("[dev mock-host] unhandled channel:", channel, payload);
  }
}
function makeUnsub(set, cb) {
  return () => {
    set.delete(cb);
  };
}
var bridge = {
  send(channel, payload) {
    handleSend(channel, payload);
  },
  on(channel, cb) {
    let cbs = listeners.get(channel);
    if (!cbs) {
      cbs = new Set;
      listeners.set(channel, cbs);
    }
    cbs.add(cb);
    return () => {
      cbs.delete(cb);
    };
  },
  request(channel) {
    return Promise.reject(new Error(`[dev mock-host] RPC not implemented: ${channel}`));
  },
  onOpen(cb) {
    openCbs.add(cb);
    if (opened)
      setTimeout(cb, 0);
    return makeUnsub(openCbs, cb);
  },
  onClose(cb) {
    closeCbs.add(cb);
    return makeUnsub(closeCbs, cb);
  },
  ready() {
    handleReady();
  }
};
globalThis.mentra = bridge;
console.log("[dev mock-host] mock mentra bridge installed");
