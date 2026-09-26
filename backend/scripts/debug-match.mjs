import { readAnalysis } from '../dist/lib/session.js';
import { matchBreakingChanges } from '../dist/lib/risk.js';

const SESSION_ID = "b589f501-b5ce-44ab-9cf7-34016373e636";
const analysis = readAnalysis(SESSION_ID);
const usages = analysis.dependencyUsages;

const renderRule = { 
  id: "react-bc-1", 
  detect: [{ module: "react-dom", api: "render" }],
  affectedApis: ["ReactDOM.render"],
  affectedFiles: [],
  automatable: true,
  codemods: [],
  severity: "high",
  resolution: "code"
};

const renderUsages = usages.filter(u => u.kind === "api" && u.module === "react-dom");
console.log("react-dom api usages:", renderUsages.length);
if (renderUsages.length > 0) {
  console.log("first:", JSON.stringify(renderUsages[0]));
}

for (const u of usages) {
  if (u.kind === "api") {
    const ids = matchBreakingChanges(u, [renderRule]);
    if (ids.length > 0) {
      console.log("MATCH:", u.file, u.api, u.module, ids);
    }
  }
}
console.log("Total api usages:", usages.filter(u => u.kind === "api").length);
