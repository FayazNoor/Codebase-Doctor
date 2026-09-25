import React from 'react';
import { act } from 'react-dom/test-utils';
import ReactDOM from 'react-dom';
import App from './App';

describe('App', () => {
  it('renders without crashing', () => {
    const div = document.createElement('div');
    act(() => {
      ReactDOM.render(<App />, div);
    });
  });
});
