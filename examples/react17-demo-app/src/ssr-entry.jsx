import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

// Entry used when the page is server-rendered: attach to the existing markup.
ReactDOM.hydrate(<App />, document.getElementById('root'));
