import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODULE_ORDER = [
  'src/cards.js',
  'src/evaluator.js',
  'src/archetypes.js',
  'src/engine.js',
  'src/simulator.js',
  'web/app.js',
];

function stripModuleSyntax(code) {
  // Remove single-line and multi-line ES import statements
  let cleaned = code.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  // Remove leading `export ` keyword on declarations
  cleaned = cleaned.replace(/^\s*export\s+(?=(?:const|let|var|function|async\s+function|class)\b)/gm, '');
  return cleaned.trim();
}

const bundledParts = MODULE_ORDER.map((relPath) => {
  const fullPath = path.join(__dirname, relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  return `// === ${relPath} ===\n${stripModuleSyntax(src)}`;
});

const bundledJs = `(function () {\n'use strict';\n\n${bundledParts.join('\n\n')}\n})();`;

// Validate syntax of bundled JavaScript before emitting HTML
try {
  // eslint-disable-next-line no-new-func
  new Function(bundledJs);
} catch (err) {
  console.error('Syntax error in bundled JS:', err);
  process.exit(1);
}

const themeStyles = fs.readFileSync(path.join(__dirname, 'web/standalone-theme.css'), 'utf8');
const styles = `${themeStyles}\n\n${fs.readFileSync(path.join(__dirname, 'web/styles.css'), 'utf8')}`;
const template = fs.readFileSync(path.join(__dirname, 'web/template.html'), 'utf8');

const html = template
  .replace('/* __STYLES__ */', () => styles)
  .replace('/* __SCRIPT__ */', () => bundledJs);

const distDir = path.join(__dirname, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const outFile = path.join(distDir, 'index.html');
fs.writeFileSync(outFile, html, 'utf8');

console.log(`Built standalone Web UI: ${outFile} (${(html.length / 1024).toFixed(1)} KB)`);
