import { el, $ } from './utils.js';
import { BUILTINS, loadCustomNodes } from './nodeLib.js';
import { NodeModel, Graph } from './model.js';
import { Editor } from './editor.js';
import { exportPs1 } from './export.js';


const graph = new Graph();
const editor = new Editor(document.getElementById('canvas'), graph, document.getElementById('inspector'));


function renderLibrary(){
const lib = document.getElementById('library'); lib.innerHTML='';
const all = [...BUILTINS, ...loadCustomNodes()];
all.forEach(item=>{
const t = el('div',{class:'node-tile'});
t.append(el('div',{text:`${item.category}` , class:'small'}), el('div',{text:item.name}), el('div',{text:`[${item.id}]`, class:'small'}));
t.title = item.description||'';
t.onclick = ()=> editor.addNode(new NodeModel(JSON.parse(JSON.stringify(item))));
lib.append(t);
});
}


renderLibrary();


// topbar
$('#btn-export').onclick = ()=> exportPs1(graph);
$('#btn-new').onclick = ()=> { graph.nodes.clear(); graph.edges.length=0; editor.render(); };
$('#btn-save').onclick = ()=>{
const data = {
nodes: [...graph.nodes.values()].map(n=>({id:n.id,name:n.name,category:n.category,inputs:n.inputs,outputs:n.outputs,script:n.script,description:n.description,x:n.x,y:n.y})),
edges: graph.edges
};
localStorage.setItem('pf_graph', JSON.stringify(data)); alert('Saved');
};
$('#btn-load').onclick = ()=>{
const raw = localStorage.getItem('pf_graph'); if(!raw) return alert('No save');
const data = JSON.parse(raw); graph.nodes.clear(); graph.edges=[];
data.nodes.forEach(n=> graph.addNode(new NodeModel(n))); graph.edges = data.edges; editor.render();
};


import('./builder.js').then(m=> $('#btn-builder').onclick = ()=> m.openBuilder() );


// Initial canvas draw
editor.render();