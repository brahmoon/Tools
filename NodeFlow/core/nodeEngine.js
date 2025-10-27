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
    onEditCustomNode,
    persistence,
  }) {
    this.paletteEl = paletteEl;
    this.nodeLayer = nodeLayer;
    this.connectionLayer = connectionLayer;
    this.propertyDialog = propertyDialog;
    this.propertyForm = propertyForm;
    this.propertyFields = propertyFields;
    this.nodeTemplate = nodeTemplate;
    this.library = [];
    this.onGenerateScript = onGenerateScript;
    this.onEditCustomNode = onEditCustomNode;
    this.persistence = persistence;

    this.nodes = new Map();
    this.connections = [];
    this.activeConnection = null;
    this.connectionPaths = [];
    this.selectedConnection = null;
    this.draggedNode = null;
    this.dragOffset = { x: 0, y: 0 };
    this.nodeCount = 0;
    this.selectedNodeId = null;
    this.portMenu = null;

    this.ctx = this.connectionLayer.getContext('2d');

    this._setupPortContextMenu();
    this._bindPointerEvents();
    this._bindKeyboardEvents();
    this.setLibrary(library || [], { persist: false });
    this.resize();
  }

  setLibrary(definitions, { persist = true } = {}) {
    this.library = Array.isArray(definitions)
      ? definitions.filter((definition) => definition && definition.id)
      : [];
    this._renderPalette();

    const defMap = new Map(this.library.map((def) => [def.id, def]));
    const toRemove = [];

    this.nodes.forEach((node, nodeId) => {
      const def = defMap.get(node.type);
      if (!def) {
        toRemove.push(nodeId);
        return;
      }
      node.definition = def;
      const defaults = Object.fromEntries(
        (def.controls || []).map((control) => [control.key, control.default ?? ''])
      );
      node.config = {
        ...defaults,
        ...node.config,
      };
      Object.keys(node.config).forEach((key) => {
        if (!(def.controls || []).some((control) => control.key === key)) {
          if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
            delete node.config[key];
          }
        }
      });
    });

    toRemove.forEach((nodeId) => {
      this.nodes.delete(nodeId);
      if (this.selectedNodeId === nodeId) {
        this.selectedNodeId = null;
      }
    });

    this.connections = this.connections.filter((connection) => {
      const fromNode = this.nodes.get(connection.fromNode);
      const toNode = this.nodes.get(connection.toNode);
      if (!fromNode || !toNode) return false;
      const fromOutputs = Array.isArray(fromNode.definition.outputs)
        ? fromNode.definition.outputs
        : [];
      const toInputs = Array.isArray(toNode.definition.inputs)
        ? toNode.definition.inputs
        : [];
      return fromOutputs.includes(connection.fromPort) && toInputs.includes(connection.toPort);
    });

    if (this.selectedConnection && !this.connections.includes(this.selectedConnection)) {
      this._clearConnectionSelection({ redraw: false });
    }

    this._redrawNodes();
    this._drawConnections();
    if (persist) {
      this.persistGraph();
    }
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
      const category = def.category || 'Custom';
      acc[category] = acc[category] || [];
      acc[category].push(def);
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
    this._selectNode(nodeId);
    this.persistGraph();
    return node;
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
    (node.definition.inputs || []).forEach((name) => {
      const port = this._createPort('input', name, node.id);
      inputContainer.appendChild(port);
    });

    const outputContainer = el.querySelector('.outputs');
    (node.definition.outputs || []).forEach((name) => {
      const port = this._createPort('output', name, node.id);
      outputContainer.appendChild(port);
    });

    el.addEventListener('pointerdown', (event) => {
      this._selectNode(node.id);
      this._startDrag(event, node.id);
    });
    el.addEventListener('focus', () => this._selectNode(node.id));

    this.nodeLayer.appendChild(el);
  }

  _redrawNodes() {
    this.nodeLayer.querySelectorAll('.node').forEach((nodeEl) => nodeEl.remove());
    this.nodes.forEach((node) => {
      this._renderNode(node);
    });
    if (this.selectedNodeId && !this.nodes.has(this.selectedNodeId)) {
      this.selectedNodeId = null;
    } else if (this.selectedNodeId) {
      this._selectNode(this.selectedNodeId);
    }
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

    port.addEventListener('contextmenu', (event) =>
      this._openPortContextMenu(event, { nodeId, portName: name, portType: type })
    );

    return port;
  }

  _startDrag(event, nodeId) {
    if (event.target.closest('.handle') || event.target.classList.contains('node-config')) {
      return;
    }
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.draggedNode = node;
    const targetEl = event.currentTarget;
    const pointerId = event.pointerId;
    const rect = targetEl.getBoundingClientRect();
    const parentRect = this.nodeLayer.getBoundingClientRect();
    this.dragOffset.x = event.clientX - rect.left;
    this.dragOffset.y = event.clientY - rect.top;
    if (targetEl.setPointerCapture) {
      try {
        targetEl.setPointerCapture(pointerId);
      } catch (err) {
        // Ignore if the element is no longer part of the DOM or the pointer is gone.
      }
    }

    const moveHandler = (ev) => this._dragNode(ev);
    const upHandler = (ev) => {
      this._endDrag(ev);
      if (targetEl?.releasePointerCapture && targetEl.hasPointerCapture?.(pointerId)) {
        try {
          targetEl.releasePointerCapture(pointerId);
        } catch (err) {
          // The element might already be detached; ignore.
        }
      }
      targetEl?.removeEventListener('pointermove', moveHandler);
      targetEl?.removeEventListener('pointerup', upHandler);
    };

    targetEl?.addEventListener('pointermove', moveHandler);
    targetEl?.addEventListener('pointerup', upHandler);
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
      this._addConnection(
        this.activeConnection.fromNode,
        this.activeConnection.fromPort,
        this.activeConnection.toNode,
        this.activeConnection.toPort
      );
    }

    this.activeConnection = null;
    this._drawConnections();
  }

  _addConnection(fromNode, fromPort, toNode, toPort) {
    this.connections = this.connections.filter(
      (c) => !(c.toNode === toNode && c.toPort === toPort)
    );
    if (this.selectedConnection && !this.connections.includes(this.selectedConnection)) {
      this._clearConnectionSelection({ redraw: false });
    }
    const exists = this.connections.some(
      (c) =>
        c.fromNode === fromNode &&
        c.fromPort === fromPort &&
        c.toNode === toNode &&
        c.toPort === toPort
    );
    if (!exists) {
      this.connections.push({ fromNode, fromPort, toNode, toPort });
    }
    this._drawConnections();
    this.persistGraph();
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
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.connectionPaths = [];

    const createPath = (start, end) => {
      if (!start || !end) return null;
      const path = new Path2D();
      const cpOffset = Math.abs(end.x - start.x) * 0.5 + 60;
      path.moveTo(start.x, start.y);
      path.bezierCurveTo(start.x + cpOffset, start.y, end.x - cpOffset, end.y, end.x, end.y);
      return path;
    };

    this.connections.forEach((connection) => {
      const start = this._getPortPosition(connection.fromNode, connection.fromPort, 'output');
      const end = this._getPortPosition(connection.toNode, connection.toPort, 'input');
      const path = createPath(start, end);
      if (!path) return;
      const selected = this.selectedConnection === connection;
      this.ctx.strokeStyle = selected ? 'rgba(249, 115, 22, 0.9)' : 'rgba(59, 130, 246, 0.8)';
      this.ctx.lineWidth = selected ? 3.2 : 2.2;
      this.ctx.shadowColor = selected ? 'rgba(249, 115, 22, 0.4)' : 'rgba(59, 130, 246, 0.35)';
      this.ctx.shadowBlur = selected ? 12 : 6;
      this.ctx.stroke(path);
      this.ctx.shadowBlur = 0;
      this.connectionPaths.push({ path, connection });
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
      const path = createPath(origin, target);
      if (path) {
        this.ctx.strokeStyle = 'rgba(77, 124, 255, 0.6)';
        this.ctx.lineWidth = 3;
        this.ctx.shadowColor = 'rgba(77, 124, 255, 0.4)';
        this.ctx.shadowBlur = 14;
        this.ctx.stroke(path);
        this.ctx.shadowBlur = 0;
      }
    }
  }

  _hitTestConnection(clientX, clientY) {
    if (!this.connectionPaths.length) return null;
    const rect = this.connectionLayer.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const previousWidth = this.ctx.lineWidth;
    this.ctx.lineWidth = 6;
    for (let index = this.connectionPaths.length - 1; index >= 0; index -= 1) {
      const { path, connection } = this.connectionPaths[index];
      if (this.ctx.isPointInStroke(path, x, y)) {
        this.ctx.lineWidth = previousWidth;
        return connection;
      }
    }
    this.ctx.lineWidth = previousWidth;
    return null;
  }

  _selectConnection(connection) {
    if (!connection) return;
    if (this.selectedConnection === connection) return;
    this._clearNodeSelection();
    this.selectedConnection = connection;
    this._drawConnections();
  }

  _clearConnectionSelection({ redraw = true } = {}) {
    if (!this.selectedConnection) return;
    this.selectedConnection = null;
    if (redraw) {
      this._drawConnections();
    }
  }

  _removeSelectedConnection() {
    if (!this.selectedConnection) return;
    const target = this.selectedConnection;
    this.connections = this.connections.filter((connection) => connection !== target);
    this._clearConnectionSelection({ redraw: false });
    this._drawConnections();
    this.persistGraph();
  }

  _openPropertyEditor(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.propertyFields.innerHTML = '';
    this.propertyDialog.dataset.nodeId = nodeId;
    this.propertyDialog.querySelector('#property-title').textContent = `${node.definition.label} settings`;

    const controls = node.definition.controls || [];
    const supportsDesigner = Boolean(this.onEditCustomNode) && Boolean(node.definition.specId);

    if (controls.length) {
      const header = document.createElement('div');
      header.className = 'property-constants-header';
      const title = document.createElement('span');
      title.className = 'property-constants-title';
      title.textContent = '定数 (Key / Value)';
      header.appendChild(title);
      if (supportsDesigner) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'property-edit-spec';
        editButton.setAttribute('title', 'カスタムノードを編集');
        editButton.setAttribute('aria-label', 'カスタムノードを編集');
        editButton.textContent = '<>';
        editButton.addEventListener('click', (event) => {
          event.preventDefault();
          this.propertyDialog.close();
          this.propertyForm.reset();
          this.onEditCustomNode?.(node.definition.specId);
        });
        header.appendChild(editButton);
      }
      this.propertyFields.appendChild(header);
    }

    controls.forEach((control) => {
      const field = document.createElement('label');
      field.className = 'property-field';
      const keyLabel = document.createElement('span');
      keyLabel.className = 'property-field-key';
      keyLabel.textContent = control.displayKey || control.key;
      let input;
      switch (control.type) {
        case 'select':
          input = document.createElement('select');
          input.className = 'property-field-input select';
          (control.options || []).forEach((option) => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            input.appendChild(opt);
          });
          break;
        case 'textarea':
          input = document.createElement('textarea');
          input.className = 'property-field-input textarea';
          break;
        default:
          input = document.createElement('input');
          input.type = control.type || 'text';
          input.className = 'property-field-input';
      }
      const inputId = `${node.id}_${control.key}`;
      input.name = control.key;
      input.id = inputId;
      input.value = node.config[control.key] ?? control.default ?? '';
      if (control.placeholder) input.placeholder = control.placeholder;
      input.autocomplete = 'off';
      field.htmlFor = inputId;
      field.append(keyLabel, input);
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
      controls.forEach((control) => {
        node.config[control.key] = formData.get(control.key) ?? '';
      });
      this.propertyDialog.close();
      this.propertyForm.reset();
      this.persistGraph();
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
    this.selectedNodeId = null;
    this.selectedConnection = null;
    this.connectionPaths = [];
    this._hidePortContextMenu();
  }

  _bindPointerEvents() {
    this.nodeLayer.addEventListener('pointerdown', (event) => {
      const isNodeTarget = Boolean(event.target.closest('.node'));
      if (!isNodeTarget) {
        const connection = this._hitTestConnection(event.clientX, event.clientY);
        if (connection) {
          event.preventDefault();
          this._selectConnection(connection);
          return;
        }
      }
      if (!isNodeTarget) {
        this._clearConnectionSelection({ redraw: false });
        this._clearNodeSelection();
      }
      this.activeConnection = null;
      this._drawConnections();
    });

    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('.port-context-menu')) {
        this._hidePortContextMenu();
      }
    });
  }

  _bindKeyboardEvents() {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Delete') {
        const active = document.activeElement;
        if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) {
          return;
        }
        event.preventDefault();
        if (this.selectedConnection) {
          this._removeSelectedConnection();
        } else if (this.selectedNodeId) {
          this._removeNode(this.selectedNodeId);
        }
      }
    });
  }

  _selectNode(nodeId) {
    if (this.selectedNodeId === nodeId) {
      this._clearConnectionSelection();
      return;
    }
    this._clearConnectionSelection();
    this._clearNodeSelection();
    const el = this.nodeLayer.querySelector(`.node[data-id="${nodeId}"]`);
    if (el) {
      el.classList.add('selected');
      this.selectedNodeId = nodeId;
    }
  }

  _clearSelection() {
    this._clearNodeSelection();
    this._clearConnectionSelection();
  }

  _clearNodeSelection() {
    if (!this.selectedNodeId) return;
    const el = this.nodeLayer.querySelector(`.node[data-id="${this.selectedNodeId}"]`);
    if (el) {
      el.classList.remove('selected');
    }
    this.selectedNodeId = null;
  }

  _removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.nodes.delete(nodeId);
    const el = this.nodeLayer.querySelector(`.node[data-id="${nodeId}"]`);
    if (el) {
      el.remove();
    }
    this.connections = this.connections.filter(
      (connection) => connection.fromNode !== nodeId && connection.toNode !== nodeId
    );
    if (this.selectedConnection && !this.connections.includes(this.selectedConnection)) {
      this._clearConnectionSelection({ redraw: false });
    }
    this._drawConnections();
    if (this.selectedNodeId === nodeId) {
      this._clearNodeSelection();
    }
    this._hidePortContextMenu();
    this.persistGraph();
  }

  _setupPortContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'port-context-menu hidden';
    menu.addEventListener('pointerdown', (event) => event.stopPropagation());
    menu.addEventListener('contextmenu', (event) => event.preventDefault());
    this.portMenu = menu;
    this.nodeLayer.appendChild(menu);
  }

  _openPortContextMenu(event, { nodeId, portName, portType }) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.portMenu) return;

    const compatible = this.library.filter((def) => {
      if (portType === 'output') {
        return (def.inputs || []).includes(portName);
      }
      return (def.outputs || []).includes(portName);
    });

    const layerRect = this.nodeLayer.getBoundingClientRect();
    const portRect = event.currentTarget.getBoundingClientRect();
    const offsetX = portType === 'output' ? 120 : -220;
    let x = portRect.left - layerRect.left + offsetX;
    let y = portRect.top - layerRect.top - 20;
    x = Math.max(16, Math.min(x, layerRect.width - 220));
    y = Math.max(16, Math.min(y, layerRect.height - 140));

    this._showPortContextMenu({ x, y, compatible, source: { nodeId, portName, portType } });
  }

  _showPortContextMenu({ x, y, compatible, source }) {
    if (!this.portMenu) return;
    this.portMenu.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'port-context-options';

    if (!compatible.length) {
      const empty = document.createElement('div');
      empty.className = 'port-context-empty';
      empty.textContent = 'No compatible nodes';
      list.appendChild(empty);
    } else {
      compatible.forEach((def) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = def.label;
        button.addEventListener('click', () => {
          const layerRect = this.nodeLayer.getBoundingClientRect();
          const position = {
            x: Math.max(16, Math.min(x, layerRect.width - 200)),
            y: Math.max(16, Math.min(y, layerRect.height - 120)),
          };
          const newNode = this._createNode(def, position);
          if (source.portType === 'output') {
            const inputName = (def.inputs || []).find((input) => input === source.portName);
            if (inputName) {
              this._addConnection(source.nodeId, source.portName, newNode.id, inputName);
            }
          } else {
            const outputName = (def.outputs || []).find((output) => output === source.portName);
            if (outputName) {
              this._addConnection(newNode.id, outputName, source.nodeId, source.portName);
            }
          }
          this._hidePortContextMenu();
        });
        list.appendChild(button);
      });
    }

    this.portMenu.appendChild(list);
    this.portMenu.style.left = `${x}px`;
    this.portMenu.style.top = `${y}px`;
    this.portMenu.classList.remove('hidden');
  }

  _hidePortContextMenu() {
    if (!this.portMenu) return;
    this.portMenu.classList.add('hidden');
  }
}
