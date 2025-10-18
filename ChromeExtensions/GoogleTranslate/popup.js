const form = document.getElementById('translate-form');
const textInput = document.getElementById('text-input');
const translateButton = document.getElementById('translate-button');
const statusElement = document.getElementById('status');
const resultWrapper = document.getElementById('result');
const detectedLanguageElement = document.getElementById('detected-language');
const sourceTextElement = document.getElementById('source-text');
const translatedTextElement = document.getElementById('translated-text');
const updatedAtElement = document.getElementById('updated-at');

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
