import ReactDOM from 'react-dom';

// A tiny external store. Before React 18, notifying several subscribers from a
// WebSocket or timer callback caused one render per subscriber, so updates are
// wrapped in unstable_batchedUpdates.
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      state = next;
      ReactDOM.unstable_batchedUpdates(() => {
        listeners.forEach((listener) => listener(state));
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
