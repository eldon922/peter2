// ============================================================
// Back-button support for overlays (dialogs, sheets, the mobile chat).
//
// Opening an overlay pushes a history entry; pressing Back then pops it
// and closes the overlay instead of leaving the page. Closing the overlay
// some other way (its X button, a click outside) drops the entry again so
// history doesn't pile up.
// ============================================================

interface Layer {
  id: number;
  onPop: () => void;
}

const stack: Layer[] = [];
let nextId = 1;
// popstates caused by our own history.back() calls, which must not be
// treated as the user pressing Back.
let ignorePops = 0;
let listening = false;

function onPopState() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  stack.pop()?.onPop();
}

export interface HistoryLayer {
  /** Drop the layer without calling `onPop` (the overlay closed itself). */
  remove: () => void;
  /** Close like Back would: pops history, which calls `onPop`. */
  pop: () => void;
}

function isTop(layer: Layer): boolean {
  return (
    stack[stack.length - 1] === layer &&
    window.history.state?.__layer === layer.id
  );
}

export function pushLayer(onPop: () => void): HistoryLayer {
  if (!listening) {
    window.addEventListener('popstate', onPopState);
    listening = true;
  }
  const layer: Layer = { id: nextId++, onPop };
  window.history.pushState({ __layer: layer.id }, '');
  stack.push(layer);

  return {
    remove() {
      const idx = stack.indexOf(layer);
      if (idx === -1) return;
      // Only rewind history if our entry is still the current one — if the
      // page navigated on in the meantime, going back would undo that.
      const rewind = isTop(layer);
      stack.splice(idx, 1);
      if (rewind) {
        ignorePops++;
        window.history.back();
      }
    },
    pop() {
      if (isTop(layer)) {
        window.history.back();
      } else {
        this.remove();
        onPop();
      }
    },
  };
}
