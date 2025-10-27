// Built‑ins and custom nodes (customs are persisted in localStorage)
export const BUILTINS = [
{
id: 'read_file', name: 'Read File', category: 'File IO',
inputs: { path: 'string' }, outputs: { content:'string' },
script: '$content = Get-Content $path -Raw',
description: 'Read entire file as text.'
},
{
id: 'regex_extract', name: 'Regex Extract', category: 'String',
inputs: { content:'string', pattern:'string' }, outputs: { matches:'array' },
script: '$matches = [regex]::Matches($content, $pattern)',
description: 'Extract regex matches.'
},
{
id: 'write_file', name: 'Write File', category: 'File IO',
inputs: { path:'string', content:'string' }, outputs: { done:'bool' },
script: 'Set-Content -Path $path -Value $content; $done = $true',
description: 'Write text to file.'
},
{
id: 'const_text', name: 'Const Text', category: 'Data',
inputs: {}, outputs: { text:'string' },
script: '$text = $text',
description: 'Constant text (supply via inspector for now).'
}
];


export function loadCustomNodes(){
try { return JSON.parse(localStorage.getItem('pf_custom_nodes')||'[]'); } catch { return []; }
}
export function saveCustomNodes(arr){
localStorage.setItem('pf_custom_nodes', JSON.stringify(arr));
}