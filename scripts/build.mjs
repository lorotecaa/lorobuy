import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStorefrontVideoQuality } from './video-quality.mjs';

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
await requirePath(path.join(sourceDirectory, 'collection-packs.html'), 'Packs collection page entry point');
await requirePath(path.join(sourceDirectory, 'assets'), 'Frontend assets directory');

const checkedVideos = await validateStorefrontVideoQuality(sourceDirectory);
for (const video of checkedVideos) {
  const megabytes = (video.byteSize / (1024 * 1024)).toFixed(1);
  console.log(`Verified streaming video: ${path.relative(sourceDirectory, video.path)} (${video.width}x${video.height}, ${megabytes} MB, fast start)`);
}

await fs.rm(stagingDirectory, { recursive: true, force: true });
await fs.cp(sourceDirectory, stagingDirectory, { recursive: true, force: true });
const ffmpegAssetDirectory = path.join(stagingDirectory, 'assets', 'ffmpeg');
await fs.mkdir(ffmpegAssetDirectory, { recursive: true });
await Promise.all([
  fs.copyFile(path.join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'umd', 'ffmpeg.js'), path.join(ffmpegAssetDirectory, 'ffmpeg.js')),
  fs.copyFile(path.join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'umd', '814.ffmpeg.js'), path.join(ffmpegAssetDirectory, '814.ffmpeg.js')),
  fs.copyFile(path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.js'), path.join(ffmpegAssetDirectory, 'ffmpeg-core.js')),
  fs.copyFile(path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd', 'ffmpeg-core.wasm'), path.join(ffmpegAssetDirectory, 'ffmpeg-core.wasm')),
]);
await requirePath(path.join(stagingDirectory, 'index.html'), 'Generated frontend entry point');
await requirePath(path.join(stagingDirectory, 'product.html'), 'Generated product page entry point');
await requirePath(path.join(stagingDirectory, 'collection-packs.html'), 'Generated packs collection page entry point');
await requirePath(path.join(stagingDirectory, 'assets'), 'Generated frontend assets directory');
await requirePath(path.join(ffmpegAssetDirectory, 'ffmpeg-core.wasm'), 'Bundled browser video optimizer');

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.rename(stagingDirectory, outputDirectory);

console.log(`Frontend built at ${outputDirectory}`);
