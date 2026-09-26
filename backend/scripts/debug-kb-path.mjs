import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.log("__dirname:", __dirname);
const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");
console.log("KNOWLEDGE_DIR:", KNOWLEDGE_DIR);
console.log("exists:", fs.existsSync(KNOWLEDGE_DIR));
const file = path.join(KNOWLEDGE_DIR, "react-17-to-18.json");
console.log("file:", file);
console.log("file exists:", fs.existsSync(file));
if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, "utf8");
  console.log("content length:", content.length);
  const parsed = JSON.parse(content);
  console.log("parsed rules:", parsed.length);
}
