export function saveGraph(graph){
const data = {
nodes: [...graph.nodes.values()].map(n=>({
id:n.id,name:n.name,category:n.category,inputs:n.inputs,outputs:n.outputs,script:n.script,description:n.description,x:n.x,y:n.y
})),
edges: graph.edges
};
localStorage.setItem('pf_graph', JSON.stringify(data));
}


export function loadGraph(graph){
const raw = localStorage.getItem('pf_graph'); if(!raw) return;
const data = JSON.parse(raw);
graph.nodes.clear();
data.nodes.forEach(n=> graph.addNode(new (await import('./model.js')).NodeModel(n)));
graph.edges = data.edges.map(e=> new (await import('./model.js')).EdgeModel(e));
}