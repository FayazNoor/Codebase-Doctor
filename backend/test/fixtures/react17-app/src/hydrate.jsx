import React from 'react';
import ReactDOM from 'react-dom';
import ServerApp from './App';

// React 17: ReactDOM.hydrate is removed in React 18 — see react-bc-2
ReactDOM.hydrate(<ServerApp />, document.getElementById('root'));
