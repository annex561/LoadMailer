#!/usr/bin/env node
// Regenerate server/upload-page-client-source.ts from server/upload-page.client.js.
//
// Why: Railway's esbuild bundle ships dist/index.js but NOT standalone .js
// asset files. To serve the upload page client script in production we
// inline the .js source as a string constant in a TS module, which esbuild
// then bundles into dist/index.js. This script regenerates that TS module
// every time the .js source is edited.
//
// Run: npm run embed-upload-js
// A vitest test (server/__tests__/upload-page-js-parses.test.ts) asserts the
// inlined string is in sync with the .js file, so forgetting to regenerate
// fails CI loudly.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(here, "..", "server", "upload-page.client.js");
const outPath = path.join(here, "..", "server", "upload-page-client-source.ts");

const src = fs.readFileSync(srcPath, "utf8");
const tsContent =
  `// AUTO-GENERATED. Source of truth: server/upload-page.client.js\n` +
  `// Inlined so esbuild on Railway bundles it (the raw .js is not shipped\n` +
  `// to dist/). To update, edit the .js file and run:\n` +
  `//   npm run embed-upload-js\n` +
  `\n` +
  `export const UPLOAD_PAGE_CLIENT_JS: string =\n` +
  `  ${JSON.stringify(src)};\n`;

fs.writeFileSync(outPath, tsContent);
console.log(`Wrote ${outPath} (${src.length} chars from ${path.basename(srcPath)})`);
