/**
 * Dry-run script: invoke load_migration_requirements directly.
 */
import { loadMigrationRequirements } from "../dist/tools/load-migration-requirements.js";

const SESSION_ID = "b589f501-b5ce-44ab-9cf7-34016373e636";

const DOCS_TEXT = `
How to Upgrade to React 18 – React official blog post (March 08, 2022 by Rick Hanlon)

INSTALLING:
npm install react react-dom

UPDATES TO CLIENT RENDERING APIs:
ReactDOM.render is no longer supported in React 18. Use createRoot instead.

// Before
import { render } from 'react-dom';
const container = document.getElementById('app');
render(<App tab="home" />, container);

// After
import { createRoot } from 'react-dom/client';
const container = document.getElementById('app');
const root = createRoot(container);
root.render(<App tab="home" />);

unmountComponentAtNode replaced by root.unmount():
// Before
unmountComponentAtNode(container);
// After
root.unmount();

render callback removed — use useEffect instead:
// Before
render(<App />, container, () => { console.log('rendered'); });
// After
function AppWithCallbackAfterRender() {
  useEffect(() => { console.log('rendered'); });
  return <App tab="home" />;
}
root.render(<AppWithCallbackAfterRender />);

hydrate replaced by hydrateRoot:
// Before
import { hydrate } from 'react-dom';
hydrate(<App tab="home" />, container);
// After
import { hydrateRoot } from 'react-dom/client';
hydrateRoot(container, <App tab="home" />);

UPDATES TO SERVER RENDERING APIs:
- renderToNodeStream: DEPRECATED — use renderToPipeableStream instead
- renderToPipeableStream: NEW (Node environments)
- renderToReadableStream: NEW (edge runtimes like Deno/Cloudflare)
- renderToString: Limited Suspense support (still works)
- renderToStaticMarkup: Limited Suspense support (still works)

UPDATES TO TYPESCRIPT DEFINITIONS:
Update @types/react and @types/react-dom to latest. The children prop must now be declared explicitly:
interface MyButtonProps {
  color: string;
  children?: React.ReactNode;
}

AUTOMATIC BATCHING:
React 18 batches all state updates (setTimeout, promises, native events) automatically.
To opt-out: import { flushSync } from 'react-dom'; flushSync(() => setState(...));

STRICT MODE CHANGES:
React 18 Strict Mode simulates unmounting/remounting every component in development.

TESTING ENVIRONMENT:
Set globalThis.IS_REACT_ACT_ENVIRONMENT = true before running tests.

DEPRECATIONS:
- ReactDOM.render → deprecated (use createRoot)
- ReactDOM.hydrate → deprecated (use hydrateRoot)
- ReactDOM.unmountComponentAtNode → deprecated (use root.unmount())
- ReactDOM.renderSubtreeIntoContainer → deprecated
- ReactDOMServer.renderToNodeStream → deprecated

DROPPED IE SUPPORT.

OTHER BREAKING CHANGES:
- Consistent useEffect timing for discrete user input events
- Stricter hydration errors (mismatches now errors, not warnings)
- Suspense trees always consistent
- Layout Effects with Suspense cleaned up properly
- New JS environment requirements: Promise, Symbol, Object.assign
`;

const result = await loadMigrationRequirements({
  sessionId: SESSION_ID,
  docsText: DOCS_TEXT,
});

console.log(result);
