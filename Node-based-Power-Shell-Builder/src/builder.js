// Custom Node Builder (modal)
import { el } from './utils.js';
import { loadCustomNodes, saveCustomNodes } from './nodeLib.js';


export function openBuilder(){
const dlg = document.getElementById('builder-modal');
dlg.innerHTML='';


const name = el('input', {placeholder:'Node Name'});
const cat = el('select'); ['File IO','String','Data','Flow','Excel','Logging','System'].forEach(c=> cat.append(el('option',{text:c,value:c})));
const desc = el('textarea',{rows:3,placeholder:'Description (optional)'});


const inputs = el('div',{class:'table'}), outputs = el('div',{class:'table'});
const addKV = (host)=>{
const row = el('div',{class:'kv'}, el('input',{placeholder:'name'}), el('input',{placeholder:'type', value:'string'}), el('button',{text:'−'}));
row.querySelector('button').onclick=()=>row.remove(); host.append(row);
};
const addBar = (title, host)=> el('div',{}, el('div',{class:'small',text:title}), el('div',{class:'kv'}, el('button',{text:'＋'})));


const a1 = addBar('Inputs', inputs); a1.querySelector('button').onclick=()=>addKV(inputs);
const a2 = addBar('Outputs', outputs); a2.querySelector('button').onclick=()=>addKV(outputs);


const script = el('textarea',{rows:6,placeholder:'PowerShell snippet using $input and $output vars'});


const save = el('button',{text:'Save Node'}); const cancel = el('button',{text:'Close'});
save.onclick = ()=>{
const ins = {}; [...inputs.querySelectorAll('.kv')].forEach(kv=>{ const k=kv.children[0].value.trim(); const t=kv.children[1].value.trim()||'string'; if(k) ins[k]=t; });
const outs = {}; [...outputs.querySelectorAll('.kv')].forEach(kv=>{ const k=kv.children[0].value.trim(); const t=kv.children[1].value.trim()||'string'; if(k) outs[k]=t; });
if(!name.value.trim()) return alert('Name required');
if(Object.keys(outs).length===0) return alert('At least one output');
const id = name.value.trim().toLowerCase().replace(/[^\w]+/g,'_');
const node = { id,name:name.value.trim(), category:cat.value, inputs:ins, outputs:outs, script:script.value.trim(), description:desc.value.trim() };
const list = loadCustomNodes().filter(n=>n.id!==id); list.push(node); saveCustomNodes(list);
alert('Saved. Reload library to see it.'); dlg.close();
};
cancel.onclick=()=>dlg.close();


dlg.append(
el('h3',{text:'New Custom Node'}),
el('div',{class:'row'}, el('div',{}, el('label',{text:'Name'}), name), el('div',{}, el('label',{text:'Category'}), cat)),
el('div',{}, el('label',{text:'Description'}), desc),
el('div',{class:'row'}, inputs, outputs),
el('div',{}, el('label',{text:'Script'}), script, el('div',{class:'small',text:'Use $inputName / $outputName variables. They are rewritten on export.'})),
el('div',{}, save, ' ', cancel)
);
dlg.showModal();
}