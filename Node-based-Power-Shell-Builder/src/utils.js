export const $ = sel => document.querySelector(sel);
export function el(tag, attrs={}, ...kids){
const n = document.createElement(tag);
Object.entries(attrs).forEach(([k,v])=>{
if (k === 'class') n.className = v; else if (k==='text') n.textContent=v; else n.setAttribute(k, v);
});
kids.flat().forEach(k=> n.append(k));
return n;
}
export function download(filename, text){
const blob = new Blob([text],{type:'text/plain'}); const url = URL.createObjectURL(blob);
const a = el('a',{href:url,download:filename}); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}