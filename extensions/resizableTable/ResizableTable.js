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

  function loadStoredWidths(key, columnCount) {
    if (!key || !window.localStorage) {
      return null;
    }

    try {
      const payload = window.localStorage.getItem(key);
      if (!payload) {
        return null;
      }

      const parsed = JSON.parse(payload);
      if (!Array.isArray(parsed)) {
        return null;
      }

      const widths = new Array(columnCount).fill(null);
      for (let i = 0; i < columnCount; i += 1) {
        const width = parsed[i];
        if (typeof width === "number" && Number.isFinite(width) && width > 0) {
          widths[i] = width;
        }
      }

      return widths;
    } catch (error) {
      console.warn("Failed to load stored widths", error);
      return null;
    }
  }

  function storeWidths(key, widths) {
    if (!key || !window.localStorage) {
      return;
    }

    try {
      const serialised = JSON.stringify(widths);
      window.localStorage.setItem(key, serialised);
    } catch (error) {
      console.warn("Failed to persist column widths", error);
    }
  }

  function getHeaderCells(table) {
    const head = table.tHead;
    if (head && head.rows.length > 0) {
      return Array.from(head.rows[0].cells);
    }

    if (table.rows.length > 0) {
      return Array.from(table.rows[0].cells);
    }

    return [];
  }

  function applyWidth(table, columnIndex, width) {
    const pixelWidth = `${width}px`;
    Array.from(table.rows).forEach((row) => {
      const cell = row.cells[columnIndex];
      if (!cell) {
        return;
      }

      cell.style.width = pixelWidth;
      cell.style.minWidth = pixelWidth;
      cell.style.maxWidth = pixelWidth;
    });
  }

  function resetExistingHandles(table, handleClass) {
    table.querySelectorAll(`.${handleClass}`).forEach((handle) => {
      const header = handle.parentElement;
      if (header) {
        header.style.position = header.dataset.originalPosition || "";
        delete header.dataset.originalPosition;
      }
      handle.remove();
    });
  }

  function createHandleElement(options) {
    const handle = document.createElement("span");
    handle.className = options.handleClass;
    handle.role = "separator";
    handle.tabIndex = 0;
    handle.setAttribute("aria-orientation", "vertical");
    return handle;
  }

  function createResizableTable(table, config = {}) {
    if (!(table instanceof HTMLTableElement)) {
      throw new TypeError("Expected a table element.");
    }

    const options = { ...defaultOptions, ...config };
    table.style.tableLayout = "fixed";

    if (activeTables.has(table)) {
      const previousState = activeTables.get(table);
      previousState.destroy();
    }

    resetExistingHandles(table, options.handleClass);

    const headers = getHeaderCells(table);
    const columnCount = headers.length;

    if (columnCount === 0) {
      console.warn("createResizableTable: table has no header cells to attach resizers.");
      return () => {};
    }

    const storedWidths = loadStoredWidths(options.storageKey, columnCount);
    const state = {
      options,
      table,
      headers,
      widths: new Array(columnCount).fill(null),
      drag: null,
      handles: [],
      destroy: () => {},
    };

    function commitWidths() {
      if (options.storageKey) {
        storeWidths(options.storageKey, state.widths);
      }
    }

    function updateWidth(columnIndex, width) {
      state.widths[columnIndex] = width;
      applyWidth(table, columnIndex, width);
      commitWidths();
    }

    function handlePointerMove(event) {
      if (!state.drag) {
        return;
      }

      const deltaX = event.clientX - state.drag.startX;
      const width = clamp(
        state.drag.startWidth + deltaX,
        options.minWidth,
        Number.isFinite(options.maxWidth) ? options.maxWidth : Number.MAX_SAFE_INTEGER
      );

      window.requestAnimationFrame(() => {
        updateWidth(state.drag.index, width);
      });
    }

    function stopDragging(event) {
      if (!state.drag) {
        return;
      }

      if (event && event.pointerId != null) {
        state.drag.handle.releasePointerCapture(event.pointerId);
      }

      document.body.classList.remove(options.dragClass);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      state.drag = null;
    }

    function startDragging(event, index, header, handle) {
      event.preventDefault();
      const startWidth = header.getBoundingClientRect().width;
      state.drag = {
        index,
        startX: event.clientX,
        startWidth,
        header,
        handle,
      };

      document.body.classList.add(options.dragClass);
      if (event.pointerId != null) {
        handle.setPointerCapture(event.pointerId);
      }

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
    }

    headers.forEach((header, index) => {
      if (header.style.position !== "relative") {
        header.dataset.originalPosition = header.style.position;
        header.style.position = "relative";
      }

      const handle = createHandleElement(options);
      const minWidth = options.minWidth;
      handle.addEventListener("pointerdown", (event) => startDragging(event, index, header, handle));

      handle.addEventListener("keydown", (event) => {
        if (!state.widths[index]) {
          state.widths[index] = header.getBoundingClientRect().width;
        }

        const step = event.shiftKey ? 20 : 10;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          const newWidth = clamp(state.widths[index] - step, minWidth, options.maxWidth);
          updateWidth(index, newWidth);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          const newWidth = clamp(state.widths[index] + step, minWidth, options.maxWidth);
          updateWidth(index, newWidth);
        }
      });

      header.appendChild(handle);
      state.handles.push(handle);
    });

    const initialWidths = storedWidths || headers.map((header) => header.getBoundingClientRect().width);
    initialWidths.forEach((width, index) => {
      if (!width || width <= 0) {
        return;
      }
      const clamped = clamp(width, options.minWidth, options.maxWidth);
      state.widths[index] = clamped;
      applyWidth(table, index, clamped);
    });

    state.destroy = () => {
      stopDragging();
      state.handles.forEach((handle) => handle.remove());
      headers.forEach((header) => {
        if (header.dataset.originalPosition !== undefined) {
          header.style.position = header.dataset.originalPosition;
          delete header.dataset.originalPosition;
        }
      });
      state.handles.length = 0;
      activeTables.delete(table);
    };

    activeTables.set(table, state);
    return state.destroy;
  }

  window.createResizableTable = createResizableTable;
})();
