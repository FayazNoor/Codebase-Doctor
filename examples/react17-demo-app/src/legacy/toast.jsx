import React from 'react';
import ReactDOM from 'react-dom';

function Toast({ message }) {
  return (
    <div role="status" className="toast">
      {message}
    </div>
  );
}

// Imperative helper written before the app had a notification area: it mounts
// a separate React tree for each toast and unmounts it after `ms`.
export function showToast(message, ms = 3000) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  ReactDOM.render(<Toast message={message} />, host);
  setTimeout(() => {
    ReactDOM.unmountComponentAtNode(host);
    host.remove();
  }, ms);
}
