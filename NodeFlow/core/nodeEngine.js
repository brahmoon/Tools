import { wrapPowerShellScript } from './psTemplate.js';

const HANDLE_RADIUS = 6;

class Node {
  constructor(definition, id, position) {
    this.id = id;
    this.type = definition.id;
    this.definition = definition;
    this.position = position;
    this.config = Object.fromEntries(
      (definition.controls || []).map((control) => [control.key, control.default ?? ''])
    );
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      position: this.position,
      config: this.config,
    };
  }

  static hydrate(definition, data) {
    const node = new Node(definition, data.id, data.position);
    node.config = { ...node.config, ...data.config };
    return node;
  }
}

export class NodeEditor {
  constructor({
    paletteEl,
    nodeLayer,
    connectionLayer,
    propertyDialog,
    propertyForm,
    propertyFields,
    nodeTemplate,
    library,
    onGenerateScript,
    persistence,
  }) {
    this.paletteEl = paletteEl;
    this.nodeLayer = nodeLayer;
    this.connectionLayer = connectionLayer;
    this.propertyDialog = propertyDialog;
    this.propertyForm = propertyForm;
    this.propertyFields = propertyFields;
    this.nodeTemplate = nodeTemplate;
    this.library = library;
    this.onGenerateScript = onGenerateScript;
    this.persistence = persistence;

    this.nodes = new Map();
    this.connections = [];
    this.activeConnection = null;
    this.draggedNode = null;
    this.dragOffset = { x: 0, y: 0 };
    this.nodeCount = 0;

    this.ctx = this.connectionLayer.getContext('2d');

    this._renderPalette();
    this._bindPointerEvents();
    this.resize();
  }

  resize() {
    const rect = this.nodeLayer.getBoundingClientRect();
    this.connectionLayer.width = rect.width;
    this.connectionLayer.height = rect.height;
    this._drawConnections();
  }

  _renderPalette() {
    this.paletteEl.innerHTML = '';
    if (!this.library.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No nodes registered.';
      this.paletteEl.appendChild(empty);
      return;
    }

    const groups = this.library.reduce((acc, def) => {
      acc[def.category] = acc[def.category] || [];
      acc[def.category].push(def);
      return acc;
    }, {});

    Object.entries(groups).forEach(([category, defs]) => {
      const container = document.createElement('section');
      container.className = 'node-category';
      const heading = document.createElement('h2');
      heading.textContent = category;
      container.appendChild(heading);

      defs.forEach((def) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'node-button';
        button.textContent = def.label;
        button.addEventListener('click', () => {
          const position = { x: 60, y: 60 + this.nodeCount * 40 };
          this._createNode(def, position);
        });
        container.appendChild(button);
      });

      this.paletteEl.appendChild(container);
    });
  }

  _createNode(definition, position) {
    const nodeId = `${definition.id}_${++this.nodeCount}`;
    const node = new Node(definition, nodeId, position);
    this.nodes.set(nodeId, node);
    this._renderNode(node);
    this._drawConnections();
  }

  _renderNode(node) {
    const fragment = this.nodeTemplate.content.cloneNode(true);
    const el = fragment.querySelector('.node');
    el.dataset.id = node.id;
    el.style.transform = `translate(${node.position.x}px, ${node.position.y}px)`;
    el.querySelector('.node-label').textContent = node.definition.label;
    const configBtn = el.querySelector('.node-config');
    configBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      this._openPropertyEditor(node.id);
    });

    const inputContainer = el.querySelector('.inputs');
    node.definition.inputs.forEach((name) => {
      const port = this._createPort('input', name, node.id);
      inputContainer.appendChild(port);
    });

    const outputContainer = el.querySelector('.outputs');
    node.definition.outputs.forEach((name) => {
      const port = this._createPort('output', name, node.id);
      outputContainer.appendChild(port);
    });

    el.addEventListener('pointerdown', (event) => this._startDrag(event, node.id));

    this.nodeLayer.appendChild(el);
  }

  _createPort(type, name, nodeId) {
    const port = document.createElement('div');
    port.className = 'port';
    port.dataset.port = name;
    port.dataset.nodeId = nodeId;
    port.dataset.type = type;

    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.title = `${type === 'input' ? 'Connect to' : 'Connect from'} ${name}`;
    handle.addEventListener('pointerdown', (event) => this._beginConnection(event, nodeId, name, type));

    const label = document.createElement('span');
    label.textContent = name;

    if (type === 'input') {
      port.append(handle, label);
    } else {
      port.append(label, handle);
    }

    return port;
  }

  _startDrag(event, nodeId) {
    if (event.target.closest('.handle') || event.target.classList.contains('node-config')) {
      return;
    }
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.draggedNode = node;
    const rect = event.currentTarget.getBoundingClientRect();
    const parentRect = this.nodeLayer.getBoundingClientRect();
    this.dragOffset.x = event.clientX - rect.left;
    this.dragOffset.y = event.clientY - rect.top;
    event.currentTarget.setPointerCapture(event.pointerId);

    const moveHandler = (ev) => this._dragNode(ev);
    const upHandler = (ev) => {
      this._endDrag(ev);
      event.currentTarget.releasePointerCapture(event.pointerId);
      event.currentTarget.removeEventListener('pointermove', moveHandler);
      event.currentTarget.removeEventListener('pointerup', upHandler);
    };

    event.currentTarget.addEventListener('pointermove', moveHandler);
    event.currentTarget.addEventListener('pointerup', upHandler);
    this.dragOriginParentRect = parentRect;
  }

  _dragNode(event) {
    if (!this.draggedNode) return;
    const parentRect = this.dragOriginParentRect || this.nodeLayer.getBoundingClientRect();
    let x = event.clientX - parentRect.left - this.dragOffset.x;
    let y = event.clientY - parentRect.top - this.dragOffset.y;
    x = Math.max(0, Math.min(x, parentRect.width - 160));
    y = Math.max(0, Math.min(y, parentRect.height - 80));
    this.draggedNode.position = { x, y };
    const el = this.nodeLayer.querySelector(`.node[data-id="${this.draggedNode.id}"]`);
    if (el) {
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
    this._drawConnections();
  }

  _endDrag() {
    this.draggedNode = null;
    this.dragOriginParentRect = null;
  }

  _beginConnection(event, nodeId, portName, portType) {
    event.stopPropagation();
    event.preventDefault();
    const rect = this.nodeLayer.getBoundingClientRect();
    const nodeEl = this.nodeLayer.querySelector(`.node[data-id="${nodeId}"]`);
    if (!nodeEl) return;
    const portEl = event.currentTarget;
    const portRect = portEl.getBoundingClientRect();
    const start = {
      x: portRect.left - rect.left + HANDLE_RADIUS,
      y: portRect.top - rect.top + HANDLE_RADIUS,
    };

    this.activeConnection = {
      fromNode: portType === 'output' ? nodeId : null,
      fromPort: portType === 'output' ? portName : null,
      toNode: portType === 'input' ? nodeId : null,
      toPort: portType === 'input' ? portName : null,
      start,
      current: start,
    };

    const move = (ev) => this._trackConnection(ev);
    const up = (ev) => this._endConnection(ev, move);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  _trackConnection(event) {
    if (!this.activeConnection) return;
    const rect = this.nodeLayer.getBoundingClientRect();
    this.activeConnection.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    this._drawConnections();
  }

  _endConnection(event, moveHandler) {
    if (moveHandler) {
      window.removeEventListener('pointermove', moveHandler);
    }
    if (!this.activeConnection) return;
    const target = event.target.closest('.handle');
    if (!target) {
      this.activeConnection = null;
      this._drawConnections();
      return;
    }

    const port = target.parentElement;
    const nodeId = port.dataset.nodeId;
    const portName = port.dataset.port;
    const portType = port.dataset.type;

    if (portType === 'output') {
      this.activeConnection.fromNode = nodeId;
      this.activeConnection.fromPort = portName;
    } else {
      this.activeConnection.toNode = nodeId;
      this.activeConnection.toPort = portName;
    }

    if (!this.activeConnection.fromNode || !this.activeConnection.toNode) {
      this.activeConnection = null;
      this._drawConnections();
      return;
    }

    const exists = this.connections.some(
      (c) =>
        c.fromNode === this.activeConnection.fromNode &&
        c.fromPort === this.activeConnection.fromPort &&
        c.toNode === this.activeConnection.toNode &&
        c.toPort === this.activeConnection.toPort
    );
    if (!exists) {
      this.connections = this.connections.filter(
        (c) => !(c.toNode === this.activeConnection.toNode && c.toPort === this.activeConnection.toPort)
      );
      this.connections.push({
        fromNode: this.activeConnection.fromNode,
        fromPort: this.activeConnection.fromPort,
        toNode: this.activeConnection.toNode,
        toPort: this.activeConnection.toPort,
      });
    }

    this.activeConnection = null;
    this._drawConnections();
  }

  _getPortPosition(nodeId, portName, type) {
    const nodeEl = this.nodeLayer.querySelector(`.node[data-id="${nodeId}"]`);
    if (!nodeEl) return null;
    const selector = `.port[data-port="${portName}"][data-type="${type}"] .handle`;
    const handle = nodeEl.querySelector(selector);
    if (!handle) return null;
    const rect = handle.getBoundingClientRect();
    const parentRect = this.nodeLayer.getBoundingClientRect();
    return {
      x: rect.left - parentRect.left + HANDLE_RADIUS,
      y: rect.top - parentRect.top + HANDLE_RADIUS,
    };
  }

  _drawConnections() {
    const { width, height } = this.connectionLayer;
    this.ctx.clearRect(0, 0, width, height);
    const drawCurve = (start, end, active = false) => {
      if (!start || !end) return;
      this.ctx.beginPath();
      const cpOffset = Math.abs(end.x - start.x) * 0.5 + 60;
      this.ctx.moveTo(start.x, start.y);
      this.ctx.bezierCurveTo(
        start.x + cpOffset,
        start.y,
        end.x - cpOffset,
        end.y,
        end.x,
        end.y
      );
      this.ctx.strokeStyle = active ? 'rgba(77, 124, 255, 0.6)' : 'rgba(59, 130, 246, 0.8)';
      this.ctx.lineWidth = active ? 3 : 2.2;
      this.ctx.shadowColor = 'rgba(59, 130, 246, 0.35)';
      this.ctx.shadowBlur = active ? 14 : 6;
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    };

    this.connections.forEach((connection) => {
      const start = this._getPortPosition(connection.fromNode, connection.fromPort, 'output');
      const end = this._getPortPosition(connection.toNode, connection.toPort, 'input');
      drawCurve(start, end, false);
    });

    if (this.activeConnection) {
      const { fromNode, fromPort, toNode, toPort, start, current } = this.activeConnection;
      let origin = start;
      let target = current;
      if (fromNode && fromPort) {
        const startPos = this._getPortPosition(fromNode, fromPort, 'output');
        if (startPos) origin = startPos;
      }
      if (toNode && toPort) {
        const endPos = this._getPortPosition(toNode, toPort, 'input');
        if (endPos) target = endPos;
      }
      drawCurve(origin, target, true);
    }
  }

  _openPropertyEditor(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.propertyFields.innerHTML = '';
    this.propertyDialog.dataset.nodeId = nodeId;
    this.propertyDialog.querySelector('#property-title').textContent = `${node.definition.label} settings`;

    node.definition.controls.forEach((control) => {
      const field = document.createElement('label');
      field.textContent = control.label;
      let input;
      switch (control.type) {
        case 'select':
          input = document.createElement('select');
          (control.options || []).forEach((option) => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            input.appendChild(opt);
          });
          break;
        case 'textarea':
          input = document.createElement('textarea');
          break;
        default:
          input = document.createElement('input');
          input.type = control.type || 'text';
      }
      input.name = control.key;
      input.value = node.config[control.key] ?? control.default ?? '';
      if (control.placeholder) input.placeholder = control.placeholder;
      field.appendChild(input);
      this.propertyFields.appendChild(field);
    });

    if (!this.propertyFields.children.length) {
      const empty = document.createElement('p');
      empty.textContent = 'This node has no configurable properties.';
      empty.className = 'empty-state';
      this.propertyFields.appendChild(empty);
    }

    const onClose = () => {
      document.body.classList.remove('dialog-open');
      this.propertyDialog.removeEventListener('close', onClose);
    };

    this.propertyDialog.addEventListener('close', onClose);
    document.body.classList.add('dialog-open');
    this.propertyDialog.showModal();

    this.propertyForm.onsubmit = (event) => {
      event.preventDefault();
      const formData = new FormData(this.propertyForm);
      node.definition.controls.forEach((control) => {
        node.config[control.key] = formData.get(control.key) ?? '';
      });
      this.propertyDialog.close();
      this.propertyForm.reset();
    };

    this.propertyForm.onreset = () => {
      this.propertyDialog.close();
    };
  }

  _topologicalSort() {
    const graph = new Map();
    const indegree = new Map();
    this.nodes.forEach((node) => {
      graph.set(node.id, []);
      indegree.set(node.id, 0);
    });

    this.connections.forEach(({ fromNode, toNode }) => {
      if (!graph.has(fromNode) || !graph.has(toNode)) return;
      graph.get(fromNode).push(toNode);
      indegree.set(toNode, (indegree.get(toNode) || 0) + 1);
    });

    const queue = [];
    indegree.forEach((count, nodeId) => {
      if (count === 0) queue.push(nodeId);
    });

    const order = [];
    while (queue.length) {
      const nodeId = queue.shift();
      order.push(nodeId);
      (graph.get(nodeId) || []).forEach((neighbor) => {
        indegree.set(neighbor, indegree.get(neighbor) - 1);
        if (indegree.get(neighbor) === 0) queue.push(neighbor);
      });
    }

    if (order.length !== this.nodes.size) {
      throw new Error('Circular dependency detected.');
    }
    return order;
  }

  generateScript() {
    if (!this.nodes.size) {
      return wrapPowerShellScript('# No nodes in the workspace');
    }

    const order = this._topologicalSort();
    const outputNames = new Map();
    const nodeDefs = Object.fromEntries(this.library.map((def) => [def.id, def]));
    const lines = [];

    const getOutputVar = (nodeId, outputName) => {
      const key = `${nodeId}:${outputName}`;
      if (!outputNames.has(key)) {
        const sanitized = `${nodeId}_${outputName}`.replace(/[^A-Za-z0-9_]/g, '_');
        outputNames.set(key, `$${sanitized}`);
      }
      return outputNames.get(key);
    };

    const getInputVar = (nodeId, inputName) => {
      const connection = this.connections.find(
        (c) => c.toNode === nodeId && c.toPort === inputName
      );
      if (connection) {
        return getOutputVar(connection.fromNode, connection.fromPort);
      }
      const node = this.nodes.get(nodeId);
      if (!node) return '';
      const controls = node.definition.controls || [];
      const control = controls.find((c) => c.bindsToInput === inputName);
      if (control) {
        return node.config[control.key] || '';
      }
      return node.config[inputName] || '';
    };

    order.forEach((nodeId) => {
      const node = this.nodes.get(nodeId);
      if (!node) return;
      const def = nodeDefs[node.type];
      if (!def) return;
      const inputs = {};
      const outputs = {};
      (def.inputs || []).forEach((inputName) => {
        inputs[inputName] = getInputVar(nodeId, inputName);
      });
      (def.outputs || []).forEach((outputName) => {
        outputs[outputName] = getOutputVar(nodeId, outputName);
      });
      const missing = (def.inputs || []).filter((inputName) => !inputs[inputName]);
      if (missing.length) {
        throw new Error(
          `${node.definition.label} is missing required input: ${missing.join(', ')}`
        );
      }
      const script = def.script({ inputs, outputs, config: node.config });
      if (script) {
        lines.push(script);
      }
    });

    return wrapPowerShellScript(lines.join('\n\n'));
  }

  exportScript() {
    try {
      const script = this.generateScript();
      this.onGenerateScript(script);
    } catch (error) {
      alert(error.message);
    }
  }

  persistGraph() {
    if (!this.persistence?.save) return;
    const graph = {
      nodes: Array.from(this.nodes.values()).map((node) => node.serialize()),
      connections: this.connections.map((connection) => ({ ...connection })),
    };
    this.persistence.save(graph);
  }

  restoreGraph() {
    if (!this.persistence?.load) return;
    const data = this.persistence.load();
    if (!data) return;
    this.clearGraph(false);
    const defs = Object.fromEntries(this.library.map((def) => [def.id, def]));
    data.nodes.forEach((nodeData) => {
      const def = defs[nodeData.type];
      if (!def) return;
      this.nodeCount = Math.max(this.nodeCount, Number(nodeData.id.split('_').pop()) || 0);
      const node = Node.hydrate(def, nodeData);
      this.nodes.set(node.id, node);
      this._renderNode(node);
    });
    this.connections = (data.connections || []).map((connection) => ({ ...connection }));
    this._drawConnections();
    this.resize();
  }

  clearGraph(clearStorage = true) {
    this.nodes.clear();
    this.connections = [];
    this.nodeLayer.innerHTML = '';
    this._drawConnections();
    this.nodeCount = 0;
    if (clearStorage && this.persistence?.clear) {
      this.persistence.clear();
    }
  }

  _bindPointerEvents() {
    this.nodeLayer.addEventListener('pointerdown', () => {
      this.activeConnection = null;
      this._drawConnections();
    });
  }
}
