import { readAnalysis, assertSession } from '../dist/lib/session.js';
import { buildRequirements } from '../dist/lib/requirements.js';

const SESSION_ID = "b589f501-b5ce-44ab-9cf7-34016373e636";
const session = assertSession(SESSION_ID);
console.log("Session upgrade:", JSON.stringify(session.upgrade));

const analysis = readAnalysis(SESSION_ID);
const usages = analysis.dependencyUsages;
console.log("Total usages:", usages.length);
console.log("API usages:", usages.filter(u => u.kind === "api").length);

const { dependency, fromVersion, toVersion } = session.upgrade;
console.log(`Building requirements: ${dependency} ${fromVersion} → ${toVersion}`);

const reqs = buildRequirements({
  dependency,
  fromVersion,
  toVersion,
  usages,
});

console.log("Breaking changes found:", reqs.breakingChanges.length);
console.log("Warnings:", reqs.warnings);
reqs.breakingChanges.forEach(bc => console.log(" -", bc.id, bc.severity, bc.description));
