// Core data models: NodeModel, EdgeModel, Graph
export class NodeModel {
constructor({ id, name, category, inputs = {}, outputs = {}, script = '', description = '' }) {
this.id = id; this.name = name; this.category = category;
this.inputs = inputs; this.outputs = outputs; this.script = script; this.description = description;
this.x = 80; this.y = 80; // canvas position
// runtime ports cache
this._inOrder = Object.keys(inputs);
this._outOrder = Object.keys(outputs);
}
}


export class EdgeModel {
constructor({ fromNode, fromPort, toNode, toPort }) {
this.fromNode = fromNode; this.fromPort = fromPort; this.toNode = toNode; this.toPort = toPort;
}
}


export class Graph {
constructor(){ this.nodes = new Map(); this.edges = []; }
addNode(node){ this.nodes.set(node.id, node); }
removeNode(id){
this.nodes.delete(id);
this.edges = this.edges.filter(e => e.fromNode !== id && e.toNode !== id);
}
connect(edge){ this.edges.push(edge); }
disconnect(idx){ this.edges.splice(idx,1); }


topoOrder(){
// simple DFS topo
const adj = new Map([...this.nodes.keys()].map(k => [k, []]));
this.edges.forEach(e => adj.get(e.fromNode).push(e.toNode));
const vis = new Set(), out = [], temp = new Set();
const dfs = (u)=>{
if (temp.has(u)) throw new Error('Cycle detected');
if (vis.has(u)) return; temp.add(u);
adj.get(u).forEach(v=>dfs(v)); temp.delete(u); vis.add(u); out.push(u);
};
[...this.nodes.keys()].forEach(dfs);
return out; // sources first
}


inboundMap(){
// map: nodeId -> [{in, varFrom}]
const m = new Map();
this.edges.forEach(e => {
const arr = m.get(e.toNode) || []; arr.push({ in:e.toPort, from:`$${e.fromNode}_${e.fromPort}` });
m.set(e.toNode, arr);
});
return m;
}
}