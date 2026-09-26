import { resolveEcosystem, selectKnowledgeBase, parseMajor } from '../dist/lib/ecosystem.js';
import { loadKnowledgeFile, isApplicable } from '../dist/lib/requirements.js';
import { readAnalysis, assertSession } from '../dist/lib/session.js';
import { matchBreakingChanges } from '../dist/lib/risk.js';

const SESSION_ID = "b589f501-b5ce-44ab-9cf7-34016373e636";
const session = assertSession(SESSION_ID);
const analysis = readAnalysis(SESSION_ID);

const { dependency, fromVersion, toVersion } = session.upgrade;
const eco = resolveEcosystem(dependency);
console.log("Ecosystem packages:", eco.packages);
console.log("Ecosystem knowledge:", eco.knowledge);

const fromMajor = parseMajor(fromVersion);
const toMajor = parseMajor(toVersion);
console.log(`fromMajor: ${fromMajor}, toMajor: ${toMajor}`);

const kb = selectKnowledgeBase(eco, fromVersion, toVersion);
console.log("Selected KB:", kb);

if (kb) {
  const rules = loadKnowledgeFile(kb.file);
  console.log("Rules loaded:", rules.length);
  
  const usages = analysis.dependencyUsages;
  for (const rule of rules) {
    const applicable = isApplicable(rule, usages);
    if (applicable) console.log("APPLICABLE:", rule.id, rule.description.substring(0, 60));
    else {
      // Debug why not applicable
      const apiUsages = usages.filter(u => u.kind === "api");
      for (const u of apiUsages) {
        const ids = matchBreakingChanges(u, [rule]);
        if (ids.length > 0) console.log("  HIDDEN MATCH:", rule.id, u.file, u.api, u.module);
      }
    }
  }
}
