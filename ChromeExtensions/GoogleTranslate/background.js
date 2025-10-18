const MENU_ID = 'google-translate-selection';
const TRANSLATION_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Google翻訳',
    contexts: ['selection']
  });
});

async function performTranslation(text) {
  const url = `${TRANSLATION_ENDPOINT}?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('翻訳リクエストに失敗しました');
  }
  const data = await response.json();
  const sentences = data[0] || [];
  const translatedText = sentences.map((sentence) => sentence[0]).join('');
  const detectedSourceLanguage = data[2] || 'auto';
  return {
    sourceText: text,
    translatedText,
    detectedSourceLanguage,
    updatedAt: new Date().toISOString()
  };
}

async function storeTranslation(data, origin = 'manual') {
  const payload = { ...data, origin };
  await chrome.storage.local.set({ latestTranslation: payload });
  chrome.runtime.sendMessage({ type: 'translationResult', data: payload });
  return payload;
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) {
    return;
  }
  const text = info.selectionText.trim();
  if (!text) {
    return;
  }
  performTranslation(text)
    .then((data) => storeTranslation(data, 'contextMenu'))
    .catch((error) => {
      chrome.runtime.sendMessage({
        type: 'translationError',
        error: error.message || String(error)
      });
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'translateText') {
    const text = (message.text || '').trim();
    if (!text) {
      sendResponse({ ok: false, error: '翻訳するテキストを入力してください。' });
      return;
    }
    performTranslation(text)
      .then((data) => storeTranslation(data, message.origin || 'manual'))
      .then((payload) => sendResponse({ ok: true, data: payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === 'getLatestTranslation') {
    chrome.storage.local
      .get('latestTranslation')
      .then((result) => {
        sendResponse({ ok: true, data: result.latestTranslation || null });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  return undefined;
});
