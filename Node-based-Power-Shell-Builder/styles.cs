:root { --bg:#0f1115; --panel:#151923; --muted:#99a1b3; --fg:#e7ecf3; --accent:#6aa9ff; }
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0b0d12;border-bottom:1px solid #202534}
.topbar .brand{font-weight:700}
.topbar .actions button{margin-left:8px}
.grid{display:grid;grid-template-columns:260px 1fr 300px;grid-template-rows:calc(100vh - 49px)}
.sidebar,.inspector{padding:12px;background:var(--panel);border-left:1px solid #202534;overflow:auto}
.sidebar{border-right:1px solid #202534}
#library .node-tile{padding:8px;border:1px solid #2a3143;border-radius:10px;margin-bottom:8px;cursor:grab}
#library .node-tile:hover{border-color:var(--accent)}
.canvas-wrap{position:relative}
#canvas{width:100%;height:100%;background:#0b0f18}
.node{fill:#192131;stroke:#2a3143;stroke-width:1.5px;rx:10;ry:10}
.node.selected{stroke:var(--accent)}
.node-title{font-weight:700;fill:#cfe2ff;pointer-events:none}
.port{fill:#28324a;stroke:#445173;cursor:pointer}
.port:hover{fill:#2f4167}
.edge{stroke:#5b6a8f;stroke-width:2}
button{background:#1a2233;color:var(--fg);border:1px solid #2a3143;border-radius:8px;padding:6px 10px;cursor:pointer}
button:hover{border-color:var(--accent)}
#inspector input, #inspector textarea, #builder-modal input, #builder-modal textarea, #builder-modal select{
width:100%;margin:4px 0 10px 0;padding:6px;border-radius:8px;border:1px solid #2a3143;background:#121826;color:#e7ecf3
}
#builder-modal{width:720px;border:1px solid #2a3143;border-radius:12px;padding:16px;background:#0e1420;color:#e7ecf3}
#builder-modal .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.table{border:1px solid #2a3143;border-radius:10px;padding:8px}
.table .kv{display:grid;grid-template-columns:1fr 120px 32px;gap:8px;margin-bottom:6px}
.kv button{width:32px;padding:0}
.small{color:var(--muted);font-size:12px}