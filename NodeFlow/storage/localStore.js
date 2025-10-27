const STORAGE_KEY = 'nodeflow.graph';

export function saveGraph(graph) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
    toast('Flow saved to browser storage.');
  } catch (error) {
    alert('Failed to save flow: ' + error.message);
  }
}

export function loadGraph() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      toast('No saved flow found.');
      return null;
    }
    toast('Flow loaded from storage.');
    return JSON.parse(raw);
  } catch (error) {
    alert('Failed to load flow: ' + error.message);
    return null;
  }
}

export function clearGraph() {
  localStorage.removeItem(STORAGE_KEY);
  toast('Saved flow removed.');
}

function toast(message) {
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
}
