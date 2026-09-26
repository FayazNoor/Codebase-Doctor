/**
 * Dry-run script: invoke analyze_dependency_usage directly.
 * Usage: node scripts/run-analysis.mjs
 */
import { analyzeDependencyUsage } from "../dist/tools/analyze-dependency-usage.js";

process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

const result = await analyzeDependencyUsage({
  url: "https://github.com/gothinkster/react-redux-realworld-example-app",
  dependency: "react",
  targetVersion: "18",
});

console.log(result);
