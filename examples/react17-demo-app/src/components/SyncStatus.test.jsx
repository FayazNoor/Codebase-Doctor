import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SyncStatus from './SyncStatus';

test('shows the sync time once the save resolves', async () => {
  const renders = [];
  render(<SyncStatus sync={() => Promise.resolve('12:00')} onRender={(state) => renders.push(state)} />);

  fireEvent.click(screen.getByText('Sync'));
  await waitFor(() => expect(screen.getByText('Synced at 12:00')).toBeTruthy());

  // Every state the component rendered, in order.
  expect(renders).toEqual([
    { status: 'idle', syncedAt: null },
    { status: 'idle', syncedAt: '12:00' },
    { status: 'done', syncedAt: '12:00' },
  ]);
});
