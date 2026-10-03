import fs from 'node:fs/promises';
import path from 'node:path';

export const MIN_VIDEO_SHORT_EDGE = 1080;

export function assertFullHdDimensions(dimensions, label = 'Video') {
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  if (!Number.isFinite(shortEdge) || shortEdge < MIN_VIDEO_SHORT_EDGE) {
    throw new Error(`${label} is ${dimensions.width}x${dimensions.height}. LoroBuy requires at least ${MIN_VIDEO_SHORT_EDGE}px on the short edge.`);
  }
}

function listBoxes(buffer, start = 0, end = buffer.length) {
  const boxes = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) throw new Error('Invalid extended MP4 box header.');
      const extendedSize = buffer.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box is too large to inspect safely.');
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (type === 'uuid') headerSize += 16;
    if (size < headerSize || offset + size > end) throw new Error(`Invalid MP4 ${type || 'unknown'} box.`);

    boxes.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }

  return boxes;
}

export async function readMp4Dimensions(filePath) {
  const buffer = await fs.readFile(filePath);
  const moov = listBoxes(buffer).find((box) => box.type === 'moov');
  if (!moov) throw new Error('MP4 metadata box (moov) was not found.');

  const dimensions = [];
  for (const track of listBoxes(buffer, moov.dataStart, moov.end).filter((box) => box.type === 'trak')) {
    const header = listBoxes(buffer, track.dataStart, track.end).find((box) => box.type === 'tkhd');
    if (!header || header.end - header.dataStart < 8) continue;
    const width = Math.round(buffer.readUInt32BE(header.end - 8) / 65536);
    const height = Math.round(buffer.readUInt32BE(header.end - 4) / 65536);
    if (width > 0 && height > 0) dimensions.push({ width, height });
  }

  if (!dimensions.length) throw new Error('No visual track dimensions were found in the MP4.');
  return dimensions.sort((left, right) => (right.width * right.height) - (left.width * left.height))[0];
}

async function findMp4Files(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findMp4Files(entryPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) files.push(entryPath);
  }
  return files;
}

export async function validateStorefrontVideoQuality(frontendDirectory) {
  const heroPath = path.join(frontendDirectory, 'assets', 'hero.mp4');
  const previewDirectory = path.join(frontendDirectory, 'assets', 'previews');
  const videos = [heroPath, ...await findMp4Files(previewDirectory)];
  const results = [];

  for (const videoPath of videos) {
    let dimensions;
    try {
      dimensions = await readMp4Dimensions(videoPath);
    } catch (error) {
      throw new Error(`Unable to inspect video ${path.relative(frontendDirectory, videoPath)}: ${error.message}`);
    }

    assertFullHdDimensions(dimensions, `Video ${path.relative(frontendDirectory, videoPath)}`);
    results.push({ path: videoPath, ...dimensions });
  }

  return results;
}
