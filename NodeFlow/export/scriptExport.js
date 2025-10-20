export function exportScript(script) {
  const dialog = document.createElement('dialog');
  dialog.style.padding = '0';
  dialog.style.border = 'none';
  dialog.style.borderRadius = '12px';
  dialog.style.maxWidth = '520px';
  dialog.style.width = '90vw';
  dialog.innerHTML = `
    <form method="dialog" style="display:flex;flex-direction:column;max-height:80vh">
      <header style="padding:1rem 1.25rem;border-bottom:1px solid rgba(148,163,184,0.4)">
        <h2 style="margin:0;font-size:1.1rem">Generated PowerShell Script</h2>
      </header>
      <textarea readonly style="flex:1;margin:0;border:none;padding:1rem 1.25rem;font-family:'Cascadia Code',Consolas,monospace;font-size:0.9rem;resize:none;white-space:pre"></textarea>
      <p class="feedback" style="margin:0;padding:0 1.25rem 0.75rem;font-size:0.85rem;color:#38bdf8;display:none"></p>
      <menu style="display:flex;gap:0.5rem;justify-content:flex-end;padding:0.75rem 1.25rem">
        <button value="close">Close</button>
        <button type="button" id="copy-script" class="primary">Copy</button>
        <button type="button" id="download-script" class="primary">Download</button>
      </menu>
    </form>
  `;
  document.body.appendChild(dialog);
  const textarea = dialog.querySelector('textarea');
  textarea.value = script;

  dialog.addEventListener('close', () => {
    dialog.remove();
  });

  const feedback = dialog.querySelector('.feedback');

  dialog.querySelector('#copy-script').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(script);
      if (feedback) {
        feedback.textContent = 'Copied to clipboard!';
        feedback.style.display = 'block';
      }
    } catch (error) {
      alert('Clipboard copy failed: ' + error.message);
    }
  });

  dialog.querySelector('#download-script').addEventListener('click', () => {
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flow.ps1';
    link.click();
    URL.revokeObjectURL(url);
  });

  dialog.showModal();
}
