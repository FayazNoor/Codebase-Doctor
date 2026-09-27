import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

test('adds items to the list and ticks them off', () => {
  render(<App />);
  expect(screen.getByText('Nothing on the list yet.')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'Oat milk' } });
  fireEvent.click(screen.getByText('Add'));

  const checkbox = screen.getByRole('checkbox');
  expect(screen.getByText('Oat milk')).toBeTruthy();
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
});
