// Lightweight SVG editor: nodes as rounded rects; ports as circles; edges as paths
this.graph.edges.forEach(e=>{
const a = this.graph.nodes.get(e.fromNode); const b = this.graph.nodes.get(e.toNode);
const ax = a.x+NODE_W-4, ay=a.y+NODE_H/2; const bx=b.x+4, by=b.y+NODE_H/2;
const p = el('path',{class:'edge', d:`M ${ax} ${ay} C ${ax+40} ${ay}, ${bx-40} ${by}, ${bx} ${by}`});
svg.append(p);
});


// nodes
const makePort = (node, name, x, y, isOut)=>{
const c = el('circle',{class:'port', r:PORT_R, cx:x, cy:y});
c.addEventListener('click', ()=>{
if(!this.pendingConn){
this.pendingConn = { fromNode: node.id, fromPort: name, side: isOut?'out':'in' };
} else {
const p = this.pendingConn;
if(p.side==='out' && !isOut) this.connect(p.fromNode, p.fromPort, node.id, name);
this.pendingConn = null;
}
});
svg.append(c);
};


this.graph.nodes.forEach(node=>{
const g = el('g');
const rect = el('rect',{class:`node${this.selected===node.id?' selected':''}`, x:node.x, y:node.y, width:NODE_W, height:NODE_H, rx:10, ry:10});
rect.addEventListener('mousedown', e=>{
this.selected=node.id; this.dragging=node; const pt=this.svg.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY; const ctm=this.svg.getScreenCTM().inverse(); const loc=pt.matrixTransform(ctm); this.dragDX=loc.x-node.x; this.dragDY=loc.y-node.y; this.render();
this.showInspector(node);
});
g.append(rect);
const title = el('text',{x:node.x+10,y:node.y+18,class:'node-title'}); title.textContent=node.name; svg.append(title);
// ports
const inKeys = node._inOrder; const outKeys = node._outOrder;
inKeys.forEach((k,idx)=>{ makePort(node,k,node.x-PORT_R-2, node.y+20+idx*18,false); const t=el('text',{x:node.x+6,y:node.y+24+idx*18,class:'small'}); t.textContent=k; svg.append(t); });
outKeys.forEach((k,idx)=>{ makePort(node,k,node.x+NODE_W+PORT_R+2, node.y+20+idx*18,true); const t=el('text',{x:node.x+NODE_W-6,y:node.y+24+idx*18,class:'small'}); t.textContent=k; t.setAttribute('text-anchor','end'); svg.append(t); });
svg.append(g);
});
}


showInspector(node){
const box = document.getElementById('inspector'); box.innerHTML='';
box.append(
el('div',{}, el('label',{text:'Id'}), el('input',{value:node.id, readonly:true})),
el('div',{}, el('label',{text:'Name'}), ( ()=>{const i=el('input',{value:node.name}); i.oninput=()=>{node.name=i.value; this.render();}; return i;})() ),
el('div',{}, el('label',{text:'Script'}), ( ()=>{const ta=el('textarea', {rows:6}); ta.value=node.script; ta.oninput=()=>node.script=ta.value; return ta;})() ),
el('div',{}, el('span',{class:'small',text:'Use $inputName / $outputName. Variables are rewritten to $nodeId_inputName on export.'}))
);
}
}