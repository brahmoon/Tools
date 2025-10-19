(function () {
  "use strict";

  const activeTables = new WeakMap();

  const defaultOptions = {
    minWidth: 80,
    maxWidth: Infinity,
    storageKey: null,
    handleClass: "rt-handle",
    dragClass: "rt-dragging",
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function readWidths(key, columnCount) {
    if (!key || !window.localStorage) {
      return null;
    }

    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) {
        return null;
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return null;
      }

      const result = new Array(columnCount).fill(null);
      for (let index = 0; index < columnCount; index += 1) {
        const value = parsed[index];
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          result[index] = value;
        }
      }
      return result;
    } catch (error) {
      console.warn("createResizableTable: unable to read stored widths", error);
      return null;
    }
  }

  function writeWidths(key, widths) {
    if (!key || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(widths));
    } catch (error) {
      console.warn("createResizableTable: unable to persist column widths", error);
    }
  }

  function getHeaders(table) {
    const head = table.tHead;
    if (head && head.rows.length > 0) {
      return Array.from(head.rows[0].cells);
    }
    if (table.rows.length > 0) {
      return Array.from(table.rows[0].cells);
    }
    return [];
  }

  function ensureRelativePosition(element) {
    if (element.style.position === "" || element.style.position === "static") {
      element.dataset.originalPosition = element.style.position;
      element.style.position = "relative";
    }
  }

  function restorePosition(element) {
    if (Object.prototype.hasOwnProperty.call(element.dataset, "originalPosition")) {
      element.style.position = element.dataset.originalPosition;
      delete element.dataset.originalPosition;
    }
  }

  function applyWidth(table, columnIndex, width) {
    const value = `${width}px`;
    Array.from(table.rows).forEach((row) => {
      const cell = row.cells[columnIndex];
      if (!cell) {
        return;
      }
      cell.style.width = value;
      cell.style.minWidth = value;
      cell.style.maxWidth = value;
    });
  }

  function removeExistingHandles(table, className) {
    table.querySelectorAll(`.${className}`).forEach((handle) => {
      const header = handle.parentElement;
      if (header) {
        restorePosition(header);
      }
      handle.remove();
    });
  }

  function createHandleElement(className) {
    const handle = document.createElement("span");
    handle.className = className;
    handle.role = "separator";
    handle.tabIndex = 0;
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize column");
    return handle;
  }

  function createResizableTable(table, options = {}) {
    if (!(table instanceof HTMLTableElement)) {
      throw new TypeError("createResizableTable expects a table element");
    }

    const settings = { ...defaultOptions, ...options };
    table.style.tableLayout = "fixed";

    if (activeTables.has(table)) {
      activeTables.get(table).destroy();
    }

    removeExistingHandles(table, settings.handleClass);

    const headers = getHeaders(table);
    if (headers.length === 0) {
      console.warn("createResizableTable: no header cells found");
      return () => {};
    }

    const state = {
      table,
      headers,
      widths: new Array(headers.length).fill(null),
      drag: null,
      handles: [],
      settings,
      pendingSave: false,
    };

    const storedWidths = readWidths(settings.storageKey, headers.length);

    function persistWidths() {
      if (settings.storageKey) {
        writeWidths(settings.storageKey, state.widths);
      }
    }

    function setWidth(index, width, options = {}) {
      if (typeof width !== "number" || !Number.isFinite(width)) {
        return;
      }

      const behavior = { persist: true, markPending: false, ...options };
      const previous = state.widths[index];

      if (previous === width) {
        return;
      }

      state.widths[index] = width;
      applyWidth(table, index, width);

      if (behavior.persist) {
        persistWidths();
      } else if (behavior.markPending) {
        state.pendingSave = true;
      }
    }

    function endDrag(event) {
      if (!state.drag) {
        return;
      }

      if (event && event.pointerId != null) {
        state.drag.handle.releasePointerCapture(event.pointerId);
      }

      document.body.classList.remove(settings.dragClass);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      if (state.pendingSave) {
        state.pendingSave = false;
        persistWidths();
      }
      state.drag = null;
    }

    function onPointerMove(event) {
      if (!state.drag) {
        return;
      }

      const delta = event.clientX - state.drag.startX;
      const nextWidth = clamp(
        state.drag.startWidth + delta,
        settings.minWidth,
        Number.isFinite(settings.maxWidth) ? settings.maxWidth : Number.MAX_SAFE_INTEGER
      );

      window.requestAnimationFrame(() => {
        setWidth(state.drag.index, nextWidth, { persist: false, markPending: true });
      });
    }

    function beginDrag(event, index, header, handle) {
      event.preventDefault();

      state.drag = {
        index,
        startX: event.clientX,
        startWidth: header.getBoundingClientRect().width,
        handle,
      };

      document.body.classList.add(settings.dragClass);
      if (event.pointerId != null) {
        handle.setPointerCapture(event.pointerId);
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    }

    function getHandleIndex(handle) {
      const value = handle.dataset.columnIndex;
      if (!value) {
        return -1;
      }

      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? -1 : parsed;
    }

    function onHandlePointerDown(event) {
      const handle = event.currentTarget;
      if (!(handle instanceof HTMLElement)) {
        return;
      }

      const index = getHandleIndex(handle);
      if (index < 0) {
        return;
      }

      const header = headers[index];
      if (!header) {
        return;
      }

      beginDrag(event, index, header, handle);
    }

    function onHandleKeyDown(event) {
      const handle = event.currentTarget;
      if (!(handle instanceof HTMLElement)) {
        return;
      }

      const index = getHandleIndex(handle);
      if (index < 0) {
        return;
      }

      const header = headers[index];
      if (!header) {
        return;
      }

      if (!state.widths[index]) {
        state.widths[index] = header.getBoundingClientRect().width;
      }

      const step = event.shiftKey ? 20 : 10;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const next = clamp(state.widths[index] - step, settings.minWidth, settings.maxWidth);
        setWidth(index, next);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = clamp(state.widths[index] + step, settings.minWidth, settings.maxWidth);
        setWidth(index, next);
      }
    }

    headers.forEach((header, index) => {
      ensureRelativePosition(header);

      const handle = createHandleElement(settings.handleClass);
      handle.dataset.columnIndex = String(index);
      handle.addEventListener("pointerdown", onHandlePointerDown);
      handle.addEventListener("keydown", onHandleKeyDown);

      header.appendChild(handle);
      state.handles.push(handle);
    });

    const initialWidths = storedWidths || headers.map((header) => header.getBoundingClientRect().width);
    let sanitized = false;

    initialWidths.forEach((width, index) => {
      if (!width || width <= 0) {
        return;
      }
      const clamped = clamp(width, settings.minWidth, settings.maxWidth);
      if (clamped !== width) {
        sanitized = true;
      }
      setWidth(index, clamped, { persist: false });
    });

    if (sanitized) {
      persistWidths();
    }

    function destroy() {
      endDrag();
      state.handles.forEach((handle) => {
        handle.removeEventListener("pointerdown", onHandlePointerDown);
        handle.removeEventListener("keydown", onHandleKeyDown);
        handle.remove();
      });
      state.handles.length = 0;
      headers.forEach(restorePosition);
      activeTables.delete(table);
    }

    state.destroy = destroy;
    activeTables.set(table, state);

    return destroy;
  }

  window.createResizableTable = createResizableTable;
})();
