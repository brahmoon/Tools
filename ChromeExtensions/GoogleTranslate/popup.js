const form = document.getElementById('translate-form');
const textInput = document.getElementById('text-input');
const translateButton = document.getElementById('translate-button');
const statusElement = document.getElementById('status');
const resultWrapper = document.getElementById('result');
const detectedLanguageElement = document.getElementById('detected-language');
const sourceTextElement = document.getElementById('source-text');
const translatedTextElement = document.getElementById('translated-text');
const updatedAtElement = document.getElementById('updated-at');
const resizeHandle = document.getElementById('resize-handle');

const WIDTH_STORAGE_KEY = 'popupWidth';
const MIN_POPUP_WIDTH = 320;
const MAX_POPUP_WIDTH = 800;

function clampWidth(width) {
  if (typeof width !== 'number' || Number.isNaN(width)) {
    return MIN_POPUP_WIDTH;
  }
  return Math.min(MAX_POPUP_WIDTH, Math.max(MIN_POPUP_WIDTH, Math.round(width)));
}

function applyPopupWidth(width) {
  const clamped = clampWidth(width);
  try {
    window.resizeTo(clamped, window.outerHeight);
  } catch (error) {
    console.error('Failed to resize popup window', error);
  }
  return clamped;
}

async function restorePopupWidth() {
  if (!resizeHandle) {
    return;
  }
  const storageArea = chrome?.storage?.local;
  if (!storageArea) {
    return;
  }
  try {
    const stored = await new Promise((resolve, reject) => {
      const callback = (items) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve(items);
        }
      };
      const maybePromise = storageArea.get(WIDTH_STORAGE_KEY, callback);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(reject);
      }
    });
    const width = stored?.[WIDTH_STORAGE_KEY];
    if (typeof width === 'number') {
      applyPopupWidth(width);
    }
  } catch (error) {
    console.error('Failed to restore popup width', error);
  }
}

function persistPopupWidth(width) {
  const storageArea = chrome?.storage?.local;
  if (!storageArea) {
    return;
  }
  const clamped = clampWidth(width ?? window.outerWidth);
  try {
    const maybePromise = storageArea.set({ [WIDTH_STORAGE_KEY]: clamped }, () => {
      const error = chrome.runtime?.lastError;
      if (error) {
        console.error('Failed to save popup width', error);
      }
    });
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch((error) => console.error('Failed to save popup width', error));
    }
  } catch (error) {
    console.error('Failed to save popup width', error);
  }
}

function setupResizeHandle() {
  if (!resizeHandle) {
    return;
  }

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    isDragging = true;
    startX = event.screenX;
    startWidth = window.outerWidth;
    document.body.classList.add('resizing');
    if (typeof resizeHandle.setPointerCapture === 'function') {
      resizeHandle.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  });

  resizeHandle.addEventListener('pointermove', (event) => {
    if (!isDragging) {
      return;
    }
    const delta = event.screenX - startX;
    const newWidth = clampWidth(startWidth + delta);
    applyPopupWidth(newWidth);
  });

  function stopResizing(event) {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    document.body.classList.remove('resizing');
    if (
      event?.pointerId != null &&
      typeof resizeHandle.hasPointerCapture === 'function' &&
      resizeHandle.hasPointerCapture(event.pointerId)
    ) {
      resizeHandle.releasePointerCapture(event.pointerId);
    }
    persistPopupWidth(window.outerWidth);
  }

  resizeHandle.addEventListener('pointerup', stopResizing);
  resizeHandle.addEventListener('pointercancel', stopResizing);

  window.addEventListener('blur', () => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    document.body.classList.remove('resizing');
    persistPopupWidth(window.outerWidth);
  });
}

function setStatus(message, kind = 'info') {
  if (!message) {
    statusElement.hidden = true;
    statusElement.textContent = '';
    statusElement.dataset.kind = '';
    return;
  }
  statusElement.hidden = false;
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
}

function formatLanguage(code) {
  if (!code || code === 'auto') {
    return '自動判別';
  }
  return code.toUpperCase();
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}

function showResult(data) {
  if (!data) {
    resultWrapper.hidden = true;
    detectedLanguageElement.textContent = '';
    sourceTextElement.textContent = '';
    translatedTextElement.textContent = '';
    updatedAtElement.textContent = '';
    return;
  }

  detectedLanguageElement.textContent = formatLanguage(data.detectedSourceLanguage);
  sourceTextElement.textContent = data.sourceText || '';
  translatedTextElement.textContent = data.translatedText || '';
  updatedAtElement.textContent = formatDate(data.updatedAt);
  resultWrapper.hidden = false;
}

async function loadLatestTranslation() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getLatestTranslation' });
    if (response?.ok && response.data) {
      showResult(response.data);
      textInput.value = response.data.sourceText || '';
    }
  } catch (error) {
    console.error('Failed to load latest translation', error);
  }
}

async function requestTranslation(text, origin) {
  translateButton.disabled = true;
  setStatus('翻訳中...', 'progress');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'translateText', text, origin });
    if (!response?.ok) {
      throw new Error(response?.error || '翻訳に失敗しました。');
    }
    showResult(response.data);
    setStatus('翻訳が完了しました。', 'success');
    return response.data;
  } catch (error) {
    setStatus(error.message || '翻訳に失敗しました。', 'error');
    throw error;
  } finally {
    translateButton.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = textInput.value.trim();
  if (!text) {
    setStatus('テキストを入力してください。', 'error');
    return;
  }
  try {
    await requestTranslation(text, 'popup');
  } catch (error) {
    console.error('Translation failed', error);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'translationResult') {
    showResult(message.data);
    if (message.data?.origin === 'contextMenu') {
      textInput.value = message.data.sourceText || '';
      setStatus('選択したテキストを翻訳しました。', 'success');
    }
  } else if (message?.type === 'translationError') {
    setStatus(message.error || '翻訳に失敗しました。', 'error');
  }
});

loadLatestTranslation();
restorePopupWidth();
setupResizeHandle();
