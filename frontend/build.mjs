import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Keep the component and dependency notices in the distributed static bundle.
const notices = await Promise.all([
  './src/components/CreateMenu.tsx',
  './node_modules/react/LICENSE',
  './node_modules/react-dom/LICENSE',
  './node_modules/framer-motion/LICENSE.md',
  './node_modules/motion-dom/LICENSE.md',
  './node_modules/motion-utils/LICENSE.md',
  './node_modules/lucide-react/LICENSE',
].map(async (file) => {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  return file.endsWith('.tsx') ? source.slice(0, source.indexOf('*/') + 2) : `/*! ${file}\n${source}\n*/`;
}));

await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/create-menu.tsx'],
  outfile: '../static/js/create-menu.js',
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'inline',
  banner: { js: notices.join('\n') },
});
