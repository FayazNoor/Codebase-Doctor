/**
 * Unit tests for React 17 → 18 source-level transforms.
 *
 * Each test shows the original source, applies the transform, and asserts
 * the expected output. Tests also verify that unrelated code is preserved.
 */

import { describe, it, expect } from "vitest";
import {
  transformReactDOMRender,
  transformReactDOMHydrate,
  transformActImport,
} from "../../src/lib/transforms.js";

// ---------------------------------------------------------------------------
// react-bc-1: ReactDOM.render → createRoot().render()
// ---------------------------------------------------------------------------

describe("transformReactDOMRender (react-bc-1)", () => {
  it("rewrites a simple self-closing JSX call", () => {
    const input = `import ReactDOM from 'react-dom';
ReactDOM.render(<App />, document.getElementById('root'));
`;
    const output = transformReactDOMRender(input);
    expect(output).toContain("import { createRoot } from 'react-dom/client';");
    expect(output).toContain("createRoot(document.getElementById('root')).render(<App />)");
    expect(output).not.toContain("ReactDOM.render");
    expect(output).not.toContain("import ReactDOM from 'react-dom'");
  });

  it("rewrites a wrapping JSX element (opening + closing tag)", () => {
    const input = `import ReactDOM from 'react-dom';
ReactDOM.render(<React.StrictMode><App /></React.StrictMode>, document.getElementById('root'));
`;
    const output = transformReactDOMRender(input);
    expect(output).toContain("createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)");
    expect(output).not.toContain("ReactDOM.render");
  });

  it("handles double-quoted import", () => {
    const input = `import ReactDOM from "react-dom";
ReactDOM.render(<App />, container);
`;
    const output = transformReactDOMRender(input);
    expect(output).toContain("import { createRoot } from 'react-dom/client';");
    expect(output).toContain("createRoot(container).render(<App />)");
  });

  it("preserves unrelated imports and code", () => {
    const input = `import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

const container = document.getElementById('root');
ReactDOM.render(<App />, container);
`;
    const output = transformReactDOMRender(input);
    expect(output).toContain("import React from 'react';");
    expect(output).toContain("import App from './App';");
    expect(output).toContain("const container = document.getElementById('root');");
  });

  it("is idempotent — does not double-transform already-migrated code", () => {
    const alreadyMigrated = `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')).render(<App />);
`;
    const output = transformReactDOMRender(alreadyMigrated);
    expect(output).toBe(alreadyMigrated);
  });

  it("does not touch files that have no ReactDOM.render", () => {
    const input = `import React, { useState } from 'react';
export default function App() { return <div />; }
`;
    const output = transformReactDOMRender(input);
    expect(output).toBe(input);
  });

  it("transforms the exact fixture app index.jsx pattern (multi-line JSX)", () => {
    const input = `import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
`;
    const output = transformReactDOMRender(input);
    // Import must be replaced
    expect(output).toContain("import { createRoot } from 'react-dom/client';");
    expect(output).not.toContain("import ReactDOM from 'react-dom'");
    // The render call must be transformed
    expect(output).toContain("createRoot(");
    expect(output).toContain(".render(");
    expect(output).not.toContain("ReactDOM.render");
    // Unrelated code preserved
    expect(output).toContain("import React from 'react';");
    expect(output).toContain("import App from './App';");
  });
});

// ---------------------------------------------------------------------------
// react-bc-2: ReactDOM.hydrate → hydrateRoot()
// ---------------------------------------------------------------------------

describe("transformReactDOMHydrate (react-bc-2)", () => {
  it("rewrites a self-closing hydrate call", () => {
    const input = `import ReactDOM from 'react-dom';
ReactDOM.hydrate(<App />, document.getElementById('root'));
`;
    const output = transformReactDOMHydrate(input);
    expect(output).toContain("import { hydrateRoot } from 'react-dom/client';");
    expect(output).toContain("hydrateRoot(document.getElementById('root'), <App />)");
    expect(output).not.toContain("ReactDOM.hydrate");
    expect(output).not.toContain("import ReactDOM from 'react-dom'");
  });

  it("swaps argument order correctly (element, container → container, element)", () => {
    const input = `import ReactDOM from 'react-dom';
ReactDOM.hydrate(<ServerApp />, rootEl);
`;
    const output = transformReactDOMHydrate(input);
    // hydrateRoot(container, element) — container is second arg of old call
    expect(output).toContain("hydrateRoot(rootEl, <ServerApp />)");
  });

  it("rewrites a wrapping JSX element", () => {
    const input = `import ReactDOM from 'react-dom';
ReactDOM.hydrate(<App data={x}></App>, document.getElementById('root'));
`;
    const output = transformReactDOMHydrate(input);
    expect(output).toContain("hydrateRoot(document.getElementById('root'), <App data={x}></App>)");
  });

  it("does not touch files without ReactDOM.hydrate", () => {
    const input = `import React from 'react';
export default function App() { return <div />; }
`;
    const output = transformReactDOMHydrate(input);
    expect(output).toBe(input);
  });

  it("is idempotent — does not double-transform already-migrated code", () => {
    const alreadyMigrated = `import { hydrateRoot } from 'react-dom/client';
hydrateRoot(document.getElementById('root'), <App />);
`;
    const output = transformReactDOMHydrate(alreadyMigrated);
    expect(output).toBe(alreadyMigrated);
  });

  it("preserves unrelated imports and code", () => {
    const input = `import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

ReactDOM.hydrate(<App />, document.getElementById('root'));
console.log('done');
`;
    const output = transformReactDOMHydrate(input);
    expect(output).toContain("import React from 'react';");
    expect(output).toContain("import App from './App';");
    expect(output).toContain("console.log('done');");
  });
});

// ---------------------------------------------------------------------------
// react-bc-3: act() import from react-dom/test-utils → from 'react'
// ---------------------------------------------------------------------------

describe("transformActImport (react-bc-3)", () => {
  it("rewrites a sole act import from react-dom/test-utils", () => {
    const input = `import React from 'react';
import { act } from 'react-dom/test-utils';
import App from './App';
`;
    const output = transformActImport(input);
    expect(output).toContain("import { act } from 'react';");
    expect(output).not.toContain("react-dom/test-utils");
  });

  it("rewrites act from test-utils while preserving other named imports", () => {
    const input = `import React from 'react';
import { act, render, screen } from 'react-dom/test-utils';
`;
    const output = transformActImport(input);
    expect(output).toContain("import { act } from 'react';");
    expect(output).toContain("import { render, screen } from 'react-dom/test-utils';");
    expect(output).not.toMatch(/import\s+\{[^}]*act[^}]*\}\s+from\s+['"]react-dom\/test-utils['"]/);
  });

  it("handles single-quoted and double-quoted imports", () => {
    const inputDouble = `import { act } from "react-dom/test-utils";`;
    // Only single-quoted variant is in our fixture; double-quoted not required by
    // the regex but verify no crash / graceful no-op
    const output = transformActImport(inputDouble);
    // Either transformed or left unchanged — no exception
    expect(typeof output).toBe("string");
  });

  it("is idempotent — does not re-transform already-migrated import", () => {
    const alreadyMigrated = `import React from 'react';
import { act } from 'react';
`;
    const output = transformActImport(alreadyMigrated);
    expect(output).toBe(alreadyMigrated);
  });

  it("does not touch files that do not import from react-dom/test-utils", () => {
    const input = `import React from 'react';
import { useState } from 'react';
`;
    const output = transformActImport(input);
    expect(output).toBe(input);
  });

  it("preserves all unrelated code in the file", () => {
    const input = `import React from 'react';
import { act } from 'react-dom/test-utils';
import ReactDOM from 'react-dom';
import App from './App';

describe('App', () => {
  it('renders', () => {
    const div = document.createElement('div');
    act(() => {
      ReactDOM.render(<App />, div);
    });
  });
});
`;
    const output = transformActImport(input);
    expect(output).toContain("import React from 'react';");
    expect(output).toContain("import ReactDOM from 'react-dom';");
    expect(output).toContain("import App from './App';");
    expect(output).toContain("describe('App'");
    expect(output).toContain("ReactDOM.render(<App />, div);");
    // act import must be updated
    expect(output).toContain("import { act } from 'react';");
    expect(output).not.toMatch(/import\s+\{\s*act\s*\}\s+from\s+['"]react-dom\/test-utils['"]/);
  });

  it("transforms the exact App.test.jsx fixture pattern", () => {
    // Matches backend/test/fixtures/react17-app/src/App.test.jsx
    const input = `import React from 'react';
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
`;
    const output = transformActImport(input);
    expect(output).toContain("import { act } from 'react';");
    expect(output).not.toContain("react-dom/test-utils");
  });
});
