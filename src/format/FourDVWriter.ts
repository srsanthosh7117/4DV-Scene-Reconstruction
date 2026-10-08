import { Gaussian4DPolynomial } from '../renderer/types';
import { FOURDV_MAGIC, FOURDV_VERSION, FourDVFlags } from './fourdvSchema';
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
  const chunkDuration = options?.chunkDuration || 1.0; // 1 second per temporal chunk
  const compressChunks = options?.compressChunks === true;

  // 1. Separate Static / Dynamic Primitives
  const separated = separateStaticDynamicGaussians(gaussians, 0.0001);
  const staticList = [...separated.staticGaussians];
  const dynamicList = [...separated.dynamicGaussians];

  const totalCount = gaussians.length;
  const staticCount = staticList.length;
  const dynamicCount = dynamicList.length;

  // 2. Compute Scene Normalization Ranges
  const ranges = computeSceneRanges(gaussians);
  const dx = Math.max(ranges.boundsMax[0] - ranges.boundsMin[0], 0.0001);
  const dy = Math.max(ranges.boundsMax[1] - ranges.boundsMin[1], 0.0001);
  const dz = Math.max(ranges.boundsMax[2] - ranges.boundsMin[2], 0.0001);
  const sMax = Math.max(ranges.scaleMax, 0.0001);
  const vMax = Math.max(ranges.velMax, 0.0001);
  const aMax = Math.max(ranges.accelMax, 0.0001);

  // 3. Morton Spatial Sorting
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

  // 4. Calculate Chunks:
  // Chunk 0: Static Persistent Block
  // Chunks 1..N: Temporal Dynamic Chunks spanning [t_start, t_end]
  const numDynamicChunks = Math.max(1, Math.ceil(duration / chunkDuration));
  const totalTocEntries = 1 + numDynamicChunks;

  // 5. Serialize Static Chunk Payload
  const staticBytesPerElem = useQuantization ? 16 : 40;
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

  let finalStaticBytes: Uint8Array = new Uint8Array(rawStaticBuffer);
  if (compressChunks) {
    const compressed = await compressDeflate(finalStaticBytes);
    finalStaticBytes = new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
  }

  // 6. Serialize Dynamic Chunks Payload
  const dynamicBytesPerElem = useQuantization ? 34 : 76;
  const dynamicChunks: { timeStart: number; timeEnd: number; rawBytes: Uint8Array; finalBytes: Uint8Array }[] = [];

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

    let finalBytes: Uint8Array = new Uint8Array(rawChunkBuffer);
    if (compressChunks) {
      const compressed = await compressDeflate(finalBytes);
      finalBytes = new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    }

    dynamicChunks.push({
      timeStart,
      timeEnd,
      rawBytes: new Uint8Array(rawChunkBuffer),
      finalBytes,
    });
  }

  // 7. Serialize Metadata
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

  // 8. Assemble Full File Buffer with TOC
  const headerSize = 96;
  const tocSize = totalTocEntries * 32;

  let totalPayloadSize = finalStaticBytes.byteLength;
  for (const dc of dynamicChunks) {
    totalPayloadSize += dc.finalBytes.byteLength;
  }
  const metaBlockSize = 4 + metaBytes.length;

  const totalFileSize = headerSize + tocSize + totalPayloadSize + metaBlockSize;
  const fullBuffer = new ArrayBuffer(totalFileSize);
  const dataView = new DataView(fullBuffer);
  const uint8View = new Uint8Array(fullBuffer);

  // ---------------- Write Header (96B) ----------------
  dataView.setUint32(0, FOURDV_MAGIC, true);
  dataView.setUint16(4, FOURDV_VERSION, true);

  let flags = FourDVFlags.HAS_STATIC_SPLIT | FourDVFlags.HAS_SPATIAL_MORTON;
  if (useQuantization) flags |= FourDVFlags.IS_QUANTIZED;
  if (compressChunks) flags |= FourDVFlags.IS_COMPRESSED;

  dataView.setUint16(6, flags, true);
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

  // ---------------- Write TOC & Payloads ----------------
  let currentFileOffset = headerSize + tocSize;
  let tocPtr = tocOffset;

  // TOC Chunk 0: Static Block
  const staticUncompressedLen = rawStaticBuffer.byteLength;
  const staticCompressedLen = finalStaticBytes.byteLength;
  dataView.setUint32(tocPtr + 0, 0, true);                         // Chunk 0
  dataView.setFloat32(tocPtr + 4, 0.0, true);                      // Time Start 0.0
  dataView.setFloat32(tocPtr + 8, duration, true);                 // Time End duration
  dataView.setUint32(tocPtr + 12, currentFileOffset, true);        // Offset
  dataView.setUint32(tocPtr + 16, staticCompressedLen, true);      // Byte Length
  dataView.setUint32(tocPtr + 20, staticUncompressedLen, true);    // Uncompressed Length
  dataView.setUint32(tocPtr + 24, staticCount, true);              // Primitive Count
  dataView.setUint32(tocPtr + 28, flags, true);                    // Flags

  uint8View.set(finalStaticBytes, currentFileOffset);
  currentFileOffset += staticCompressedLen;
  tocPtr += 32;

  // TOC Chunks 1..N: Dynamic Blocks
  for (let c = 0; c < dynamicChunks.length; c++) {
    const dc = dynamicChunks[c];
    const chunkUncompressedLen = dc.rawBytes.byteLength;
    const chunkCompressedLen = dc.finalBytes.byteLength;

    dataView.setUint32(tocPtr + 0, c + 1, true);                     // Chunk ID
    dataView.setFloat32(tocPtr + 4, dc.timeStart, true);             // Time Start
    dataView.setFloat32(tocPtr + 8, dc.timeEnd, true);               // Time End
    dataView.setUint32(tocPtr + 12, currentFileOffset, true);        // Offset
    dataView.setUint32(tocPtr + 16, chunkCompressedLen, true);       // Byte Length
    dataView.setUint32(tocPtr + 20, chunkUncompressedLen, true);     // Uncompressed Length
    dataView.setUint32(tocPtr + 24, dynamicCount, true);             // Primitive Count
    dataView.setUint32(tocPtr + 28, flags, true);                    // Flags

    uint8View.set(dc.finalBytes, currentFileOffset);
    currentFileOffset += chunkCompressedLen;
    tocPtr += 32;
  }

  // ---------------- Write Metadata ----------------
  dataView.setUint32(currentFileOffset, metaBytes.length, true);
  uint8View.set(metaBytes, currentFileOffset + 4);

  return uint8View;
}

/**
 * Synchronous encoder wrapper.
 */
export function encode4DV(
  gaussians: Gaussian4DPolynomial[],
  options?: Encode4DVOptions
): Uint8Array {
  // Synchronous path (without async DEFLATE)
  const syncOptions: Encode4DVOptions = { ...options, compressChunks: false };
  let result: Uint8Array = new Uint8Array(0);

  // Run async internally in immediate promise
  encode4DVAsync(gaussians, syncOptions).then((res) => {
    result = res;
  });

  return result.byteLength > 0
    ? result
    : encode4DVSync(gaussians, syncOptions);
}

function encode4DVSync(
  gaussians: Gaussian4DPolynomial[],
  options?: Encode4DVOptions
): Uint8Array {
  const title = options?.title || 'Traversable 4DV Scene';
  const description = options?.description || 'Exported from 4DV Engine';
  const fps = options?.fps || 30.0;
  const duration = options?.duration || 5.0;
  const frameCount = Math.floor(duration * fps);
  const useQuantization = options?.useQuantization !== false;

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

  const metaJson = JSON.stringify({ title, description, creationDate: new Date().toISOString(), fps, duration, frameCount });
  const metaBytes = new TextEncoder().encode(metaJson);

  const headerSize = 96;
  const tocSize = 2 * 32; // Static chunk + 1 dynamic chunk
  const staticBytesPerElem = useQuantization ? 16 : 40;
  const dynamicBytesPerElem = useQuantization ? 34 : 76;
  const staticBlockSize = staticCount * staticBytesPerElem;
  const dynamicBlockSize = dynamicCount * dynamicBytesPerElem;
  const metaBlockSize = 4 + metaBytes.length;

  const totalFileSize = headerSize + tocSize + staticBlockSize + dynamicBlockSize + metaBlockSize;
  const buffer = new ArrayBuffer(totalFileSize);
  const view = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);

  let flags = FourDVFlags.HAS_STATIC_SPLIT | FourDVFlags.HAS_SPATIAL_MORTON;
  if (useQuantization) flags |= FourDVFlags.IS_QUANTIZED;

  view.setUint32(0, FOURDV_MAGIC, true);
  view.setUint16(4, FOURDV_VERSION, true);
  view.setUint16(6, flags, true);
  view.setUint32(8, frameCount, true);
  view.setFloat32(12, fps, true);
  view.setFloat32(16, duration, true);
  view.setUint32(20, totalCount, true);
  view.setUint32(24, staticCount, true);
  view.setUint32(28, dynamicCount, true);

  view.setFloat32(32, ranges.boundsMin[0], true);
  view.setFloat32(36, ranges.boundsMin[1], true);
  view.setFloat32(40, ranges.boundsMin[2], true);
  view.setFloat32(44, ranges.boundsMax[0], true);
  view.setFloat32(48, ranges.boundsMax[1], true);
  view.setFloat32(52, ranges.boundsMax[2], true);

  view.setFloat32(56, ranges.scaleMax, true);
  view.setFloat32(60, ranges.velMax, true);
  view.setFloat32(64, ranges.accelMax, true);
  view.setFloat32(68, ranges.harmonicMax[0], true);
  view.setFloat32(72, ranges.harmonicMax[1], true);
  view.setFloat32(76, ranges.harmonicMax[2], true);

  view.setUint32(80, headerSize, true);
  view.setUint32(84, 2, true);

  let offset = headerSize + tocSize;
  // Write Static TOC
  view.setUint32(headerSize + 0, 0, true);
  view.setFloat32(headerSize + 4, 0.0, true);
  view.setFloat32(headerSize + 8, duration, true);
  view.setUint32(headerSize + 12, offset, true);
  view.setUint32(headerSize + 16, staticBlockSize, true);
  view.setUint32(headerSize + 20, staticBlockSize, true);
  view.setUint32(headerSize + 24, staticCount, true);
  view.setUint32(headerSize + 28, flags, true);

  // Write Static Data
  if (useQuantization) {
    for (let i = 0; i < staticCount; i++) {
      const g = staticList[i];
      view.setUint16(offset + 0, Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535), true);
      view.setUint16(offset + 2, Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535), true);
      view.setUint16(offset + 4, Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535), true);
      view.setUint16(offset + 6, Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535), true);
      view.setUint16(offset + 8, Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535), true);
      view.setUint16(offset + 10, Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535), true);
      view.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
      view.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
      view.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));
      view.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));
      offset += 16;
    }
  }

  // Write Dynamic TOC
  const dynamicOffset = offset;
  view.setUint32(headerSize + 32 + 0, 1, true);
  view.setFloat32(headerSize + 32 + 4, 0.0, true);
  view.setFloat32(headerSize + 32 + 8, duration, true);
  view.setUint32(headerSize + 32 + 12, dynamicOffset, true);
  view.setUint32(headerSize + 32 + 16, dynamicBlockSize, true);
  view.setUint32(headerSize + 32 + 20, dynamicBlockSize, true);
  view.setUint32(headerSize + 32 + 24, dynamicCount, true);
  view.setUint32(headerSize + 32 + 28, flags, true);

  // Write Dynamic Data
  if (useQuantization) {
    for (let i = 0; i < dynamicCount; i++) {
      const g = dynamicList[i];
      view.setUint16(offset + 0, Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535), true);
      view.setUint16(offset + 2, Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535), true);
      view.setUint16(offset + 4, Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535), true);
      view.setUint16(offset + 6, Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535), true);
      view.setUint16(offset + 8, Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535), true);
      view.setUint16(offset + 10, Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535), true);
      view.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
      view.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
      view.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));
      view.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));

      view.setInt16(offset + 16, g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[0] / vMax, -1), 1) * 32767) : 0, true);
      view.setInt16(offset + 18, g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[1] / vMax, -1), 1) * 32767) : 0, true);
      view.setInt16(offset + 20, g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[2] / vMax, -1), 1) * 32767) : 0, true);

      view.setInt16(offset + 22, g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[0] / aMax, -1), 1) * 32767) : 0, true);
      view.setInt16(offset + 24, g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[1] / aMax, -1), 1) * 32767) : 0, true);
      view.setInt16(offset + 26, g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[2] / aMax, -1), 1) * 32767) : 0, true);

      view.setUint16(offset + 28, g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[0] / ranges.harmonicMax[0], 0), 1) * 65535) : 0, true);
      view.setUint16(offset + 30, g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[1] / ranges.harmonicMax[1], 0), 1) * 65535) : 0, true);
      view.setUint16(offset + 32, g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[2] / ranges.harmonicMax[2], 0), 1) * 65535) : 0, true);
      offset += 34;
    }
  }

  view.setUint32(offset, metaBytes.length, true);
  uint8View.set(metaBytes, offset + 4);

  return uint8View;
}
