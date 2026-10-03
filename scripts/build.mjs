import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(root, 'frontend');
const outputDirectory = path.join(root, 'dist');
const stagingDirectory = path.join(root, '.dist-build');

async function requirePath(target, label) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`${label} is missing: ${target}`);
  }
}

await requirePath(path.join(sourceDirectory, 'index.html'), 'Frontend entry point');
await requirePath(path.join(sourceDirectory, 'product.html'), 'Product page entry point');
await requirePath(path.join(sourceDirectory, 'assets'), 'Frontend assets directory');

await fs.rm(stagingDirectory, { recursive: true, force: true });
await fs.cp(sourceDirectory, stagingDirectory, { recursive: true, force: true });
await requirePath(path.join(stagingDirectory, 'index.html'), 'Generated frontend entry point');
await requirePath(path.join(stagingDirectory, 'product.html'), 'Generated product page entry point');
await requirePath(path.join(stagingDirectory, 'assets'), 'Generated frontend assets directory');

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.rename(stagingDirectory, outputDirectory);

console.log(`Frontend built at ${outputDirectory}`);
