const DEFAULT_FILENAME = () =>
  `nodeflow-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;

const showToast = (message) => {
  if (!message) return;
  const div = document.createElement('div');
  div.textContent = message;
  div.style.position = 'fixed';
  div.style.bottom = '24px';
  div.style.right = '24px';
  div.style.padding = '0.75rem 1.25rem';
  div.style.background = 'rgba(15, 23, 42, 0.85)';
  div.style.color = 'white';
  div.style.borderRadius = '12px';
  div.style.boxShadow = '0 18px 32px rgba(15, 23, 42, 0.35)';
  div.style.zIndex = 10;
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity 200ms ease';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 200);
  }, 1600);
};

export async function saveGraph(graph) {
  try {
    const suggestedName = DEFAULT_FILENAME();
    const name = prompt('保存するファイル名を入力してください (.json)', suggestedName);
    if (!name) {
      return false;
    }
    const filename = name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
    const blob = new Blob([JSON.stringify(graph, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast('フローをファイルに保存しました。');
    return true;
  } catch (error) {
    alert('フローの保存に失敗しました: ' + error.message);
    return false;
  }
}

export function loadGraph() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => {
      input.value = '';
      input.remove();
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        try {
          const data = JSON.parse(reader.result);
          showToast(`${file.name} を読み込みました。`);
          resolve(data);
        } catch (error) {
          alert('フローの読み込みに失敗しました: ' + error.message);
          resolve(null);
        }
      };
      reader.onerror = () => {
        cleanup();
        alert('ファイルの読み込みに失敗しました。');
        resolve(null);
      };
      reader.readAsText(file, 'utf-8');
    });

    input.click();
  });
}

export function clearGraph() {
  showToast('エディタを初期化しました。保存されたファイルには影響しません。');
}
