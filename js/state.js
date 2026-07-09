// Minimal observable store — single source of truth for cross-module UI
// state (view mode, selection). Subscribers fire only on real changes.

export function createStore(initial) {
  const state = { ...initial };
  const listeners = new Set();
  return {
    get: (key) => state[key],
    set(patch) {
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (state[k] !== v) {
          state[k] = v;
          changed = true;
        }
      }
      if (changed) for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
