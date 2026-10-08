import {
  FOURDV_MAGIC,
  FOURDV_VERSION,
  FourDVFlags,
  FourDVHeader,
  FourDVTocEntry,
  Decoded4DScene,
} from './fourdvSchema';
import { decompressDeflate } from './deflate';

/**
 * Finds the TOC chunk entry responsible for a specific playback time.
 */
export function getChunkForTime(toc: FourDVTocEntry[], time: number): FourDVTocEntry | null {
  // Find dynamic chunk covering the time
  for (const entry of toc) {
    if (entry.chunkId > 0 && time >= entry.timeStart && time <= entry.timeEnd) {
      return entry;
    }
  }
  return toc.find((e) => e.chunkId > 0) || null;
}

/**
 * Decodes a single chunk payload from .4DV container buffer.
 */
export async function readChunkAsync(
  buffer: ArrayBuffer | Uint8Array,
  entry: FourDVTocEntry,
  header: FourDVHeader
): Promise<Float32Array> {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;

  let chunkBytes = new Uint8Array(arrayBuffer, byteOffset + entry.fileOffset, entry.byteLength);

  // Decompress if compressed
  if (entry.flags && (entry.flags & FourDVFlags.IS_COMPRESSED)) {
    chunkBytes = await decompressDeflate(chunkBytes);
  }

  const isStatic = entry.chunkId === 0;
  const isQuantized = (header.flags & FourDVFlags.IS_QUANTIZED) !== 0;
  const dataView = new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength);

  const dx = Math.max(header.boundsMax[0] - header.boundsMin[0], 0.0001);
  const dy = Math.max(header.boundsMax[1] - header.boundsMin[1], 0.0001);
  const dz = Math.max(header.boundsMax[2] - header.boundsMin[2], 0.0001);
  const sMax = Math.max(header.scaleMax, 0.0001);
  const vMax = Math.max(header.velMax, 0.0001);
  const aMax = Math.max(header.accelMax, 0.0001);

  if (isStatic) {
    const staticCount = entry.gaussianCount;
    const outFloats = new Float32Array(staticCount * 10);

    if (isQuantized) {
      let offset = 0;
      for (let i = 0; i < staticCount; i++) {
        const dst = i * 10;
        const qx = dataView.getUint16(offset + 0, true);
        const qy = dataView.getUint16(offset + 2, true);
        const qz = dataView.getUint16(offset + 4, true);
        outFloats[dst + 0] = header.boundsMin[0] + (qx / 65535) * dx;
        outFloats[dst + 1] = header.boundsMin[1] + (qy / 65535) * dy;
        outFloats[dst + 2] = header.boundsMin[2] + (qz / 65535) * dz;

        const qsx = dataView.getUint16(offset + 6, true);
        const qsy = dataView.getUint16(offset + 8, true);
        const qsz = dataView.getUint16(offset + 10, true);
        outFloats[dst + 3] = (qsx / 65535) * sMax;
        outFloats[dst + 4] = (qsy / 65535) * sMax;
        outFloats[dst + 5] = (qsz / 65535) * sMax;

        outFloats[dst + 6] = dataView.getUint8(offset + 12) / 255;
        outFloats[dst + 7] = dataView.getUint8(offset + 13) / 255;
        outFloats[dst + 8] = dataView.getUint8(offset + 14) / 255;
        outFloats[dst + 9] = dataView.getUint8(offset + 15) / 255;
        offset += 16;
      }
    } else {
      for (let i = 0; i < staticCount * 10; i++) {
        outFloats[i] = dataView.getFloat32(i * 4, true);
      }
    }
    return outFloats;
  } else {
    const dynamicCount = entry.gaussianCount;
    const outFloats = new Float32Array(dynamicCount * 19);

    if (isQuantized) {
      let offset = 0;
      for (let i = 0; i < dynamicCount; i++) {
        const dst = i * 19;
        const qx = dataView.getUint16(offset + 0, true);
        const qy = dataView.getUint16(offset + 2, true);
        const qz = dataView.getUint16(offset + 4, true);
        outFloats[dst + 0] = header.boundsMin[0] + (qx / 65535) * dx;
        outFloats[dst + 1] = header.boundsMin[1] + (qy / 65535) * dy;
        outFloats[dst + 2] = header.boundsMin[2] + (qz / 65535) * dz;

        const qsx = dataView.getUint16(offset + 6, true);
        const qsy = dataView.getUint16(offset + 8, true);
        const qsz = dataView.getUint16(offset + 10, true);
        outFloats[dst + 3] = (qsx / 65535) * sMax;
        outFloats[dst + 4] = (qsy / 65535) * sMax;
        outFloats[dst + 5] = (qsz / 65535) * sMax;

        outFloats[dst + 6] = dataView.getUint8(offset + 12) / 255;
        outFloats[dst + 7] = dataView.getUint8(offset + 13) / 255;
        outFloats[dst + 8] = dataView.getUint8(offset + 14) / 255;
        outFloats[dst + 9] = dataView.getUint8(offset + 15) / 255;

        const vx = dataView.getInt16(offset + 16, true);
        const vy = dataView.getInt16(offset + 18, true);
        const vz = dataView.getInt16(offset + 20, true);
        outFloats[dst + 10] = (vx / 32767) * vMax;
        outFloats[dst + 11] = (vy / 32767) * vMax;
        outFloats[dst + 12] = (vz / 32767) * vMax;

        const ax = dataView.getInt16(offset + 22, true);
        const ay = dataView.getInt16(offset + 24, true);
        const az = dataView.getInt16(offset + 26, true);
        outFloats[dst + 13] = (ax / 32767) * aMax;
        outFloats[dst + 14] = (ay / 32767) * aMax;
        outFloats[dst + 15] = (az / 32767) * aMax;

        const hAmp = dataView.getUint16(offset + 28, true);
        const hFreq = dataView.getUint16(offset + 30, true);
        const hPhase = dataView.getUint16(offset + 32, true);
        outFloats[dst + 16] = (hAmp / 65535) * header.harmonicMax[0];
        outFloats[dst + 17] = (hFreq / 65535) * header.harmonicMax[1];
        outFloats[dst + 18] = (hPhase / 65535) * header.harmonicMax[2];

        offset += 34;
      }
    } else {
      for (let i = 0; i < dynamicCount * 19; i++) {
        outFloats[i] = dataView.getFloat32(i * 4, true);
      }
    }
    return outFloats;
  }
}

/**
 * Parses container header (96 bytes) from .4DV buffer.
 */
export function parseHeader(buffer: ArrayBuffer | Uint8Array): FourDVHeader {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const byteLength = buffer instanceof Uint8Array ? buffer.byteLength : buffer.byteLength;

  const dataView = new DataView(arrayBuffer, byteOffset, byteLength);

  // 1. Validate Magic '4DV1'
  const magic = dataView.getUint32(0, true);
  if (magic !== FOURDV_MAGIC) {
    throw new Error(
      `[FourDVReader] Invalid .4DV container magic. Expected 0x${FOURDV_MAGIC.toString(16)} ('4DV1'), received 0x${magic.toString(16)}.`
    );
  }

  const version = dataView.getUint16(4, true);
  if (version > FOURDV_VERSION) {
    throw new Error(`[FourDVReader] Unsupported .4DV container version ${version}.`);
  }

  const flags = dataView.getUint16(6, true);
  const frameCount = dataView.getUint32(8, true);
  const fps = dataView.getFloat32(12, true);
  const duration = dataView.getFloat32(16, true);
  const totalGaussians = dataView.getUint32(20, true);
  const staticGaussians = dataView.getUint32(24, true);
  const dynamicGaussians = dataView.getUint32(28, true);

  const boundsMin: [number, number, number] = [
    dataView.getFloat32(32, true),
    dataView.getFloat32(36, true),
    dataView.getFloat32(40, true),
  ];
  const boundsMax: [number, number, number] = [
    dataView.getFloat32(44, true),
    dataView.getFloat32(48, true),
    dataView.getFloat32(52, true),
  ];

  const scaleMax = dataView.getFloat32(56, true);
  const velMax = dataView.getFloat32(60, true);
  const accelMax = dataView.getFloat32(64, true);
  const harmonicMax: [number, number, number] = [
    dataView.getFloat32(68, true),
    dataView.getFloat32(72, true),
    dataView.getFloat32(76, true),
  ];

  const tocOffset = dataView.getUint32(80, true);
  const tocEntriesCount = dataView.getUint32(84, true);

  return {
    magic,
    version,
    flags,
    frameCount,
    fps,
    duration,
    totalGaussians,
    staticGaussians,
    dynamicGaussians,
    boundsMin,
    boundsMax,
    scaleMax: scaleMax || 1.0,
    velMax: velMax || 1.0,
    accelMax: accelMax || 1.0,
    harmonicMax: harmonicMax[0] ? harmonicMax : [1.0, 1.0, Math.PI * 2],
    tocOffset,
    tocEntries: tocEntriesCount,
  };
}

/**
 * Parses Table of Contents (TOC) entries table from .4DV buffer.
 */
export function parseToc(buffer: ArrayBuffer | Uint8Array, header: FourDVHeader): FourDVTocEntry[] {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const byteLength = buffer instanceof Uint8Array ? buffer.byteLength : buffer.byteLength;

  const dataView = new DataView(arrayBuffer, byteOffset, byteLength);
  const toc: FourDVTocEntry[] = [];

  for (let i = 0; i < header.tocEntries; i++) {
    const ptr = header.tocOffset + i * 32;
    toc.push({
      chunkId: dataView.getUint32(ptr + 0, true),
      timeStart: dataView.getFloat32(ptr + 4, true),
      timeEnd: dataView.getFloat32(ptr + 8, true),
      fileOffset: dataView.getUint32(ptr + 12, true),
      byteLength: dataView.getUint32(ptr + 16, true),
      uncompressedLength: dataView.getUint32(ptr + 20, true),
      gaussianCount: dataView.getUint32(ptr + 24, true),
      flags: dataView.getUint32(ptr + 28, true),
    });
  }

  return toc;
}

/**
 * Asynchronously decodes full .4DV container buffer with multi-chunk DEFLATE decompression.
 */
export async function decode4DVAsync(buffer: ArrayBuffer | Uint8Array): Promise<Decoded4DScene> {
  const header = parseHeader(buffer);
  const toc = parseToc(buffer, header);
  const staticGaussians = header.staticGaussians;
  const dynamicGaussians = header.dynamicGaussians;
  const totalGaussians = header.totalGaussians;
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const byteLength = buffer instanceof Uint8Array ? buffer.byteLength : buffer.byteLength;
  const dataView = new DataView(arrayBuffer, byteOffset, byteLength);


  // 3. Decompress and Decode Static Chunk (Chunk 0)
  const staticEntry = toc.find((e) => e.chunkId === 0) || toc[0];
  const staticFloats = await readChunkAsync(buffer, staticEntry, header);

  // 4. Decompress and Decode Dynamic Chunks
  const dynamicEntries = toc.filter((e) => e.chunkId > 0);
  let dynamicFloats: Float32Array;

  if (dynamicEntries.length > 0) {
    // Primary dynamic chunk
    dynamicFloats = await readChunkAsync(buffer, dynamicEntries[0], header);
  } else {
    dynamicFloats = new Float32Array(dynamicGaussians * 19);
  }

  // 5. Build Unified Interleaved Array
  const allGaussiansPacked = new Float32Array(totalGaussians * 19);
  for (let i = 0; i < staticGaussians; i++) {
    const src = i * 10;
    const dst = i * 19;
    allGaussiansPacked[dst + 0] = staticFloats[src + 0];
    allGaussiansPacked[dst + 1] = staticFloats[src + 1];
    allGaussiansPacked[dst + 2] = staticFloats[src + 2];
    allGaussiansPacked[dst + 3] = staticFloats[src + 3];
    allGaussiansPacked[dst + 4] = staticFloats[src + 4];
    allGaussiansPacked[dst + 5] = staticFloats[src + 5];
    allGaussiansPacked[dst + 6] = staticFloats[src + 6];
    allGaussiansPacked[dst + 7] = staticFloats[src + 7];
    allGaussiansPacked[dst + 8] = staticFloats[src + 8];
    allGaussiansPacked[dst + 9] = staticFloats[src + 9];
  }

  const dynamicDstStart = staticGaussians * 19;
  allGaussiansPacked.set(dynamicFloats, dynamicDstStart);

  // 6. Metadata parsing
  const lastChunk = toc[toc.length - 1];
  const metaStart = lastChunk.fileOffset + lastChunk.byteLength;
  let metadata = {
    title: '4DV Scene',
    description: '',
    creationDate: '',
  };

  if (metaStart + 4 <= byteLength) {
    const metaLen = dataView.getUint32(metaStart, true);
    if (metaStart + 4 + metaLen <= byteLength) {
      const metaBytes = new Uint8Array(arrayBuffer, byteOffset + metaStart + 4, metaLen);
      try {
        const jsonStr = new TextDecoder().decode(metaBytes);
        metadata = { ...metadata, ...JSON.parse(jsonStr) };
      } catch (e) {
        console.warn('[FourDVReader] Failed to parse JSON metadata:', e);
      }
    }
  }

  return {
    header,
    toc,
    metadata,
    staticAttributes: staticFloats,
    dynamicAttributes: dynamicFloats,
    allGaussiansPacked,
  };
}

/**
 * Synchronous decoder wrapper.
 */
export function decode4DV(buffer: ArrayBuffer | Uint8Array): Decoded4DScene {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const byteLength = buffer instanceof Uint8Array ? buffer.byteLength : buffer.byteLength;

  const dataView = new DataView(arrayBuffer, byteOffset, byteLength);

  const magic = dataView.getUint32(0, true);
  if (magic !== FOURDV_MAGIC) {
    throw new Error(`[FourDVReader] Invalid .4DV container magic.`);
  }

  const version = dataView.getUint16(4, true);
  const flags = dataView.getUint16(6, true);
  const frameCount = dataView.getUint32(8, true);
  const fps = dataView.getFloat32(12, true);
  const duration = dataView.getFloat32(16, true);
  const totalGaussians = dataView.getUint32(20, true);
  const staticGaussians = dataView.getUint32(24, true);
  const dynamicGaussians = dataView.getUint32(28, true);

  const boundsMin: [number, number, number] = [
    dataView.getFloat32(32, true),
    dataView.getFloat32(36, true),
    dataView.getFloat32(40, true),
  ];
  const boundsMax: [number, number, number] = [
    dataView.getFloat32(44, true),
    dataView.getFloat32(48, true),
    dataView.getFloat32(52, true),
  ];
  const scaleMax = dataView.getFloat32(56, true);
  const velMax = dataView.getFloat32(60, true);
  const accelMax = dataView.getFloat32(64, true);
  const harmonicMax: [number, number, number] = [
    dataView.getFloat32(68, true),
    dataView.getFloat32(72, true),
    dataView.getFloat32(76, true),
  ];

  const tocOffset = dataView.getUint32(80, true);
  const tocEntriesCount = dataView.getUint32(84, true);

  const header: FourDVHeader = {
    magic,
    version,
    flags,
    frameCount,
    fps,
    duration,
    totalGaussians,
    staticGaussians,
    dynamicGaussians,
    boundsMin,
    boundsMax,
    scaleMax: scaleMax || 1.0,
    velMax: velMax || 1.0,
    accelMax: accelMax || 1.0,
    harmonicMax: harmonicMax[0] ? harmonicMax : [1.0, 1.0, Math.PI * 2],
    tocOffset,
    tocEntries: tocEntriesCount,
  };

  const toc: FourDVTocEntry[] = [];
  for (let i = 0; i < tocEntriesCount; i++) {
    const ptr = tocOffset + i * 32;
    toc.push({
      chunkId: dataView.getUint32(ptr + 0, true),
      timeStart: dataView.getFloat32(ptr + 4, true),
      timeEnd: dataView.getFloat32(ptr + 8, true),
      fileOffset: dataView.getUint32(ptr + 12, true),
      byteLength: dataView.getUint32(ptr + 16, true),
      uncompressedLength: dataView.getUint32(ptr + 20, true),
      gaussianCount: dataView.getUint32(ptr + 24, true),
      flags: dataView.getUint32(ptr + 28, true),
    });
  }

  const dx = Math.max(boundsMax[0] - boundsMin[0], 0.0001);
  const dy = Math.max(boundsMax[1] - boundsMin[1], 0.0001);
  const dz = Math.max(boundsMax[2] - boundsMin[2], 0.0001);
  const sMax = Math.max(header.scaleMax, 0.0001);
  const vMax = Math.max(header.velMax, 0.0001);
  const aMax = Math.max(header.accelMax, 0.0001);
  const isQuantized = (flags & FourDVFlags.IS_QUANTIZED) !== 0;

  const staticFloats = new Float32Array(staticGaussians * 10);
  const staticEntry = toc[0];
  const staticDataStart = staticEntry.fileOffset;

  if (isQuantized) {
    let offset = staticDataStart;
    for (let i = 0; i < staticGaussians; i++) {
      const dst = i * 10;
      staticFloats[dst + 0] = boundsMin[0] + (dataView.getUint16(offset + 0, true) / 65535) * dx;
      staticFloats[dst + 1] = boundsMin[1] + (dataView.getUint16(offset + 2, true) / 65535) * dy;
      staticFloats[dst + 2] = boundsMin[2] + (dataView.getUint16(offset + 4, true) / 65535) * dz;
      staticFloats[dst + 3] = (dataView.getUint16(offset + 6, true) / 65535) * sMax;
      staticFloats[dst + 4] = (dataView.getUint16(offset + 8, true) / 65535) * sMax;
      staticFloats[dst + 5] = (dataView.getUint16(offset + 10, true) / 65535) * sMax;
      staticFloats[dst + 6] = dataView.getUint8(offset + 12) / 255;
      staticFloats[dst + 7] = dataView.getUint8(offset + 13) / 255;
      staticFloats[dst + 8] = dataView.getUint8(offset + 14) / 255;
      staticFloats[dst + 9] = dataView.getUint8(offset + 15) / 255;
      offset += 16;
    }
  } else {
    for (let i = 0; i < staticGaussians * 10; i++) {
      staticFloats[i] = dataView.getFloat32(staticDataStart + i * 4, true);
    }
  }

  const dynamicFloats = new Float32Array(dynamicGaussians * 19);
  const dynamicEntry = toc.length > 1 ? toc[1] : toc[0];
  const dynamicDataStart = dynamicEntry.fileOffset;

  if (isQuantized) {
    let offset = dynamicDataStart;
    for (let i = 0; i < dynamicGaussians; i++) {
      const dst = i * 19;
      dynamicFloats[dst + 0] = boundsMin[0] + (dataView.getUint16(offset + 0, true) / 65535) * dx;
      dynamicFloats[dst + 1] = boundsMin[1] + (dataView.getUint16(offset + 2, true) / 65535) * dy;
      dynamicFloats[dst + 2] = boundsMin[2] + (dataView.getUint16(offset + 4, true) / 65535) * dz;
      dynamicFloats[dst + 3] = (dataView.getUint16(offset + 6, true) / 65535) * sMax;
      dynamicFloats[dst + 4] = (dataView.getUint16(offset + 8, true) / 65535) * sMax;
      dynamicFloats[dst + 5] = (dataView.getUint16(offset + 10, true) / 65535) * sMax;
      dynamicFloats[dst + 6] = dataView.getUint8(offset + 12) / 255;
      dynamicFloats[dst + 7] = dataView.getUint8(offset + 13) / 255;
      dynamicFloats[dst + 8] = dataView.getUint8(offset + 14) / 255;
      dynamicFloats[dst + 9] = dataView.getUint8(offset + 15) / 255;
      dynamicFloats[dst + 10] = (dataView.getInt16(offset + 16, true) / 32767) * vMax;
      dynamicFloats[dst + 11] = (dataView.getInt16(offset + 18, true) / 32767) * vMax;
      dynamicFloats[dst + 12] = (dataView.getInt16(offset + 20, true) / 32767) * vMax;
      dynamicFloats[dst + 13] = (dataView.getInt16(offset + 22, true) / 32767) * aMax;
      dynamicFloats[dst + 14] = (dataView.getInt16(offset + 24, true) / 32767) * aMax;
      dynamicFloats[dst + 15] = (dataView.getInt16(offset + 26, true) / 32767) * aMax;
      dynamicFloats[dst + 16] = (dataView.getUint16(offset + 28, true) / 65535) * header.harmonicMax[0];
      dynamicFloats[dst + 17] = (dataView.getUint16(offset + 30, true) / 65535) * header.harmonicMax[1];
      dynamicFloats[dst + 18] = (dataView.getUint16(offset + 32, true) / 65535) * header.harmonicMax[2];
      offset += 34;
    }
  } else {
    for (let i = 0; i < dynamicGaussians * 19; i++) {
      dynamicFloats[i] = dataView.getFloat32(dynamicDataStart + i * 4, true);
    }
  }

  const allGaussiansPacked = new Float32Array(totalGaussians * 19);
  for (let i = 0; i < staticGaussians; i++) {
    const src = i * 10;
    const dst = i * 19;
    allGaussiansPacked[dst + 0] = staticFloats[src + 0];
    allGaussiansPacked[dst + 1] = staticFloats[src + 1];
    allGaussiansPacked[dst + 2] = staticFloats[src + 2];
    allGaussiansPacked[dst + 3] = staticFloats[src + 3];
    allGaussiansPacked[dst + 4] = staticFloats[src + 4];
    allGaussiansPacked[dst + 5] = staticFloats[src + 5];
    allGaussiansPacked[dst + 6] = staticFloats[src + 6];
    allGaussiansPacked[dst + 7] = staticFloats[src + 7];
    allGaussiansPacked[dst + 8] = staticFloats[src + 8];
    allGaussiansPacked[dst + 9] = staticFloats[src + 9];
  }
  allGaussiansPacked.set(dynamicFloats, staticGaussians * 19);

  return {
    header,
    toc,
    metadata: { title: '4DV Scene', description: '', creationDate: '' },
    staticAttributes: staticFloats,
    dynamicAttributes: dynamicFloats,
    allGaussiansPacked,
  };
}
