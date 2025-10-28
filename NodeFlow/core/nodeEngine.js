import { wrapPowerShellScript } from './psTemplate.js';

const HANDLE_RADIUS = 6;
const PALETTE_STORAGE_KEY = 'nodeflow.palette.v1';
const PALETTE_NODE_PREFIX = 'node:';
const PALETTE_DIRECTORY_PREFIX = 'dir:';

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
    onDuplicatePaletteNode,
    onRemovePaletteNode,
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
    this.onDuplicatePaletteNode =
      typeof onDuplicatePaletteNode === 'function' ? onDuplicatePaletteNode : null;
    this.onRemovePaletteNode =
      typeof onRemovePaletteNode === 'function' ? onRemovePaletteNode : null;
    this.persistence = persistence;

    this.nodes = new Map();
    this.connections = [];
    this.activeConnection = null;
    this.connectionPaths = [];
    this.selectedConnection = null;
    this.draggedNode = null;
    this.nodeCount = 0;
    this.selectedNodes = new Set();
    this.portMenu = null;
    this.isDirty = false;
    this.selectionState = null;
    this.selectionOverlay = null;
    this.draggingGroup = null;
    this.dragMoved = false;
    this.dragStartClient = null;
    this.paletteState = this._loadPaletteState(library || []);
    this.paletteDragState = null;
    this.paletteDropIndicator = null;
    this.paletteMenu = null;
    this._paletteMenuOutsideHandler = null;

    this.ctx = this.connectionLayer.getContext('2d');

    this._setupPortContextMenu();
    this._setupPaletteContextMenu();
    this._bindPointerEvents();
    this._bindKeyboardEvents();
    this.setLibrary(library || [], { persist: false });
    this.resize();
  }

  _makePaletteId(prefix) {
    return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }

  _createDirectoryItem(name, meta = {}) {
    const collapsed = typeof meta.collapsed === 'boolean' ? meta.collapsed : false;
    return {
      id: this._makePaletteId(PALETTE_DIRECTORY_PREFIX),
      type: 'directory',
      name: name || 'New Folder',
      children: [],
      meta: { ...meta, collapsed },
    };
  }

  _createNodeItem(definitionId) {
    return {
      id: `${PALETTE_NODE_PREFIX}${definitionId}`,
      type: 'node',
      nodeId: definitionId,
    };
  }

  _createDefaultPaletteState(initialLibrary = []) {
    const root = {
      id: `${PALETTE_DIRECTORY_PREFIX}root`,
      type: 'directory',
      name: 'Nodes',
      children: [],
    };
    if (!Array.isArray(initialLibrary) || !initialLibrary.length) {
      return root;
    }
    const groups = initialLibrary.reduce((acc, def) => {
      const category = def.category || 'Custom';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(def.id);
      return acc;
    }, {});
    Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([category, ids]) => {
        const dir = this._createDirectoryItem(category, { generated: true });
        dir.children = ids.map((id) => this._createNodeItem(id));
        root.children.push(dir);
      });
    return root;
  }

  _loadPaletteState(initialLibrary = []) {
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    try {
      const raw = storage?.getItem(PALETTE_STORAGE_KEY);
      if (!raw) {
        return this._createDefaultPaletteState(initialLibrary);
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.type !== 'directory') {
        return this._createDefaultPaletteState(initialLibrary);
      }
      return parsed;
    } catch (error) {
      console.warn('Failed to load palette state', error);
      return this._createDefaultPaletteState(initialLibrary);
    }
  }

  _savePaletteState() {
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    try {
      storage?.setItem(PALETTE_STORAGE_KEY, JSON.stringify(this.paletteState));
    } catch (error) {
      console.warn('Failed to save palette state', error);
    }
  }

  _findDirectoryById(id, current = this.paletteState) {
    if (!current || current.type !== 'directory') return null;
    if (current.id === id) return current;
    for (const child of current.children || []) {
      if (child.type === 'directory') {
        const found = this._findDirectoryById(id, child);
        if (found) return found;
      }
    }
    return null;
  }

  _findDirectoryByName(name, current = this.paletteState) {
    if (!current || current.type !== 'directory') return null;
    if (current.name === name) return current;
    for (const child of current.children || []) {
      if (child.type === 'directory') {
        const found = this._findDirectoryByName(name, child);
        if (found) return found;
      }
    }
    return null;
  }

  _findParentOf(itemId, current = this.paletteState, parent = null) {
    if (!current || current.type !== 'directory') return null;
    if (current.id === itemId) {
      return parent;
    }
    for (const child of current.children || []) {
      if (child.id === itemId) {
        return current;
      }
      if (child.type === 'directory') {
        const found = this._findParentOf(itemId, child, current);
        if (found) return found;
      }
    }
    return null;
  }

  _findPaletteItem(itemId, current = this.paletteState) {
    if (!current || current.type !== 'directory') return null;
    if (current.id === itemId) return current;
    for (const child of current.children || []) {
      if (child.id === itemId) return child;
      if (child.type === 'directory') {
        const found = this._findPaletteItem(itemId, child);
        if (found) return found;
      }
    }
    return null;
  }

  _ensurePaletteIntegrity() {
    if (!this.paletteState || this.paletteState.type !== 'directory') {
      this.paletteState = this._createDefaultPaletteState(this.library);
    }
    const validIds = new Set(this.library.map((def) => def.id));
    const seen = new Set();

    const prune = (directory) => {
      directory.children = (directory.children || []).filter((child) => {
        if (child.type === 'node') {
          if (!validIds.has(child.nodeId)) {
            return false;
          }
          seen.add(child.nodeId);
          return true;
        }
        if (child.type === 'directory') {
          prune(child);
          return true;
        }
        return false;
      });
    };

    prune(this.paletteState);

    this.library.forEach((definition) => {
      if (seen.has(definition.id)) {
        return;
      }
      const category = definition.category || 'Custom';
      const targetDir = this._findDirectoryByName(category) || this.paletteState;
      targetDir.children = targetDir.children || [];
      targetDir.children.push(this._createNodeItem(definition.id));
    });

    this._savePaletteState();
  }

  _isDescendant(parentId, childId) {
    const parent = this._findPaletteItem(parentId);
    if (!parent || parent.type !== 'directory') return false;
    const stack = [...(parent.children || [])];
    while (stack.length) {
      const item = stack.shift();
      if (item.id === childId) return true;
      if (item.type === 'directory') {
        stack.push(...(item.children || []));
      }
    }
    return false;
  }

  _createDirectory(parentId, name) {
    const parent = this._findDirectoryById(parentId);
    if (!parent) return;
    parent.children = parent.children || [];
    parent.children.push(this._createDirectoryItem(name));
    this._savePaletteState();
    this._renderPalette();
  }

  _markDirty() {
    this.isDirty = true;
  }

  _clearDirty() {
    this.isDirty = false;
  }

  setLibrary(definitions, { persist = true } = {}) {
    this.library = Array.isArray(definitions)
      ? definitions.filter((definition) => definition && definition.id)
      : [];
    this._ensurePaletteIntegrity();
    this._renderPalette();

    const defMap = new Map(this.library.map((def) => [def.id, def]));
    const toRemove = [];
    let changed = false;

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
      if (this.selectedNodes.has(nodeId)) {
        this.selectedNodes.delete(nodeId);
      }
      changed = true;
    });

    const previousConnectionLength = this.connections.length;
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
    if (this.connections.length !== previousConnectionLength) {
      changed = true;
    }

    if (this.selectedConnection && !this.connections.includes(this.selectedConnection)) {
      this._clearConnectionSelection({ redraw: false });
    }

    this._redrawNodes();
    this._drawConnections();
    if (persist && changed) {
      this._markDirty();
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
    this._hidePaletteContextMenu();
    this.paletteEl.classList.add('palette-tree');

    if (!this.library.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No nodes registered.';
      this.paletteEl.appendChild(empty);
      return;
    }

    const content = this._renderDirectory(this.paletteState, { isRoot: true });
    this.paletteEl.appendChild(content);
    if (!this.paletteDropIndicator) {
      this.paletteDropIndicator = document.createElement('div');
      this.paletteDropIndicator.className = 'palette-drop-indicator hidden';
    } else {
      this.paletteDropIndicator.classList.add('hidden');
    }
    this.paletteEl.appendChild(this.paletteDropIndicator);

    if (!this._paletteContextMenuBound) {
      this.paletteEl.addEventListener('contextmenu', (event) => this._handlePaletteContextMenu(event));
      this._paletteContextMenuBound = true;
    }
  }

  _renderDirectory(directory, { isRoot = false } = {}) {
    const container = document.createElement('div');
    container.className = isRoot ? 'palette-root' : 'palette-directory';
    container.dataset.id = directory.id;
    container.dataset.type = 'directory';

    if (!isRoot) {
      const header = document.createElement('div');
      header.className = 'palette-directory-header';
      header.dataset.id = directory.id;
      header.draggable = true;
      const isCollapsed = Boolean(directory.meta?.collapsed);
      header.setAttribute('aria-expanded', String(!isCollapsed));

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'palette-directory-toggle';
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.setAttribute(
        'aria-label',
        isCollapsed ? `${directory.name} を展開` : `${directory.name} を折りたたむ`
      );
      toggle.textContent = isCollapsed ? '▸' : '▾';
      toggle.addEventListener('pointerdown', (event) => event.stopPropagation());
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        this._toggleDirectoryCollapse(directory.id);
      });

      const title = document.createElement('span');
      title.className = 'palette-directory-name';
      title.textContent = directory.name;

      header.append(toggle, title);
      header.addEventListener('dragstart', (event) => this._onPaletteDragStart(event, directory));
      header.addEventListener('dragend', () => this._resetPaletteDrag());
      header.addEventListener('dragover', (event) => this._onPaletteDragOver(event));
      header.addEventListener('drop', (event) => this._onPaletteDrop(event));
      container.appendChild(header);
    }

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'palette-children';
    childrenContainer.dataset.parentId = directory.id;
    childrenContainer.addEventListener('dragover', (event) => this._onPaletteDragOver(event));
    childrenContainer.addEventListener('drop', (event) => this._onPaletteDrop(event));

    (directory.children || []).forEach((child) => {
      if (child.type === 'directory') {
        childrenContainer.appendChild(this._renderDirectory(child));
      } else if (child.type === 'node') {
        const nodeButton = this._renderPaletteNode(child);
        if (nodeButton) {
          childrenContainer.appendChild(nodeButton);
        }
      }
    });

    const isCollapsed = Boolean(directory.meta?.collapsed);
    if (isCollapsed) {
      container.classList.add('is-collapsed');
      childrenContainer.hidden = true;
    }

    container.appendChild(childrenContainer);
    return container;
  }

  _renderPaletteNode(item) {
    const definition = this.library.find((def) => def.id === item.nodeId);
    if (!definition) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'node-button palette-node';
    button.textContent = definition.label;
    button.dataset.id = item.id;
    button.dataset.nodeId = item.nodeId;
    button.dataset.type = 'node';
    button.draggable = true;
    button.addEventListener('click', () => {
      const position = { x: 60, y: 60 + this.nodeCount * 40 };
      this._createNode(definition, position);
    });
    button.addEventListener('dragstart', (event) => this._onPaletteDragStart(event, item));
    button.addEventListener('dragend', () => this._resetPaletteDrag());
    button.addEventListener('dragover', (event) => this._onPaletteDragOver(event));
    button.addEventListener('drop', (event) => this._onPaletteDrop(event));
    return button;
  }

  _ensurePaletteIndicator() {
    if (!this.paletteDropIndicator) {
      this.paletteDropIndicator = document.createElement('div');
      this.paletteDropIndicator.className = 'palette-drop-indicator hidden';
      this.paletteEl.appendChild(this.paletteDropIndicator);
    }
    return this.paletteDropIndicator;
  }

  _onPaletteDragStart(event, item) {
    if (!item?.id) return;
    this.paletteDragState = {
      itemId: item.id,
      itemType: item.type,
      dropTarget: null,
    };
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
      } catch (error) {
        // Ignore dataTransfer errors (e.g., unsupported operations)
      }
    }
  }

  _resolvePaletteDropContext(event) {
    if (!event || !event.target || !this.paletteEl.contains(event.target)) {
      return null;
    }

    const origin = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!origin) {
      return null;
    }
    if (origin.closest('.palette-drop-indicator')) {
      return null;
    }

    const selector =
      '.palette-node, .palette-directory-header, .palette-children, .palette-directory, .palette-root';
    const target = origin.closest(selector);
    if (!target) {
      return null;
    }

    if (target.classList.contains('palette-node')) {
      const parentContainer = target.closest('.palette-children');
      const parentId = parentContainer?.dataset.parentId || this.paletteState.id;
      return {
        type: 'node',
        id: target.dataset.id,
        element: target,
        parentId,
      };
    }

    if (target.classList.contains('palette-directory-header')) {
      return {
        type: 'directory-header',
        id: target.dataset.id,
        element: target,
      };
    }

    if (target.classList.contains('palette-children')) {
      const parentId = target.dataset.parentId || this.paletteState.id;
      return {
        type: 'container',
        id: parentId,
        element: target,
        parentId,
      };
    }

    if (target.classList.contains('palette-directory')) {
      const header = target.querySelector(':scope > .palette-directory-header');
      if (header) {
        return {
          type: 'directory-header',
          id: header.dataset.id,
          element: header,
        };
      }
      const childrenContainer = target.querySelector(':scope > .palette-children');
      if (childrenContainer) {
        const parentId = childrenContainer.dataset.parentId || target.dataset.id || this.paletteState.id;
        return {
          type: 'container',
          id: parentId,
          element: childrenContainer,
          parentId,
        };
      }
    }

    if (target.classList.contains('palette-root')) {
      const childrenContainer = target.querySelector(':scope > .palette-children');
      if (childrenContainer) {
        const parentId =
          childrenContainer.dataset.parentId || target.dataset.id || this.paletteState.id;
        return {
          type: 'container',
          id: parentId,
          element: childrenContainer,
          parentId,
        };
      }
      return {
        type: 'container',
        id: target.dataset.id || this.paletteState.id,
        element: target,
        parentId: target.dataset.id || this.paletteState.id,
      };
    }

    return null;
  }

  _computePaletteDropPlacement(context, event) {
    if (!context) return null;
    const paletteRect = this.paletteEl.getBoundingClientRect();

    if (context.type === 'node') {
      const elementRect = context.element.getBoundingClientRect();
      const before = event.clientY < elementRect.top + elementRect.height / 2;
      const parentDirectory = this._findDirectoryById(context.parentId) || this.paletteState;
      const siblings = parentDirectory.children || [];
      const currentIndex = siblings.findIndex((child) => child.id === context.id);
      const baseIndex = currentIndex === -1 ? siblings.length : currentIndex;
      const insertionIndex = before ? baseIndex : baseIndex + 1;
      return {
        parentId: context.parentId,
        index: insertionIndex,
        indicator: {
          left: elementRect.left - paletteRect.left,
          top: elementRect.top - paletteRect.top + (before ? 0 : elementRect.height),
          width: elementRect.width,
        },
      };
    }

    if (context.type === 'directory-header') {
      const directoryId = context.id;
      const directory = this._findDirectoryById(directoryId);
      if (!directory) {
        return null;
      }
      const headerRect = context.element.getBoundingClientRect();
      const directoryEl = context.element.closest('[data-id]');
      const childrenContainer = directoryEl?.querySelector(':scope > .palette-children');
      const childElements = childrenContainer
        ? Array.from(childrenContainer.children).filter((child) =>
            child.matches('.palette-directory, .palette-node')
          )
        : [];
      let indicatorLeft = headerRect.left - paletteRect.left;
      let indicatorTop = headerRect.bottom - paletteRect.top;
      let indicatorWidth = headerRect.width;
      if (childElements.length) {
        const lastRect = childElements[childElements.length - 1].getBoundingClientRect();
        if (lastRect.height > 0 && lastRect.width > 0) {
          indicatorLeft = lastRect.left - paletteRect.left;
          indicatorTop = lastRect.bottom - paletteRect.top;
          indicatorWidth = lastRect.width;
        }
      }
      return {
        parentId: directoryId,
        index: (directory.children || []).length,
        indicator: {
          left: indicatorLeft,
          top: indicatorTop,
          width: indicatorWidth,
        },
      };
    }

    if (context.type === 'container') {
      const containerEl = context.element;
      const parentId = context.parentId || context.id;
      const directory = this._findDirectoryById(parentId);
      if (!directory) {
        return null;
      }
      const containerRect = containerEl.getBoundingClientRect();
      const children = Array.from(containerEl.children).filter((child) =>
        child.matches('.palette-directory, .palette-node')
      );
      if (!children.length) {
        return {
          parentId,
          index: 0,
          indicator: {
            left: containerRect.left - paletteRect.left,
            top: containerRect.top - paletteRect.top,
            width: containerRect.width,
          },
        };
      }
      const cursorY = event.clientY;
      for (let index = 0; index < children.length; index += 1) {
        const childRect = children[index].getBoundingClientRect();
        if (cursorY < childRect.top + childRect.height / 2) {
          return {
            parentId,
            index,
            indicator: {
              left: childRect.left - paletteRect.left,
              top: childRect.top - paletteRect.top,
              width: childRect.width,
            },
          };
        }
      }
      const lastRect = children[children.length - 1].getBoundingClientRect();
      return {
        parentId,
        index: children.length,
        indicator: {
          left: lastRect.left - paletteRect.left,
          top: lastRect.bottom - paletteRect.top,
          width: lastRect.width,
        },
      };
    }

    return null;
  }

  _showPaletteDropIndicator(placement) {
    if (!placement || !placement.indicator) {
      this._hidePaletteDropIndicator();
      return;
    }
    const indicator = this._ensurePaletteIndicator();
    indicator.classList.remove('hidden');
    indicator.style.left = `${placement.indicator.left}px`;
    indicator.style.top = `${placement.indicator.top}px`;
    indicator.style.width = `${placement.indicator.width}px`;
  }

  _onPaletteDragOver(event) {
    if (!this.paletteDragState) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const context = this._resolvePaletteDropContext(event);
    if (!context) {
      this.paletteDragState.dropTarget = null;
      this._hidePaletteDropIndicator();
      return;
    }
    const placement = this._computePaletteDropPlacement(context, event);
    if (!placement) {
      this.paletteDragState.dropTarget = null;
      this._hidePaletteDropIndicator();
      return;
    }
    this._showPaletteDropIndicator(placement);
    this.paletteDragState.dropTarget = {
      parentId: placement.parentId,
      index: placement.index,
    };
  }

  _onPaletteDrop(event) {
    if (!this.paletteDragState) return;
    event.preventDefault();
    let dropTarget = this.paletteDragState.dropTarget;
    if (!dropTarget) {
      const context = this._resolvePaletteDropContext(event);
      const placement = context ? this._computePaletteDropPlacement(context, event) : null;
      if (placement) {
        dropTarget = { parentId: placement.parentId, index: placement.index };
      }
    }
    if (!dropTarget) {
      this._resetPaletteDrag();
      return;
    }
    const { itemId } = this.paletteDragState;
    const moved = this._movePaletteItem(itemId, dropTarget);
    if (moved) {
      this._savePaletteState();
      this._renderPalette();
    }
    this._resetPaletteDrag();
  }

  _movePaletteItem(itemId, dropTarget) {
    if (!itemId || !dropTarget) return false;
    const { parentId, index } = dropTarget;
    if (!parentId || typeof index !== 'number' || index < 0) return false;
    const item = this._findPaletteItem(itemId);
    if (!item) return false;
    const targetDir = this._findDirectoryById(parentId);
    if (!targetDir) return false;
    if (item.type === 'directory') {
      if (itemId === parentId) return false;
      if (this._isDescendant(itemId, parentId)) {
        return false;
      }
    }

    const originParent = this._findParentOf(itemId) || this.paletteState;
    if (!originParent) return false;

    const originIndex = (originParent.children || []).findIndex((child) => child.id === itemId);
    if (originIndex === -1) return false;
    const [removed] = originParent.children.splice(originIndex, 1);

    targetDir.children = targetDir.children || [];
    let insertIndex = Math.min(Math.max(index, 0), targetDir.children.length);
    if (originParent === targetDir && originIndex < insertIndex) {
      insertIndex -= 1;
    }
    targetDir.children.splice(insertIndex, 0, removed);
    return true;
  }

  async _duplicatePaletteNode({ paletteItemId, definitionId, parentId, insertIndex }) {
    if (!definitionId || !this.onDuplicatePaletteNode) {
      return;
    }
    try {
      const previousIds = new Set(this.library.map((def) => def.id));
      const previousPaletteNodeIds = new Set();
      const collectPaletteNodeIds = (directory) => {
        if (!directory || directory.type !== 'directory') return;
        (directory.children || []).forEach((child) => {
          if (child.type === 'node') {
            previousPaletteNodeIds.add(child.nodeId);
          } else if (child.type === 'directory') {
            collectPaletteNodeIds(child);
          }
        });
      };
      collectPaletteNodeIds(this.paletteState);
      const locateNewPaletteNode = () => {
        const stack = [this.paletteState];
        while (stack.length) {
          const directory = stack.shift();
          if (!directory || directory.type !== 'directory') {
            continue;
          }
          const candidate = (directory.children || []).find(
            (child) => child.type === 'node' && !previousPaletteNodeIds.has(child.nodeId)
          );
          if (candidate) {
            return { item: candidate, parent: directory };
          }
          (directory.children || []).forEach((child) => {
            if (child.type === 'directory') {
              stack.push(child);
            }
          });
        }
        return null;
      };
      const result = this.onDuplicatePaletteNode({
        definitionId,
        paletteItemId,
        parentId,
        insertIndex,
      });
      const resolved = result instanceof Promise ? await result : result;
      if (!resolved) {
        return;
      }
      let newDefinitionId = null;
      let providedDefinition = null;
      if (typeof resolved === 'string') {
        newDefinitionId = resolved;
      } else if (typeof resolved === 'object') {
        if (resolved.definition && resolved.definition.id) {
          providedDefinition = resolved.definition;
        }
        newDefinitionId =
          resolved.newId ||
          resolved.id ||
          resolved.definitionId ||
          providedDefinition?.id ||
          null;
      }
      if (!newDefinitionId) {
        const diff = this.library.filter((definition) => !previousIds.has(definition.id));
        if (diff.length === 1) {
          newDefinitionId = diff[0].id;
          providedDefinition = diff[0];
        }
      }

      if (!newDefinitionId) {
        return;
      }

      if (previousIds.has(newDefinitionId)) {
        const diff = this.library.filter((definition) => !previousIds.has(definition.id));
        if (diff.length === 1) {
          newDefinitionId = diff[0].id;
          providedDefinition = providedDefinition || diff[0];
        } else {
          const candidate = diff.find((definition) => definition.id !== definitionId);
          if (candidate) {
            newDefinitionId = candidate.id;
            providedDefinition = providedDefinition || candidate;
          }
        }
      }

      if (!providedDefinition) {
        providedDefinition = this.library.find((definition) => definition.id === newDefinitionId);
      }

      if (!providedDefinition) {
        const diff = this.library.filter((definition) => !previousIds.has(definition.id));
        if (diff.length === 1) {
          providedDefinition = diff[0];
          newDefinitionId = diff[0].id;
        }
      }

      if (providedDefinition && providedDefinition.id !== newDefinitionId) {
        newDefinitionId = providedDefinition.id;
      }

      if (providedDefinition && providedDefinition.id === newDefinitionId) {
        const existingIndex = this.library.findIndex((def) => def.id === newDefinitionId);
        if (existingIndex === -1) {
          this.library = [...this.library, providedDefinition];
        } else {
          const updated = [...this.library];
          updated[existingIndex] = providedDefinition;
          this.library = updated;
        }
      }

      this._ensurePaletteIntegrity();

      const newPaletteNode = locateNewPaletteNode();
      if (newPaletteNode?.item) {
        newDefinitionId = newPaletteNode.item.nodeId;
        if (!providedDefinition) {
          providedDefinition = this.library.find((definition) => definition.id === newDefinitionId);
        }
        const destinationParent = this._findDirectoryById(parentId) || this.paletteState;
        const sourceParent = newPaletteNode.parent || destinationParent;
        if (sourceParent && Array.isArray(sourceParent.children)) {
          const currentIndex = sourceParent.children.findIndex((child) => child.id === newPaletteNode.item.id);
          let extracted = newPaletteNode.item;
          if (currentIndex !== -1) {
            [extracted] = sourceParent.children.splice(currentIndex, 1);
          }
          if (!destinationParent.children) {
            destinationParent.children = [];
          }
          let insertionIndexValue =
            typeof insertIndex === 'number' && insertIndex >= 0
              ? Math.min(insertIndex + 1, destinationParent.children.length)
              : destinationParent.children.length;
          if (sourceParent === destinationParent && typeof insertIndex === 'number' && currentIndex !== -1) {
            if (currentIndex < insertionIndexValue) {
              insertionIndexValue = Math.max(0, insertionIndexValue - 1);
            }
          }
          insertionIndexValue = Math.max(0, Math.min(insertionIndexValue, destinationParent.children.length));
          destinationParent.children.splice(insertionIndexValue, 0, extracted);
          this._savePaletteState();
          this._renderPalette();
          return;
        }
      }

      const parent = this._findDirectoryById(parentId) || this.paletteState;
      if (!parent) {
        return;
      }
      parent.children = parent.children || [];
      const insertionIndex =
        typeof insertIndex === 'number' && insertIndex >= 0
          ? Math.min(insertIndex + 1, parent.children.length)
          : parent.children.length;
      const existingIndex = parent.children.findIndex(
        (child) => child.type === 'node' && child.nodeId === newDefinitionId
      );
      if (existingIndex !== -1) {
        const [existing] = parent.children.splice(existingIndex, 1);
        let targetIndex = insertionIndex;
        if (existingIndex < insertionIndex) {
          targetIndex = insertionIndex - 1;
        }
        targetIndex = Math.max(0, Math.min(targetIndex, parent.children.length));
        parent.children.splice(targetIndex, 0, existing);
      } else {
        parent.children.splice(insertionIndex, 0, this._createNodeItem(newDefinitionId));
      }
      this._savePaletteState();
      this._renderPalette();
    } catch (error) {
      console.error('Failed to duplicate palette node', error);
    }
  }

  async _removePaletteNode({ paletteItemId, definitionId }) {
    if (!paletteItemId) {
      return;
    }
    try {
      if (!this.onRemovePaletteNode) {
        return this._confirmAndRemovePaletteItem(paletteItemId, { type: 'node' });
      }
      const result = this.onRemovePaletteNode({
        paletteItemId,
        definitionId,
      });
      const resolved = result instanceof Promise ? await result : result;
      if (resolved === false || resolved?.cancelled || resolved?.success === false) {
        return;
      }
      if (this._removePaletteItem(paletteItemId) && definitionId) {
        const index = this.library.findIndex((def) => def.id === definitionId);
        if (index !== -1) {
          const next = [...this.library];
          next.splice(index, 1);
          this.library = next;
        }
      }
    } catch (error) {
      console.error('Failed to remove palette node', error);
    }
  }

  _toggleDirectoryCollapse(directoryId) {
    const directory = this._findDirectoryById(directoryId);
    if (!directory) return;
    const collapsed = Boolean(directory.meta?.collapsed);
    directory.meta = {
      ...(directory.meta || {}),
      collapsed: !collapsed,
    };
    this._savePaletteState();
    this._renderPalette();
  }

  _resetPaletteDrag() {
    this.paletteDragState = null;
    this._hidePaletteDropIndicator();
  }

  _hidePaletteDropIndicator() {
    if (this.paletteDropIndicator) {
      this.paletteDropIndicator.classList.add('hidden');
    }
  }

  _handlePaletteContextMenu(event) {
    if (!this.paletteEl.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();

    const nodeButton = event.target.closest('.palette-node');
    if (nodeButton) {
      const paletteItemId = nodeButton.dataset.id;
      const definitionId = nodeButton.dataset.nodeId;
      if (!paletteItemId || !definitionId) {
        this._hidePaletteContextMenu();
        return;
      }

      const parentContainer = nodeButton.closest('.palette-children');
      const parentId = parentContainer?.dataset.parentId || this.paletteState.id;
      const parentDirectory = this._findDirectoryById(parentId) || this.paletteState;
      const insertIndex = (parentDirectory.children || []).findIndex(
        (child) => child.id === paletteItemId
      );

      const options = [
        {
          label: 'ノードを複製',
          action: () =>
            this._duplicatePaletteNode({
              paletteItemId,
              definitionId,
              parentId,
              insertIndex,
            }),
        },
        {
          label: 'ノードを削除',
          action: () =>
            this._removePaletteNode({
              paletteItemId,
              definitionId,
            }),
          variant: 'danger',
        },
      ];

      this._showPaletteContextMenu({
        x: event.clientX,
        y: event.clientY,
        options,
      });
      return;
    }

    const dropIndicator = event.target.closest('.palette-drop-indicator');
    if (dropIndicator) {
      this._hidePaletteContextMenu();
      return;
    }

    const directoryHeader = event.target.closest('.palette-directory-header');
    if (directoryHeader?.dataset?.id) {
      const directoryId = directoryHeader.dataset.id;
      const options = [
        {
          label: 'ディレクトリを作成',
          action: () => this._promptCreateDirectory(directoryId),
        },
        {
          label: 'ディレクトリを削除',
          action: () => this._confirmAndRemovePaletteItem(directoryId, { type: 'directory' }),
          variant: 'danger',
        },
      ];

      this._showPaletteContextMenu({
        x: event.clientX,
        y: event.clientY,
        options,
      });
      return;
    }

    const container = event.target.closest('.palette-children');
    const directoryElement = event.target.closest('.palette-directory');
    let parentId = container?.dataset.parentId || directoryElement?.dataset.id || null;
    if (!parentId) {
      const rootElement = event.target.closest('.palette-root');
      parentId = rootElement?.dataset?.id || this.paletteState.id;
    }
    if (!parentId) {
      parentId = this.paletteState.id;
    }

    const options = [
      {
        label: 'ディレクトリを作成',
        action: () => this._promptCreateDirectory(parentId),
      },
    ];

    this._showPaletteContextMenu({
      x: event.clientX,
      y: event.clientY,
      options,
    });
  }

  _promptCreateDirectory(parentId) {
    const name = prompt('新しいディレクトリ名を入力してください');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    this._createDirectory(parentId, trimmed);
  }

  async _confirmAndRemovePaletteItem(itemId, { type } = {}) {
    if (!itemId) return false;
    if (type === 'directory') {
      const ok = confirm('このディレクトリとすべての子要素を削除しますか？');
      if (!ok) return false;
      return this._removePaletteDirectory(itemId);
    }
    if (type === 'node') {
      const ok = confirm('このノードをパレットから削除しますか？');
      if (!ok) return false;
    }
    return this._removePaletteItem(itemId);
  }

  _removePaletteItem(itemId) {
    if (!itemId || itemId === this.paletteState.id) return false;
    const parent = this._findParentOf(itemId);
    if (!parent || !Array.isArray(parent.children)) return false;
    const index = parent.children.findIndex((child) => child.id === itemId);
    if (index === -1) return false;
    parent.children.splice(index, 1);
    this._savePaletteState();
    this._renderPalette();
    return true;
  }

  _collectDirectoryNodes(directory, accumulator = []) {
    if (!directory) {
      return accumulator;
    }
    const children = Array.isArray(directory.children) ? directory.children : [];
    children.forEach((child) => {
      if (!child) return;
      if (child.type === 'node' && child.nodeId) {
        accumulator.push({
          paletteItemId: child.id,
          definitionId: child.nodeId,
        });
        return;
      }
      if (child.type === 'directory') {
        this._collectDirectoryNodes(child, accumulator);
      }
    });
    return accumulator;
  }

  async _removePaletteDirectory(directoryId) {
    if (!directoryId || directoryId === this.paletteState.id) {
      return false;
    }
    const directory = this._findPaletteItem(directoryId);
    if (!directory || directory.type !== 'directory') {
      return false;
    }

    const nodes = this._collectDirectoryNodes(directory, []);
    const seenDefinitionIds = new Set();
    const definitionIds = [];
    nodes.forEach((node) => {
      if (!node || !node.definitionId || seenDefinitionIds.has(node.definitionId)) {
        return;
      }
      seenDefinitionIds.add(node.definitionId);
      definitionIds.push(node.definitionId);
    });
    let removedDefinitionIds = new Set(definitionIds);

    if (this.onRemovePaletteNode && definitionIds.length) {
      try {
        const result = this.onRemovePaletteNode({
          directoryId,
          definitionIds,
          skipConfirm: true,
        });
        const resolved = result instanceof Promise ? await result : result;
        if (resolved === false || resolved?.cancelled || resolved?.success === false) {
          return false;
        }
        if (Array.isArray(resolved?.removedIds)) {
          removedDefinitionIds = new Set(resolved.removedIds.filter(Boolean));
        }
      } catch (error) {
        console.error('Failed to remove palette directory', error);
        return false;
      }
    }

    const removed = this._removePaletteItem(directoryId);
    if (!removed) {
      return false;
    }

    if (removedDefinitionIds.size) {
      const remaining = this.library.filter((definition) => !removedDefinitionIds.has(definition.id));
      if (remaining.length !== this.library.length) {
        this.setLibrary(remaining);
      }
    }
    return true;
  }

  _setupPaletteContextMenu() {
    if (this.paletteMenu) return;
    const menu = document.createElement('div');
    menu.className = 'palette-context-menu hidden';
    menu.addEventListener('contextmenu', (event) => event.preventDefault());
    menu.addEventListener('pointerdown', (event) => event.stopPropagation());
    document.body.appendChild(menu);
    this.paletteMenu = menu;
    this._paletteMenuOutsideHandler = (event) => {
      if (!this.paletteMenu) return;
      if (!event.target.closest('.palette-context-menu')) {
        this._hidePaletteContextMenu();
      }
    };
    document.addEventListener('pointerdown', this._paletteMenuOutsideHandler);
  }

  _showPaletteContextMenu({ x, y, options }) {
    if (!this.paletteMenu) return;
    if (!options || !options.length) {
      this._hidePaletteContextMenu();
      return;
    }

    this.paletteMenu.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'palette-context-options';

    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.label;
      if (option.variant === 'danger') {
        button.classList.add('danger');
      }
      button.addEventListener('click', () => {
        option.action?.();
        this._hidePaletteContextMenu();
      });
      list.appendChild(button);
    });

    this.paletteMenu.appendChild(list);
    this.paletteMenu.classList.remove('hidden');
    this.paletteMenu.style.left = `${x}px`;
    this.paletteMenu.style.top = `${y}px`;

    requestAnimationFrame(() => {
      if (!this.paletteMenu) return;
      const rect = this.paletteMenu.getBoundingClientRect();
      const margin = 6;
      let posX = Math.min(x, window.innerWidth - rect.width - margin);
      let posY = Math.min(y, window.innerHeight - rect.height - margin);
      posX = Math.max(margin, posX);
      posY = Math.max(margin, posY);
      this.paletteMenu.style.left = `${posX}px`;
      this.paletteMenu.style.top = `${posY}px`;
    });
  }

  _hidePaletteContextMenu() {
    if (!this.paletteMenu) return;
    this.paletteMenu.classList.add('hidden');
  }

  _startSelection(event, { additive = false } = {}) {
    if (event.button !== 0) {
      return;
    }
    const rect = this.nodeLayer.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    this.selectionState = {
      pointerId: event.pointerId,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
      additive,
    };
    if (!additive) {
      this._clearNodeSelection();
    }
    this._clearPreviewSelection();
    if (this.selectionOverlay) {
      this.selectionOverlay.remove();
    }
    this.selectionOverlay = document.createElement('div');
    this.selectionOverlay.className = 'selection-rect';
    this.nodeLayer.appendChild(this.selectionOverlay);
    this._updateSelectionOverlay();
    if (this.nodeLayer.setPointerCapture) {
      try {
        this.nodeLayer.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore pointer capture errors
      }
    }
  }

  _updateSelection(event) {
    if (!this.selectionState) return;
    if (this.selectionState.pointerId && event.pointerId && event.pointerId !== this.selectionState.pointerId) {
      return;
    }
    const rect = this.nodeLayer.getBoundingClientRect();
    this.selectionState.currentX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    this.selectionState.currentY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    this._updateSelectionOverlay();
    this._previewSelection();
  }

  _endSelection(event) {
    if (!this.selectionState) return;
    if (this.selectionState.pointerId && event.pointerId && event.pointerId !== this.selectionState.pointerId) {
      return;
    }
    const state = this.selectionState;
    this.selectionState = null;
    if (this.nodeLayer.releasePointerCapture) {
      try {
        this.nodeLayer.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Ignore release errors
      }
    }
    if (this.selectionOverlay) {
      this.selectionOverlay.remove();
      this.selectionOverlay = null;
    }
    const added = this._finalizeSelection(state);
    this._clearPreviewSelection();
    if (added.length || !state.additive) {
      this._applySelectionStyles();
    }
  }

  _updateSelectionOverlay() {
    if (!this.selectionOverlay || !this.selectionState) return;
    const { startX, startY, currentX, currentY } = this.selectionState;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    this.selectionOverlay.style.left = `${left}px`;
    this.selectionOverlay.style.top = `${top}px`;
    this.selectionOverlay.style.width = `${width}px`;
    this.selectionOverlay.style.height = `${height}px`;
  }

  _previewSelection() {
    if (!this.selectionState) return;
    const ids = this._collectNodesInSelection(this.selectionState);
    const idSet = new Set(ids);
    this.nodeLayer.querySelectorAll('.node').forEach((nodeEl) => {
      nodeEl.classList.toggle('selecting', idSet.has(nodeEl.dataset.id));
    });
  }

  _clearPreviewSelection() {
    this.nodeLayer.querySelectorAll('.node.selecting').forEach((nodeEl) =>
      nodeEl.classList.remove('selecting')
    );
  }

  _collectNodesInSelection(state) {
    if (!state) return [];
    const { startX, startY, currentX, currentY } = state;
    const x1 = Math.min(startX, currentX);
    const x2 = Math.max(startX, currentX);
    const y1 = Math.min(startY, currentY);
    const y2 = Math.max(startY, currentY);
    const layerRect = this.nodeLayer.getBoundingClientRect();
    const selected = [];
    this.nodeLayer.querySelectorAll('.node').forEach((nodeEl) => {
      const rect = nodeEl.getBoundingClientRect();
      const left = rect.left - layerRect.left;
      const top = rect.top - layerRect.top;
      const right = left + rect.width;
      const bottom = top + rect.height;
      const intersects = right >= x1 && left <= x2 && bottom >= y1 && top <= y2;
      if (intersects) {
        selected.push(nodeEl.dataset.id);
      }
    });
    return selected;
  }

  _finalizeSelection(state) {
    const ids = this._collectNodesInSelection(state);
    if (!state.additive) {
      this.selectedNodes.clear();
    }
    ids.forEach((id) => {
      if (id) {
        this.selectedNodes.add(id);
      }
    });
    return ids;
  }

  _applySelectionStyles() {
    this.nodeLayer.querySelectorAll('.node').forEach((nodeEl) => {
      nodeEl.classList.toggle('selected', this.selectedNodes.has(nodeEl.dataset.id));
    });
  }

  _createNode(definition, position) {
    const nodeId = `${definition.id}_${++this.nodeCount}`;
    const node = new Node(definition, nodeId, position);
    this.nodes.set(nodeId, node);
    this._renderNode(node);
    this._drawConnections();
    this._selectNode(nodeId, { additive: false });
    this._markDirty();
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

    const deleteBtn = el.querySelector('.node-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this._removeNode(node.id);
      });
    }

    const designerBtn = el.querySelector('.node-open-designer');
    if (designerBtn) {
      if (this.onEditCustomNode && node.definition.specId) {
        designerBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          this.onEditCustomNode?.(node.definition.specId, node.definition.sourceSpec);
        });
      } else {
        designerBtn.remove();
      }
    }

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
      const withCtrl = event.ctrlKey || event.metaKey;
      const additive = withCtrl || event.shiftKey;
      let remainedSelected = true;
      if (!(this.selectedNodes.has(node.id) && this.selectedNodes.size > 1 && !additive)) {
        remainedSelected = this._selectNode(node.id, { additive, toggle: withCtrl });
      }
      if (additive) {
        if (!remainedSelected) {
          return;
        }
        return;
      }
      this._startDrag(event, node.id);
    });
    el.addEventListener('focus', () => this._selectNode(node.id, { additive: false, toggle: false }));

    this.nodeLayer.appendChild(el);
  }

  _redrawNodes() {
    this.nodeLayer.querySelectorAll('.node').forEach((nodeEl) => nodeEl.remove());
    this.nodes.forEach((node) => {
      this._renderNode(node);
    });
    const existingIds = new Set(this.nodes.keys());
    Array.from(this.selectedNodes).forEach((id) => {
      if (!existingIds.has(id)) {
        this.selectedNodes.delete(id);
      }
    });
    this._applySelectionStyles();
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
    if (
      event.target.closest('.handle') ||
      event.target.classList.contains('node-config') ||
      event.target.classList.contains('node-delete') ||
      event.target.closest('.node-open-designer')
    ) {
      return;
    }
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.draggedNode = node;
    const targetEl = event.currentTarget;
    const pointerId = event.pointerId;
    const parentRect = this.nodeLayer.getBoundingClientRect();
    this.dragOriginParentRect = parentRect;
    this.dragStartClient = { x: event.clientX, y: event.clientY };
    const ids = this.selectedNodes.size ? Array.from(this.selectedNodes) : [nodeId];
    this.draggingGroup = ids
      .map((id) => {
        const item = this.nodes.get(id);
        if (!item) return null;
        const el = this.nodeLayer.querySelector(`.node[data-id="${id}"]`);
        const width = el?.offsetWidth ?? 200;
        const height = el?.offsetHeight ?? 120;
        return {
          node: item,
          element: el,
          width,
          height,
          start: { ...item.position },
        };
      })
      .filter(Boolean);
    this.dragMoved = false;
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
  }

  _dragNode(event) {
    if (!this.draggingGroup || !this.draggingGroup.length) return;
    const parentRect = this.dragOriginParentRect || this.nodeLayer.getBoundingClientRect();
    const deltaX = event.clientX - this.dragStartClient.x;
    const deltaY = event.clientY - this.dragStartClient.y;
    this.dragMoved = true;
    this.draggingGroup.forEach((item) => {
      let x = item.start.x + deltaX;
      let y = item.start.y + deltaY;
      const maxX = Math.max(0, parentRect.width - item.width);
      const maxY = Math.max(0, parentRect.height - item.height);
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));
      item.node.position = { x, y };
      if (item.element) {
        item.element.style.transform = `translate(${x}px, ${y}px)`;
      }
    });
    this._drawConnections();
  }

  _endDrag() {
    if (this.draggingGroup && this.dragMoved) {
      this._markDirty();
    }
    this.draggedNode = null;
    this.draggingGroup = null;
    this.dragOriginParentRect = null;
    this.dragStartClient = null;
    this.dragMoved = false;
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
    this._markDirty();
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
    this._markDirty();
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
          this.onEditCustomNode?.(node.definition.specId, node.definition.sourceSpec);
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
      this._markDirty();
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
    try {
      const result = this.persistence.save(graph);
      if (result && typeof result.then === 'function') {
        result
          .then((success) => {
            if (success !== false) {
              this._clearDirty();
            }
          })
          .catch((error) => console.warn('Failed to save graph', error));
      } else if (result !== false) {
        this._clearDirty();
      }
    } catch (error) {
      console.error('Failed to invoke persistence.save', error);
    }
  }

  restoreGraph() {
    if (!this.persistence?.load) return;
    const result = this.persistence.load();
    if (result && typeof result.then === 'function') {
      result.then((data) => this._applyPersistedGraph(data));
    } else {
      this._applyPersistedGraph(result);
    }
  }

  _applyPersistedGraph(data) {
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
    this._clearDirty();
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
    this.selectedNodes.clear();
    this._applySelectionStyles();
    this.selectedConnection = null;
    this.connectionPaths = [];
    this._hidePortContextMenu();
    if (clearStorage) {
      this._markDirty();
    } else {
      this._clearDirty();
    }
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
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        this._clearConnectionSelection({ redraw: false });
        if (!additive) {
          this._clearNodeSelection();
        }
        this._startSelection(event, { additive });
      } else {
        this._clearConnectionSelection({ redraw: false });
      }
      this.activeConnection = null;
      this._drawConnections();
    });

    this.nodeLayer.addEventListener('pointermove', (event) => {
      this._updateSelection(event);
    });

    window.addEventListener('pointerup', (event) => {
      this._endSelection(event);
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
        } else if (this.selectedNodes.size) {
          this._removeNodes(Array.from(this.selectedNodes));
        }
      }
    });
  }

  _selectNode(nodeId, { additive = false, toggle = true } = {}) {
    if (!nodeId) return false;
    this._clearConnectionSelection({ redraw: false });
    let isSelected = true;
    if (additive) {
      if (toggle && this.selectedNodes.has(nodeId)) {
        this.selectedNodes.delete(nodeId);
        isSelected = false;
      } else {
        this.selectedNodes.add(nodeId);
      }
    } else {
      this.selectedNodes.clear();
      this.selectedNodes.add(nodeId);
    }
    this._applySelectionStyles();
    return isSelected;
  }

  _clearSelection() {
    this._clearNodeSelection();
    this._clearConnectionSelection();
  }

  _clearNodeSelection() {
    if (!this.selectedNodes.size) return;
    this.selectedNodes.clear();
    this._applySelectionStyles();
  }

  _removeNodes(nodeIds) {
    nodeIds.forEach((nodeId) => this._removeNode(nodeId, { markDirty: false }));
    this._markDirty();
  }

  _removeNode(nodeId, { markDirty = true } = {}) {
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
    if (this.selectedNodes.has(nodeId)) {
      this.selectedNodes.delete(nodeId);
      this._applySelectionStyles();
    }
    this._hidePortContextMenu();
    if (markDirty) {
      this._markDirty();
    }
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
