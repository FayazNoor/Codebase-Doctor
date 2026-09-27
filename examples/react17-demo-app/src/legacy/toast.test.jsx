import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { showToast } from './toast';

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

test('shows a toast and removes it after the timeout', () => {
  jest.useFakeTimers();
  act(() => {
    showToast('Saved', 1000);
  });
  expect(document.body.textContent).toContain('Saved');

  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(document.body.textContent).not.toContain('Saved');
});

test('toasts can render inside an existing tree', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(<p>host</p>, container);
  });
  expect(container.textContent).toBe('host');
});
