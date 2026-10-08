import { Gaussian4DPolynomial } from '../renderer/types';
import {
  FOURDV_MAGIC,
  FOURDV_VERSION,
  FOURDV_HEADER_SIZE,
  FOURDV_TOC_ENTRY_SIZE,
  STATIC_GAUSSIAN_QUANTIZED_BYTES,
  STATIC_GAUSSIAN_FLOAT32_BYTES,
  DYNAMIC_GAUSSIAN_QUANTIZED_BYTES,
  DYNAMIC_GAUSSIAN_FLOAT32_BYTES,
  FourDVFlags,
} from './fourdvSchema';
import { separateStaticDynamicGaussians } from './separation';
import { computeSceneRanges } from './quantization';
import { getMortonKey } from './morton';
import { compressDeflate } from './deflate';

export interface Encode4DVOptions {
  title?: string;
  description?: string;
  fps?: number;
  duration?: number;
  useQuantization?: boolean;
  chunkDuration?: number; // Duration per temporal chunk in seconds (e.g. 1.0s)
  compressChunks?: boolean; // Enable per-chunk DEFLATE stream compression
}

interface PreparedChunk {
  chunkId: number;
  timeStart: number;
  timeEnd: number;
  gaussianCount: number;
  flags: number;
  rawBytes: Uint8Array;
  finalBytes: Uint8Array;
  uncompressedLength: number;
  byteLength: number;
}

/**
 * Encodes 4D dynamic Gaussian scene into a standalone .4DV binary file buffer with seekable TOC chunks.
 */
export async function encode4DVAsync(
  gaussians: Gaussian4DPolynomial[],
  options?: Encode4DVOptions
): Promise<Uint8Array> {
  const title = options?.title || 'Traversable 4DV Scene';
  const description = options?.description || 'Exported from 4DV Engine';
  const fps = options?.fps || 30.0;
  const duration = options?.duration || 5.0;
  const frameCount = Math.floor(duration * fps);
  const useQuantization = options?.useQuantization !== false;
  const chunkDuration = options?.chunkDuration || 1.0;
  const compressChunks = options?.compressChunks === true;

  // 1. Factorize Static Landmarks vs Dynamic Trajectories
  const separated = separateStaticDynamicGaussians(gaussians, 0.0001);
  const staticList = [...separated.staticGaussians];
  const dynamicList = [...separated.dynamicGaussians];

  const totalCount = gaussians.length;
  const staticCount = staticList.length;
  const dynamicCount = dynamicList.length;

  // 2. Compute Normalization Ranges
  const ranges = computeSceneRanges(gaussians);
  const dx = Math.max(ranges.boundsMax[0] - ranges.boundsMin[0], 0.0001);
  const dy = Math.max(ranges.boundsMax[1] - ranges.boundsMin[1], 0.0001);
  const dz = Math.max(ranges.boundsMax[2] - ranges.boundsMin[2], 0.0001);
  const sMax = Math.max(ranges.scaleMax, 0.0001);
  const vMax = Math.max(ranges.velMax, 0.0001);
  const aMax = Math.max(ranges.accelMax, 0.0001);

  // 3. Morton 3D Spatial Curve Sorting
  staticList.sort((a, b) => {
    const ma = getMortonKey(a.position, ranges.boundsMin, ranges.boundsMax);
    const mb = getMortonKey(b.position, ranges.boundsMin, ranges.boundsMax);
    return ma - mb;
  });

  dynamicList.sort((a, b) => {
    const ma = getMortonKey(a.position, ranges.boundsMin, ranges.boundsMax);
    const mb = getMortonKey(b.position, ranges.boundsMin, ranges.boundsMax);
    return ma - mb;
  });

  // Bitmask Flags
  let fileFlags = FourDVFlags.HAS_STATIC_SPLIT | FourDVFlags.HAS_SPATIAL_MORTON;
  if (useQuantization) fileFlags |= FourDVFlags.IS_QUANTIZED;
  if (compressChunks) fileFlags |= FourDVFlags.IS_COMPRESSED;

  // 4. Build Chunk 0: Static Persistent Block
  const staticBytesPerElem = useQuantization
    ? STATIC_GAUSSIAN_QUANTIZED_BYTES
    : STATIC_GAUSSIAN_FLOAT32_BYTES;
  const rawStaticBuffer = new ArrayBuffer(staticCount * staticBytesPerElem);
  const staticView = new DataView(rawStaticBuffer);

  if (useQuantization) {
    let offset = 0;
    for (let i = 0; i < staticCount; i++) {
      const g = staticList[i];
      const qx = Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535);
      const qy = Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535);
      const qz = Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535);
      staticView.setUint16(offset + 0, qx, true);
      staticView.setUint16(offset + 2, qy, true);
      staticView.setUint16(offset + 4, qz, true);

      const qsx = Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535);
      const qsy = Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535);
      const qsz = Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535);
      staticView.setUint16(offset + 6, qsx, true);
      staticView.setUint16(offset + 8, qsy, true);
      staticView.setUint16(offset + 10, qsz, true);

      staticView.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
      staticView.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
      staticView.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));
      staticView.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));
      offset += 16;
    }
  } else {
    let offset = 0;
    for (let i = 0; i < staticCount; i++) {
      const g = staticList[i];
      staticView.setFloat32(offset + 0, g.position[0], true);
      staticView.setFloat32(offset + 4, g.position[1], true);
      staticView.setFloat32(offset + 8, g.position[2], true);
      staticView.setFloat32(offset + 12, g.scale[0], true);
      staticView.setFloat32(offset + 16, g.scale[1], true);
      staticView.setFloat32(offset + 20, g.scale[2], true);
      staticView.setFloat32(offset + 24, g.color[0], true);
      staticView.setFloat32(offset + 28, g.color[1], true);
      staticView.setFloat32(offset + 32, g.color[2], true);
      staticView.setFloat32(offset + 36, g.opacity, true);
      offset += 40;
    }
  }

  const rawStaticBytes = new Uint8Array(rawStaticBuffer);
  let finalStaticBytes = rawStaticBytes;
  let chunk0Flags = fileFlags;

  if (compressChunks) {
    const compressed = await compressDeflate(rawStaticBytes);
    finalStaticBytes = new Uint8Array(compressed);
    chunk0Flags |= FourDVFlags.IS_COMPRESSED;
  } else {
    chunk0Flags &= ~FourDVFlags.IS_COMPRESSED;
  }

  const preparedChunks: PreparedChunk[] = [];
  preparedChunks.push({
    chunkId: 0,
    timeStart: 0.0,
    timeEnd: duration,
    gaussianCount: staticCount,
    flags: chunk0Flags,
    rawBytes: rawStaticBytes,
    finalBytes: finalStaticBytes,
    uncompressedLength: rawStaticBytes.byteLength,
    byteLength: finalStaticBytes.byteLength,
  });

  // 5. Build Dynamic Temporal Chunks (Chunks 1..N)
  const numDynamicChunks = Math.max(1, Math.ceil(duration / Math.max(chunkDuration, 0.01)));
  const dynamicBytesPerElem = useQuantization
    ? DYNAMIC_GAUSSIAN_QUANTIZED_BYTES
    : DYNAMIC_GAUSSIAN_FLOAT32_BYTES;

  for (let c = 0; c < numDynamicChunks; c++) {
    const timeStart = c * chunkDuration;
    const timeEnd = Math.min(duration, (c + 1) * chunkDuration);

    const rawChunkBuffer = new ArrayBuffer(dynamicCount * dynamicBytesPerElem);
    const chunkView = new DataView(rawChunkBuffer);

    if (useQuantization) {
      let offset = 0;
      for (let i = 0; i < dynamicCount; i++) {
        const g = dynamicList[i];
        const qx = Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535);
        const qy = Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535);
        const qz = Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535);
        chunkView.setUint16(offset + 0, qx, true);
        chunkView.setUint16(offset + 2, qy, true);
        chunkView.setUint16(offset + 4, qz, true);

        const qsx = Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535);
        const qsy = Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535);
        const qsz = Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535);
        chunkView.setUint16(offset + 6, qsx, true);
        chunkView.setUint16(offset + 8, qsy, true);
        chunkView.setUint16(offset + 10, qsz, true);

        chunkView.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
        chunkView.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
        chunkView.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));
        chunkView.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));

        const vx = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[0] / vMax, -1), 1) * 32767) : 0;
        const vy = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[1] / vMax, -1), 1) * 32767) : 0;
        const vz = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[2] / vMax, -1), 1) * 32767) : 0;
        chunkView.setInt16(offset + 16, vx, true);
        chunkView.setInt16(offset + 18, vy, true);
        chunkView.setInt16(offset + 20, vz, true);

        const ax = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[0] / aMax, -1), 1) * 32767) : 0;
        const ay = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[1] / aMax, -1), 1) * 32767) : 0;
        const az = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[2] / aMax, -1), 1) * 32767) : 0;
        chunkView.setInt16(offset + 22, ax, true);
        chunkView.setInt16(offset + 24, ay, true);
        chunkView.setInt16(offset + 26, az, true);

        const hAmp = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[0] / ranges.harmonicMax[0], 0), 1) * 65535) : 0;
        const hFreq = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[1] / ranges.harmonicMax[1], 0), 1) * 65535) : 0;
        const hPhase = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[2] / ranges.harmonicMax[2], 0), 1) * 65535) : 0;
        chunkView.setUint16(offset + 28, hAmp, true);
        chunkView.setUint16(offset + 30, hFreq, true);
        chunkView.setUint16(offset + 32, hPhase, true);

        offset += 34;
      }
    } else {
      let offset = 0;
      for (let i = 0; i < dynamicCount; i++) {
        const g = dynamicList[i];
        chunkView.setFloat32(offset + 0, g.position[0], true);
        chunkView.setFloat32(offset + 4, g.position[1], true);
        chunkView.setFloat32(offset + 8, g.position[2], true);
        chunkView.setFloat32(offset + 12, g.scale[0], true);
        chunkView.setFloat32(offset + 16, g.scale[1], true);
        chunkView.setFloat32(offset + 20, g.scale[2], true);
        chunkView.setFloat32(offset + 24, g.color[0], true);
        chunkView.setFloat32(offset + 28, g.color[1], true);
        chunkView.setFloat32(offset + 32, g.color[2], true);
        chunkView.setFloat32(offset + 36, g.opacity, true);
        chunkView.setFloat32(offset + 40, g.motionP1 ? g.motionP1[0] : 0, true);
        chunkView.setFloat32(offset + 44, g.motionP1 ? g.motionP1[1] : 0, true);
        chunkView.setFloat32(offset + 48, g.motionP1 ? g.motionP1[2] : 0, true);
        chunkView.setFloat32(offset + 52, g.motionP2 ? g.motionP2[0] : 0, true);
        chunkView.setFloat32(offset + 56, g.motionP2 ? g.motionP2[1] : 0, true);
        chunkView.setFloat32(offset + 60, g.motionP2 ? g.motionP2[2] : 0, true);
        chunkView.setFloat32(offset + 64, g.motionP3 ? g.motionP3[0] : 0, true);
        chunkView.setFloat32(offset + 68, g.motionP3 ? g.motionP3[1] : 0, true);
        chunkView.setFloat32(offset + 72, g.motionP3 ? g.motionP3[2] : 0, true);
        offset += 76;
      }
    }

    const rawChunkBytes = new Uint8Array(rawChunkBuffer);
    let finalChunkBytes = rawChunkBytes;
    let chunkFlags = fileFlags;

    if (compressChunks) {
      const compressed = await compressDeflate(rawChunkBytes);
      finalChunkBytes = new Uint8Array(compressed);
      chunkFlags |= FourDVFlags.IS_COMPRESSED;
    } else {
      chunkFlags &= ~FourDVFlags.IS_COMPRESSED;
    }

    preparedChunks.push({
      chunkId: c + 1,
      timeStart,
      timeEnd,
      gaussianCount: dynamicCount,
      flags: chunkFlags,
      rawBytes: rawChunkBytes,
      finalBytes: finalChunkBytes,
      uncompressedLength: rawChunkBytes.byteLength,
      byteLength: finalChunkBytes.byteLength,
    });
  }

  // 6. Serialize JSON Metadata
  const totalTocEntries = preparedChunks.length;
  const metaJson = JSON.stringify({
    title,
    description,
    creationDate: new Date().toISOString(),
    generator: '4DV Studio Engine v1.0',
    fps,
    duration,
    frameCount,
    chunkDuration,
    compressChunks,
    numChunks: totalTocEntries,
  });
  const metaBytes = new TextEncoder().encode(metaJson);

  // 7. Compute Exact File Offsets & Layout
  const headerSize = FOURDV_HEADER_SIZE;
  const tocSize = totalTocEntries * FOURDV_TOC_ENTRY_SIZE;

  let totalPayloadSize = 0;
  for (const chunk of preparedChunks) {
    totalPayloadSize += chunk.byteLength;
  }
  const metaBlockSize = 4 + metaBytes.length;
  const totalFileSize = headerSize + tocSize + totalPayloadSize + metaBlockSize;

  const fullBuffer = new ArrayBuffer(totalFileSize);
  const dataView = new DataView(fullBuffer);
  const uint8View = new Uint8Array(fullBuffer);

  // ---------------- Write Header (96B) ----------------
  dataView.setUint32(0, FOURDV_MAGIC, true);
  dataView.setUint16(4, FOURDV_VERSION, true);
  dataView.setUint16(6, fileFlags, true);
  dataView.setUint32(8, frameCount, true);
  dataView.setFloat32(12, fps, true);
  dataView.setFloat32(16, duration, true);
  dataView.setUint32(20, totalCount, true);
  dataView.setUint32(24, staticCount, true);
  dataView.setUint32(28, dynamicCount, true);

  dataView.setFloat32(32, ranges.boundsMin[0], true);
  dataView.setFloat32(36, ranges.boundsMin[1], true);
  dataView.setFloat32(40, ranges.boundsMin[2], true);
  dataView.setFloat32(44, ranges.boundsMax[0], true);
  dataView.setFloat32(48, ranges.boundsMax[1], true);
  dataView.setFloat32(52, ranges.boundsMax[2], true);

  dataView.setFloat32(56, ranges.scaleMax, true);
  dataView.setFloat32(60, ranges.velMax, true);
  dataView.setFloat32(64, ranges.accelMax, true);
  dataView.setFloat32(68, ranges.harmonicMax[0], true);
  dataView.setFloat32(72, ranges.harmonicMax[1], true);
  dataView.setFloat32(76, ranges.harmonicMax[2], true);

  const tocOffset = headerSize;
  dataView.setUint32(80, tocOffset, true);
  dataView.setUint32(84, totalTocEntries, true);
  dataView.setUint32(88, 0, true); // Reserved
  dataView.setUint32(92, 0, true); // Reserved

  // ---------------- Write TOC Table & Payloads ----------------
  let currentPayloadOffset = headerSize + tocSize;
  let tocPtr = tocOffset;

  for (const chunk of preparedChunks) {
    const chunkOffset = currentPayloadOffset;

    // Write 32-byte TOC Entry
    dataView.setUint32(tocPtr + 0, chunk.chunkId, true);
    dataView.setFloat32(tocPtr + 4, chunk.timeStart, true);
    dataView.setFloat32(tocPtr + 8, chunk.timeEnd, true);
    dataView.setUint32(tocPtr + 12, chunkOffset, true);
    dataView.setUint32(tocPtr + 16, chunk.byteLength, true);
    dataView.setUint32(tocPtr + 20, chunk.uncompressedLength, true);
    dataView.setUint32(tocPtr + 24, chunk.gaussianCount, true);
    dataView.setUint32(tocPtr + 28, chunk.flags, true);

    // Copy Payload bytes
    uint8View.set(chunk.finalBytes, chunkOffset);

    currentPayloadOffset += chunk.byteLength;
    tocPtr += FOURDV_TOC_ENTRY_SIZE;
  }

  // ---------------- Write Metadata Block ----------------
  dataView.setUint32(currentPayloadOffset, metaBytes.length, true);
  uint8View.set(metaBytes, currentPayloadOffset + 4);

  // ---------------- Validation ----------------
  const writtenEnd = currentPayloadOffset + 4 + metaBytes.length;
  if (writtenEnd !== totalFileSize) {
    throw new Error(
      `4DV_WRITER_ERROR: Written size mismatch. expected=${totalFileSize} written=${writtenEnd}`
    );
  }

  for (let i = 0; i < totalTocEntries; i++) {
    const p = tocOffset + i * 32;
    const cOffset = dataView.getUint32(p + 12, true);
    const cLen = dataView.getUint32(p + 16, true);
    if (cOffset < headerSize + tocSize || cOffset + cLen > totalFileSize) {
      throw new Error(`4DV_WRITER_ERROR: Invalid TOC entry #${i} offset bounds [${cOffset}, ${cOffset + cLen}]`);
    }
  }

  return uint8View;
}

/**
 * Synchronous encoder wrapper producing an identical canonical .4DV file (uncompressed).
 */
export function encode4DV(
  gaussians: Gaussian4DPolynomial[],
  options?: Encode4DVOptions
): Uint8Array {
  const title = options?.title || 'Traversable 4DV Scene';
  const description = options?.description || 'Exported from 4DV Engine';
  const fps = options?.fps || 30.0;
  const duration = options?.duration || 5.0;
  const frameCount = Math.floor(duration * fps);
  const useQuantization = options?.useQuantization !== false;
  const chunkDuration = options?.chunkDuration || 1.0;

  const separated = separateStaticDynamicGaussians(gaussians, 0.0001);
  const staticList = [...separated.staticGaussians];
  const dynamicList = [...separated.dynamicGaussians];

  const totalCount = gaussians.length;
  const staticCount = staticList.length;
  const dynamicCount = dynamicList.length;

  const ranges = computeSceneRanges(gaussians);
  const dx = Math.max(ranges.boundsMax[0] - ranges.boundsMin[0], 0.0001);
  const dy = Math.max(ranges.boundsMax[1] - ranges.boundsMin[1], 0.0001);
  const dz = Math.max(ranges.boundsMax[2] - ranges.boundsMin[2], 0.0001);
  const sMax = Math.max(ranges.scaleMax, 0.0001);
  const vMax = Math.max(ranges.velMax, 0.0001);
  const aMax = Math.max(ranges.accelMax, 0.0001);

  staticList.sort((a, b) => getMortonKey(a.position, ranges.boundsMin, ranges.boundsMax) - getMortonKey(b.position, ranges.boundsMin, ranges.boundsMax));
  dynamicList.sort((a, b) => getMortonKey(a.position, ranges.boundsMin, ranges.boundsMax) - getMortonKey(b.position, ranges.boundsMin, ranges.boundsMax));

  let fileFlags = FourDVFlags.HAS_STATIC_SPLIT | FourDVFlags.HAS_SPATIAL_MORTON;
  if (useQuantization) fileFlags |= FourDVFlags.IS_QUANTIZED;

  const staticBytesPerElem = useQuantization
    ? STATIC_GAUSSIAN_QUANTIZED_BYTES
    : STATIC_GAUSSIAN_FLOAT32_BYTES;
  const rawStaticBuffer = new ArrayBuffer(staticCount * staticBytesPerElem);
  const staticView = new DataView(rawStaticBuffer);

  if (useQuantization) {
    let offset = 0;
    for (let i = 0; i < staticCount; i++) {
      const g = staticList[i];
      const qx = Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535);
      const qy = Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535);
      const qz = Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535);
      staticView.setUint16(offset + 0, qx, true);
      staticView.setUint16(offset + 2, qy, true);
      staticView.setUint16(offset + 4, qz, true);

      const qsx = Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535);
      const qsy = Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535);
      const qsz = Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535);
      staticView.setUint16(offset + 6, qsx, true);
      staticView.setUint16(offset + 8, qsy, true);
      staticView.setUint16(offset + 10, qsz, true);

      staticView.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
      staticView.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
      staticView.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));
      staticView.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));
      offset += 16;
    }
  } else {
    let offset = 0;
    for (let i = 0; i < staticCount; i++) {
      const g = staticList[i];
      staticView.setFloat32(offset + 0, g.position[0], true);
      staticView.setFloat32(offset + 4, g.position[1], true);
      staticView.setFloat32(offset + 8, g.position[2], true);
      staticView.setFloat32(offset + 12, g.scale[0], true);
      staticView.setFloat32(offset + 16, g.scale[1], true);
      staticView.setFloat32(offset + 20, g.scale[2], true);
      staticView.setFloat32(offset + 24, g.color[0], true);
      staticView.setFloat32(offset + 28, g.color[1], true);
      staticView.setFloat32(offset + 32, g.color[2], true);
      staticView.setFloat32(offset + 36, g.opacity, true);
      offset += 40;
    }
  }

  const rawStaticBytes = new Uint8Array(rawStaticBuffer);
  const preparedChunks: PreparedChunk[] = [];
  preparedChunks.push({
    chunkId: 0,
    timeStart: 0.0,
    timeEnd: duration,
    gaussianCount: staticCount,
    flags: fileFlags & ~FourDVFlags.IS_COMPRESSED,
    rawBytes: rawStaticBytes,
    finalBytes: rawStaticBytes,
    uncompressedLength: rawStaticBytes.byteLength,
    byteLength: rawStaticBytes.byteLength,
  });

  const numDynamicChunks = Math.max(1, Math.ceil(duration / Math.max(chunkDuration, 0.01)));
  const dynamicBytesPerElem = useQuantization
    ? DYNAMIC_GAUSSIAN_QUANTIZED_BYTES
    : DYNAMIC_GAUSSIAN_FLOAT32_BYTES;

  for (let c = 0; c < numDynamicChunks; c++) {
    const timeStart = c * chunkDuration;
    const timeEnd = Math.min(duration, (c + 1) * chunkDuration);

    const rawChunkBuffer = new ArrayBuffer(dynamicCount * dynamicBytesPerElem);
    const chunkView = new DataView(rawChunkBuffer);

    if (useQuantization) {
      let offset = 0;
      for (let i = 0; i < dynamicCount; i++) {
        const g = dynamicList[i];
        const qx = Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535);
        const qy = Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535);
        const qz = Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535);
        chunkView.setUint16(offset + 0, qx, true);
        chunkView.setUint16(offset + 2, qy, true);
        chunkView.setUint16(offset + 4, qz, true);

        const qsx = Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535);
        const qsy = Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535);
        const qsz = Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535);
        chunkView.setUint16(offset + 6, qsx, true);
        chunkView.setUint16(offset + 8, qsy, true);
        chunkView.setUint16(offset + 10, qsz, true);

        chunkView.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
        chunkView.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
        chunkView.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));
        chunkView.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));

        const vx = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[0] / vMax, -1), 1) * 32767) : 0;
        const vy = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[1] / vMax, -1), 1) * 32767) : 0;
        const vz = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[2] / vMax, -1), 1) * 32767) : 0;
        chunkView.setInt16(offset + 16, vx, true);
        chunkView.setInt16(offset + 18, vy, true);
        chunkView.setInt16(offset + 20, vz, true);

        const ax = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[0] / aMax, -1), 1) * 32767) : 0;
        const ay = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[1] / aMax, -1), 1) * 32767) : 0;
        const az = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[2] / aMax, -1), 1) * 32767) : 0;
        chunkView.setInt16(offset + 22, ax, true);
        chunkView.setInt16(offset + 24, ay, true);
        chunkView.setInt16(offset + 26, az, true);

        const hAmp = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[0] / ranges.harmonicMax[0], 0), 1) * 65535) : 0;
        const hFreq = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[1] / ranges.harmonicMax[1], 0), 1) * 65535) : 0;
        const hPhase = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[2] / ranges.harmonicMax[2], 0), 1) * 65535) : 0;
        chunkView.setUint16(offset + 28, hAmp, true);
        chunkView.setUint16(offset + 30, hFreq, true);
        chunkView.setUint16(offset + 32, hPhase, true);

        offset += 34;
      }
    } else {
      let offset = 0;
      for (let i = 0; i < dynamicCount; i++) {
        const g = dynamicList[i];
        chunkView.setFloat32(offset + 0, g.position[0], true);
        chunkView.setFloat32(offset + 4, g.position[1], true);
        chunkView.setFloat32(offset + 8, g.position[2], true);
        chunkView.setFloat32(offset + 12, g.scale[0], true);
        chunkView.setFloat32(offset + 16, g.scale[1], true);
        chunkView.setFloat32(offset + 20, g.scale[2], true);
        chunkView.setFloat32(offset + 24, g.color[0], true);
        chunkView.setFloat32(offset + 28, g.color[1], true);
        chunkView.setFloat32(offset + 32, g.color[2], true);
        chunkView.setFloat32(offset + 36, g.opacity, true);
        chunkView.setFloat32(offset + 40, g.motionP1 ? g.motionP1[0] : 0, true);
        chunkView.setFloat32(offset + 44, g.motionP1 ? g.motionP1[1] : 0, true);
        chunkView.setFloat32(offset + 48, g.motionP1 ? g.motionP1[2] : 0, true);
        chunkView.setFloat32(offset + 52, g.motionP2 ? g.motionP2[0] : 0, true);
        chunkView.setFloat32(offset + 56, g.motionP2 ? g.motionP2[1] : 0, true);
        chunkView.setFloat32(offset + 60, g.motionP2 ? g.motionP2[2] : 0, true);
        chunkView.setFloat32(offset + 64, g.motionP3 ? g.motionP3[0] : 0, true);
        chunkView.setFloat32(offset + 68, g.motionP3 ? g.motionP3[1] : 0, true);
        chunkView.setFloat32(offset + 72, g.motionP3 ? g.motionP3[2] : 0, true);
        offset += 76;
      }
    }

    const rawChunkBytes = new Uint8Array(rawChunkBuffer);
    preparedChunks.push({
      chunkId: c + 1,
      timeStart,
      timeEnd,
      gaussianCount: dynamicCount,
      flags: fileFlags & ~FourDVFlags.IS_COMPRESSED,
      rawBytes: rawChunkBytes,
      finalBytes: rawChunkBytes,
      uncompressedLength: rawChunkBytes.byteLength,
      byteLength: rawChunkBytes.byteLength,
    });
  }

  const totalTocEntries = preparedChunks.length;
  const metaJson = JSON.stringify({
    title,
    description,
    creationDate: new Date().toISOString(),
    generator: '4DV Studio Engine v1.0',
    fps,
    duration,
    frameCount,
    chunkDuration,
    compressChunks: false,
    numChunks: totalTocEntries,
  });
  const metaBytes = new TextEncoder().encode(metaJson);

  const headerSize = FOURDV_HEADER_SIZE;
  const tocSize = totalTocEntries * FOURDV_TOC_ENTRY_SIZE;

  let totalPayloadSize = 0;
  for (const chunk of preparedChunks) {
    totalPayloadSize += chunk.byteLength;
  }
  const metaBlockSize = 4 + metaBytes.length;
  const totalFileSize = headerSize + tocSize + totalPayloadSize + metaBlockSize;

  const fullBuffer = new ArrayBuffer(totalFileSize);
  const dataView = new DataView(fullBuffer);
  const uint8View = new Uint8Array(fullBuffer);

  // Write Header
  dataView.setUint32(0, FOURDV_MAGIC, true);
  dataView.setUint16(4, FOURDV_VERSION, true);
  dataView.setUint16(6, fileFlags & ~FourDVFlags.IS_COMPRESSED, true);
  dataView.setUint32(8, frameCount, true);
  dataView.setFloat32(12, fps, true);
  dataView.setFloat32(16, duration, true);
  dataView.setUint32(20, totalCount, true);
  dataView.setUint32(24, staticCount, true);
  dataView.setUint32(28, dynamicCount, true);

  dataView.setFloat32(32, ranges.boundsMin[0], true);
  dataView.setFloat32(36, ranges.boundsMin[1], true);
  dataView.setFloat32(40, ranges.boundsMin[2], true);
  dataView.setFloat32(44, ranges.boundsMax[0], true);
  dataView.setFloat32(48, ranges.boundsMax[1], true);
  dataView.setFloat32(52, ranges.boundsMax[2], true);

  dataView.setFloat32(56, ranges.scaleMax, true);
  dataView.setFloat32(60, ranges.velMax, true);
  dataView.setFloat32(64, ranges.accelMax, true);
  dataView.setFloat32(68, ranges.harmonicMax[0], true);
  dataView.setFloat32(72, ranges.harmonicMax[1], true);
  dataView.setFloat32(76, ranges.harmonicMax[2], true);

  const tocOffset = headerSize;
  dataView.setUint32(80, tocOffset, true);
  dataView.setUint32(84, totalTocEntries, true);
  dataView.setUint32(88, 0, true);
  dataView.setUint32(92, 0, true);

  // Write TOC Table & Payloads
  let currentPayloadOffset = headerSize + tocSize;
  let tocPtr = tocOffset;

  for (const chunk of preparedChunks) {
    const chunkOffset = currentPayloadOffset;

    dataView.setUint32(tocPtr + 0, chunk.chunkId, true);
    dataView.setFloat32(tocPtr + 4, chunk.timeStart, true);
    dataView.setFloat32(tocPtr + 8, chunk.timeEnd, true);
    dataView.setUint32(tocPtr + 12, chunkOffset, true);
    dataView.setUint32(tocPtr + 16, chunk.byteLength, true);
    dataView.setUint32(tocPtr + 20, chunk.uncompressedLength, true);
    dataView.setUint32(tocPtr + 24, chunk.gaussianCount, true);
    dataView.setUint32(tocPtr + 28, chunk.flags, true);

    uint8View.set(chunk.finalBytes, chunkOffset);

    currentPayloadOffset += chunk.byteLength;
    tocPtr += FOURDV_TOC_ENTRY_SIZE;
  }

  // Write Metadata Block
  dataView.setUint32(currentPayloadOffset, metaBytes.length, true);
  uint8View.set(metaBytes, currentPayloadOffset + 4);

  return uint8View;
}
