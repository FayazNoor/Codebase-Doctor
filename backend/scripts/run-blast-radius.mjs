import { calculateMigrationBlastRadius } from '../dist/tools/calculate-migration-blast-radius.js';

const result = await calculateMigrationBlastRadius({
  sessionId: "b589f501-b5ce-44ab-9cf7-34016373e636",
});

console.log(result);
