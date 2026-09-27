import React, { useState } from 'react';

// Saves the list and shows when it was last synced. The two state updates in
// the promise callback are rendered separately by React 17 (updates outside
// React event handlers are not batched) and together by React 18.
export default function SyncStatus({ sync, onRender }) {
  const [status, setStatus] = useState('idle');
  const [syncedAt, setSyncedAt] = useState(null);

  if (onRender) onRender({ status, syncedAt });

  const handleSync = () => {
    sync().then((time) => {
      setSyncedAt(time);
      setStatus('done');
    });
  };

  return (
    <section aria-label="Sync">
      <button type="button" onClick={handleSync}>
        Sync
      </button>
      <p>{status === 'done' ? `Synced at ${syncedAt}` : 'Not synced yet'}</p>
    </section>
  );
}
