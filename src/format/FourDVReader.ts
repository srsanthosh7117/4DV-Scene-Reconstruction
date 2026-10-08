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
  FourDVHeader,
  FourDVTocEntry,
  Decoded4DScene,
} from './fourdvSchema';
import { decompressDeflate } from './deflate';

/**
 * Reusable bounds-checking utility to prevent DataView RangeErrors.
 */
export function checkBounds(dataView: DataView, offset: number, byteLength: number, fieldName: string) {
  if (offset < 0 || byteLength < 0 || offset + byteLength > dataView.byteLength) {
    throw new Error(
      `4DV_FORMAT_ERROR: field=${fieldName} offset=${offset} size=${byteLength} fileSize=${dataView.byteLength}`
    );
  }
}

/**
 * Finds the TOC chunk entry responsible for a specific playback time.
 */
export function getChunkForTime(toc: FourDVTocEntry[], time: number): FourDVTocEntry | null {
  for (const entry of toc) {
    if (entry.chunkId > 0 && time >= entry.timeStart && time <= entry.timeEnd) {
      return entry;
    }
  }
  return toc.find((e) => e.chunkId > 0) || null;
}

/**
 * Detects if the buffer uses the JSON-header variant (e.g. from Python encoders like fourdv_encode.py).
 * In the JSON variant:
 * - Bytes 0..3: '4DV1' magic
 * - Bytes 4..7: version (uint32)
 * - Bytes 8..11: json_len (uint32)
 * - Bytes 12..: UTF-8 JSON text starting with '{' (0x7B)
 */
export function isJsonHeaderVariant(dataView: DataView): boolean {
  if (dataView.byteLength < 14) return false;
  const magic = dataView.getUint32(0, true);
  if (magic !== FOURDV_MAGIC && magic !== 0x34445631) return false;
  const b12 = dataView.getUint8(12);
  return b12 === 0x7b; // ASCII '{'
}

/**
 * Parses Python / JSON-Header variant metadata from .4DV container.
 */
export function parseJsonHeaderVariant(buffer: ArrayBuffer | Uint8Array): {
  header: FourDVHeader;
  json: Record<string, any>;
  binaryOffset: number;
} {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const totalByteLength = buffer.byteLength;
  const dataView = new DataView(arrayBuffer, byteOffset, totalByteLength);

  checkBounds(dataView, 0, 12, 'jsonVariantHeaderPrefix');
  const magic = dataView.getUint32(0, true);
  const version = dataView.getUint32(4, true);
  const jsonLen = dataView.getUint32(8, true);

  if (12 + jsonLen > totalByteLength) {
    throw new Error(
      `4DV_FORMAT_ERROR: JSON header length ${jsonLen} extends beyond file size ${totalByteLength}`
    );
  }

  const jsonBytes = new Uint8Array(arrayBuffer, byteOffset + 12, jsonLen);
  const jsonText = new TextDecoder('utf-8').decode(jsonBytes);
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`4DV_FORMAT_ERROR: Failed to parse JSON header: ${err instanceof Error ? err.message : String(err)}`);
  }

  const frameCount = json.frameCount ?? json.frame_count ?? json.num_frames ?? json.frames ?? 30;
  const fps = json.fps ?? json.frame_rate ?? json.FPS ?? 30.0;
  const duration = json.duration ?? json.time_end ?? json.duration_sec ?? 5.0;

  const totalGaussians =
    json.totalGaussians ??
    json.total_gaussians ??
    json.num_gaussians ??
    json.gaussian_count ??
    json.count ??
    0;
  const staticGaussians =
    json.staticGaussians ?? json.static_gaussians ?? json.num_static ?? json.static_count ?? 0;
  const dynamicGaussians =
    json.dynamicGaussians ??
    json.dynamic_gaussians ??
    json.num_dynamic ??
    json.dynamic_count ??
    (totalGaussians > staticGaussians ? totalGaussians - staticGaussians : totalGaussians);

  const boundsMin: [number, number, number] = json.boundsMin ?? json.bounds_min ?? json.bbox_min ?? json.min_bounds ?? [-5, -5, -5];
  const boundsMax: [number, number, number] = json.boundsMax ?? json.bounds_max ?? json.bbox_max ?? json.max_bounds ?? [5, 5, 5];
  const scaleMax = json.scaleMax ?? json.scale_max ?? json.max_scale ?? 1.0;
  const velMax = json.velMax ?? json.vel_max ?? json.max_vel ?? json.velocity_max ?? 1.0;
  const accelMax = json.accelMax ?? json.accel_max ?? json.max_accel ?? 1.0;
  const harmonicMax: [number, number, number] = json.harmonicMax ?? json.harmonic_max ?? json.harmonics ?? [1.0, 1.0, Math.PI * 2];

  const binaryOffset = 12 + jsonLen;
  const binaryLength = totalByteLength - binaryOffset;

  const recordStride = json.record_size ?? json.stride ?? json.bytes_per_gaussian ?? (totalGaussians > 0 ? Math.floor(binaryLength / totalGaussians) : 32);
  const effectiveTotal = totalGaussians || Math.floor(binaryLength / (recordStride || 32));

  const chunksCount = Array.isArray(json.chunks) ? json.chunks.length : (Array.isArray(json.toc) ? json.toc.length : 1);

  const header: FourDVHeader = {
    magic,
    version: typeof version === 'number' ? version : 1,
    flags: FourDVFlags.HAS_STATIC_SPLIT | (json.compressed ? FourDVFlags.IS_COMPRESSED : 0) | (json.quantized ? FourDVFlags.IS_QUANTIZED : 0),
    frameCount,
    fps: fps > 0 ? fps : 30.0,
    duration: duration > 0 ? duration : 5.0,
    totalGaussians: effectiveTotal,
    staticGaussians: staticGaussians || 0,
    dynamicGaussians: dynamicGaussians || effectiveTotal,
    boundsMin,
    boundsMax,
    scaleMax: scaleMax || 1.0,
    velMax: velMax || 1.0,
    accelMax: accelMax || 1.0,
    harmonicMax: Array.isArray(harmonicMax) && harmonicMax.length === 3 ? harmonicMax : [1.0, 1.0, Math.PI * 2],
    tocOffset: binaryOffset,
    tocEntries: chunksCount,
  };

  console.log(`[4DV] Detected JSON-Header Variant (jsonSize=${jsonLen}B, totalGaussians=${effectiveTotal}, duration=${header.duration}s, fps=${header.fps})`);

  return { header, json, binaryOffset };
}

/**
 * Parses container header (96 bytes binary OR auto-detecting JSON header) from .4DV buffer.
 */
export function parseHeader(buffer: ArrayBuffer | Uint8Array): FourDVHeader {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const totalByteLength = buffer.byteLength;

  if (totalByteLength < 14) {
    throw new Error(
      `4DV_FORMAT_ERROR: Buffer too small for .4DV header. size=${totalByteLength} required>=14`
    );
  }

  const dataView = new DataView(arrayBuffer, byteOffset, totalByteLength);

  // 0. Auto-detect Python / JSON-Header Variant
  if (isJsonHeaderVariant(dataView)) {
    return parseJsonHeaderVariant(buffer).header;
  }

  if (totalByteLength < FOURDV_HEADER_SIZE) {
    throw new Error(
      `4DV_FORMAT_ERROR: Buffer too small for canonical 96-byte .4DV header. size=${totalByteLength} required=${FOURDV_HEADER_SIZE}`
    );
  }

  // 1. Validate Magic '4DV1'
  checkBounds(dataView, 0, 4, 'magic');
  const magic = dataView.getUint32(0, true);
  if (magic !== FOURDV_MAGIC && magic !== 0x34445631) {
    throw new Error(
      `4DV_FORMAT_ERROR: Invalid container magic. Expected 0x${FOURDV_MAGIC.toString(16)} ('4DV1'), received 0x${magic.toString(16)}.`
    );
  }

  // 2. Validate Version
  checkBounds(dataView, 4, 2, 'version');
  const version = dataView.getUint16(4, true);
  if (version > FOURDV_VERSION) {
    throw new Error(`4DV_FORMAT_ERROR: Unsupported .4DV version ${version}. Max supported is ${FOURDV_VERSION}.`);
  }

  checkBounds(dataView, 6, 2, 'flags');
  const flags = dataView.getUint16(6, true);

  checkBounds(dataView, 8, 24, 'countsAndTimeline');
  const frameCount = dataView.getUint32(8, true);
  const fps = dataView.getFloat32(12, true);
  const duration = dataView.getFloat32(16, true);
  const totalGaussians = dataView.getUint32(20, true);
  const staticGaussians = dataView.getUint32(24, true);
  const dynamicGaussians = dataView.getUint32(28, true);

  checkBounds(dataView, 32, 48, 'rangesAndBounds');
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

  checkBounds(dataView, 80, 8, 'tocPointer');
  const tocOffset = dataView.getUint32(80, true);
  const tocEntriesCount = dataView.getUint32(84, true);

  if (tocOffset < FOURDV_HEADER_SIZE || tocOffset > totalByteLength) {
    throw new Error(`4DV_FORMAT_ERROR: Invalid tocOffset ${tocOffset}. File size is ${totalByteLength}.`);
  }
  if (tocEntriesCount < 1) {
    throw new Error(`4DV_FORMAT_ERROR: Invalid tocEntries count ${tocEntriesCount}.`);
  }

  const header: FourDVHeader = {
    magic,
    version,
    flags,
    frameCount,
    fps: fps > 0 ? fps : 30.0,
    duration: duration > 0 ? duration : 5.0,
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

  console.log(`[4DV] Magic: 0x${magic.toString(16)} ('4DV1')`);
  console.log(`[4DV] Version: ${version}`);
  console.log(`[4DV] Header size: ${FOURDV_HEADER_SIZE}B`);
  console.log(`[4DV] Frame count: ${frameCount} | FPS: ${header.fps} | Duration: ${header.duration}s`);
  console.log(`[4DV] Static Gaussians: ${staticGaussians} | Dynamic Gaussians: ${dynamicGaussians}`);
  console.log(`[4DV] Header validated ✓`);

  return header;
}

/**
 * Parses Table of Contents (TOC) entries table from .4DV buffer.
 */
export function parseToc(buffer: ArrayBuffer | Uint8Array, header: FourDVHeader): FourDVTocEntry[] {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const totalByteLength = buffer.byteLength;

  const dataView = new DataView(arrayBuffer, byteOffset, totalByteLength);

  // Auto-detect JSON-Header Variant
  if (isJsonHeaderVariant(dataView)) {
    const { json, binaryOffset } = parseJsonHeaderVariant(buffer);
    const chunks = json.chunks || json.toc;

    if (Array.isArray(chunks) && chunks.length > 0) {
      const toc: FourDVTocEntry[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const chunkId = c.chunk_id ?? c.id ?? (i + 1);
        const timeStart = c.time_start ?? c.start_time ?? 0.0;
        const timeEnd = c.time_end ?? c.end_time ?? header.duration;
        const fileOffset = binaryOffset + (c.offset ?? c.file_offset ?? 0);
        const byteLength = c.size ?? c.byte_length ?? c.length ?? 0;
        const uncompressedLength = c.uncompressed_size ?? c.raw_size ?? byteLength;
        const gaussianCount = c.count ?? c.gaussian_count ?? c.num_gaussians ?? header.dynamicGaussians;
        const flags = c.flags ?? (c.compressed ? FourDVFlags.IS_COMPRESSED : 0);

        toc.push({
          chunkId,
          timeStart,
          timeEnd,
          fileOffset,
          byteLength,
          uncompressedLength,
          gaussianCount,
          flags,
        });
      }
      return toc;
    }

    return [
      {
        chunkId: 1,
        timeStart: 0.0,
        timeEnd: header.duration,
        fileOffset: binaryOffset,
        byteLength: totalByteLength - binaryOffset,
        uncompressedLength: totalByteLength - binaryOffset,
        gaussianCount: header.totalGaussians,
        flags: 0,
      },
    ];
  }

  const tocSize = header.tocEntries * FOURDV_TOC_ENTRY_SIZE;
  checkBounds(dataView, header.tocOffset, tocSize, 'TOC_TABLE');

  const toc: FourDVTocEntry[] = [];
  for (let i = 0; i < header.tocEntries; i++) {
    const ptr = header.tocOffset + i * FOURDV_TOC_ENTRY_SIZE;
    checkBounds(dataView, ptr, FOURDV_TOC_ENTRY_SIZE, `TOC_ENTRY_${i}`);

    const chunkId = dataView.getUint32(ptr + 0, true);
    const timeStart = dataView.getFloat32(ptr + 4, true);
    const timeEnd = dataView.getFloat32(ptr + 8, true);
    const fileOffset = dataView.getUint32(ptr + 12, true);
    const byteLength = dataView.getUint32(ptr + 16, true);
    const uncompressedLength = dataView.getUint32(ptr + 20, true);
    const gaussianCount = dataView.getUint32(ptr + 24, true);
    const flags = dataView.getUint32(ptr + 28, true);

    // Validate chunk boundaries inside file
    if (fileOffset < header.tocOffset + tocSize || fileOffset + byteLength > totalByteLength) {
      throw new Error(
        `4DV_FORMAT_ERROR: Chunk #${chunkId} offset bounds invalid. offset=${fileOffset} byteLength=${byteLength} fileSize=${totalByteLength}`
      );
    }

    toc.push({
      chunkId,
      timeStart,
      timeEnd,
      fileOffset,
      byteLength,
      uncompressedLength,
      gaussianCount,
      flags,
    });
  }

  console.log(`[4DV] TOC offset: ${header.tocOffset} | TOC size: ${tocSize}B | Entries: ${toc.length}`);
  for (const entry of toc) {
    console.log(
      `[4DV] Chunk ${entry.chunkId}: offset=${entry.fileOffset} byteLength=${entry.byteLength} uncompressedLength=${entry.uncompressedLength} time=[${entry.timeStart}s, ${entry.timeEnd}s] count=${entry.gaussianCount}`
    );
  }
  console.log(`[4DV] TOC validated ✓`);

  return toc;
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
  const containerByteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const containerTotalLength = buffer.byteLength;

  if (entry.fileOffset + entry.byteLength > containerTotalLength) {
    throw new Error(
      `4DV_FORMAT_ERROR: Chunk payload out of bounds. offset=${entry.fileOffset} len=${entry.byteLength} containerSize=${containerTotalLength}`
    );
  }

  // 1. Extract Chunk Payload Bytes
  let chunkBytes = new Uint8Array(arrayBuffer, containerByteOffset + entry.fileOffset, entry.byteLength);

  // 2. Decompress if compressed
  const isCompressed = (entry.flags & FourDVFlags.IS_COMPRESSED) !== 0 || (header.flags & FourDVFlags.IS_COMPRESSED) !== 0;
  if (isCompressed) {
    chunkBytes = await decompressDeflate(chunkBytes);
    if (chunkBytes.byteLength !== entry.uncompressedLength) {
      throw new Error(
        `4DV_FORMAT_ERROR: Decompressed length mismatch. expected=${entry.uncompressedLength} got=${chunkBytes.byteLength}`
      );
    }
  }

  const isStatic = entry.chunkId === 0;
  const isQuantized = (entry.flags & FourDVFlags.IS_QUANTIZED) !== 0 || (header.flags & FourDVFlags.IS_QUANTIZED) !== 0;
  const dataView = new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength);

  const dx = Math.max(header.boundsMax[0] - header.boundsMin[0], 0.0001);
  const dy = Math.max(header.boundsMax[1] - header.boundsMin[1], 0.0001);
  const dz = Math.max(header.boundsMax[2] - header.boundsMin[2], 0.0001);
  const sMax = Math.max(header.scaleMax, 0.0001);
  const vMax = Math.max(header.velMax, 0.0001);
  const aMax = Math.max(header.accelMax, 0.0001);

  if (isStatic) {
    const staticCount = entry.gaussianCount;
    const bytesPerElem = isQuantized ? STATIC_GAUSSIAN_QUANTIZED_BYTES : STATIC_GAUSSIAN_FLOAT32_BYTES;
    checkBounds(dataView, 0, staticCount * bytesPerElem, 'STATIC_CHUNK_DATA');

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
    const stride = dynamicCount > 0 ? Math.floor(chunkBytes.byteLength / dynamicCount) : 34;

    const outFloats = new Float32Array(dynamicCount * 19);

    if (stride === 32) {
      let offset = 0;
      for (let i = 0; i < dynamicCount; i++) {
        const dst = i * 19;
        const fx = dataView.getFloat32(offset + 0, true);
        const fy = dataView.getFloat32(offset + 4, true);
        const fz = dataView.getFloat32(offset + 8, true);
        const isFloatPos =
          isFinite(fx) && isFinite(fy) && isFinite(fz) && Math.abs(fx) < 10000 && Math.abs(fy) < 10000 && Math.abs(fz) < 10000;

        if (isFloatPos) {
          outFloats[dst + 0] = fx;
          outFloats[dst + 1] = fy;
          outFloats[dst + 2] = fz;

          outFloats[dst + 3] = (dataView.getUint16(offset + 12, true) / 65535) * sMax;
          outFloats[dst + 4] = (dataView.getUint16(offset + 14, true) / 65535) * sMax;
          outFloats[dst + 5] = (dataView.getUint16(offset + 16, true) / 65535) * sMax;

          outFloats[dst + 6] = dataView.getUint8(offset + 18) / 255;
          outFloats[dst + 7] = dataView.getUint8(offset + 19) / 255;
          outFloats[dst + 8] = dataView.getUint8(offset + 20) / 255;
          outFloats[dst + 9] = dataView.getUint8(offset + 21) / 255;

          outFloats[dst + 10] = (dataView.getInt16(offset + 22, true) / 32767) * vMax;
          outFloats[dst + 11] = (dataView.getInt16(offset + 24, true) / 32767) * vMax;
          outFloats[dst + 12] = (dataView.getInt16(offset + 26, true) / 32767) * vMax;

          outFloats[dst + 13] = (dataView.getInt16(offset + 28, true) / 32767) * aMax;
          outFloats[dst + 14] = (dataView.getInt16(offset + 30, true) / 32767) * aMax;
          outFloats[dst + 15] = 0;
          outFloats[dst + 16] = 0;
          outFloats[dst + 17] = 0;
          outFloats[dst + 18] = 0;
        } else {
          outFloats[dst + 0] = header.boundsMin[0] + (dataView.getUint16(offset + 0, true) / 65535) * dx;
          outFloats[dst + 1] = header.boundsMin[1] + (dataView.getUint16(offset + 2, true) / 65535) * dy;
          outFloats[dst + 2] = header.boundsMin[2] + (dataView.getUint16(offset + 4, true) / 65535) * dz;

          outFloats[dst + 3] = (dataView.getUint16(offset + 6, true) / 65535) * sMax;
          outFloats[dst + 4] = (dataView.getUint16(offset + 8, true) / 65535) * sMax;
          outFloats[dst + 5] = (dataView.getUint16(offset + 10, true) / 65535) * sMax;

          outFloats[dst + 6] = dataView.getUint8(offset + 12) / 255;
          outFloats[dst + 7] = dataView.getUint8(offset + 13) / 255;
          outFloats[dst + 8] = dataView.getUint8(offset + 14) / 255;
          outFloats[dst + 9] = dataView.getUint8(offset + 15) / 255;

          outFloats[dst + 10] = (dataView.getInt16(offset + 16, true) / 32767) * vMax;
          outFloats[dst + 11] = (dataView.getInt16(offset + 18, true) / 32767) * vMax;
          outFloats[dst + 12] = (dataView.getInt16(offset + 20, true) / 32767) * vMax;

          outFloats[dst + 13] = (dataView.getInt16(offset + 22, true) / 32767) * aMax;
          outFloats[dst + 14] = (dataView.getInt16(offset + 24, true) / 32767) * aMax;
          outFloats[dst + 15] = (dataView.getInt16(offset + 26, true) / 32767) * aMax;

          outFloats[dst + 16] = (dataView.getUint16(offset + 28, true) / 65535) * header.harmonicMax[0];
          outFloats[dst + 17] = (dataView.getUint16(offset + 30, true) / 65535) * header.harmonicMax[1];
          outFloats[dst + 18] = 0;
        }
        offset += 32;
      }
    } else if (isQuantized || stride === 34) {
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
 * Asynchronously decodes full .4DV container buffer with multi-chunk DEFLATE decompression.
 */
export async function decode4DVAsync(buffer: ArrayBuffer | Uint8Array): Promise<Decoded4DScene> {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const totalByteLength = buffer.byteLength;
  const dataView = new DataView(arrayBuffer, byteOffset, totalByteLength);

  console.log(`[4DV] File size: ${totalByteLength}B`);

  // 1. Parse & Validate Header
  const header = parseHeader(buffer);

  // 2. Parse & Validate TOC
  const toc = parseToc(buffer, header);

  const staticGaussians = header.staticGaussians;
  const dynamicGaussians = header.dynamicGaussians;
  const totalGaussians = header.totalGaussians;

  // 3. Decompress & Decode Static Chunk (Chunk 0 if present)
  const staticEntry = toc.find((e) => e.chunkId === 0);
  const staticFloats =
    staticEntry && staticGaussians > 0
      ? await readChunkAsync(buffer, staticEntry, header)
      : new Float32Array(0);

  // 4. Decompress & Decode Dynamic Chunks
  const dynamicEntries = toc.filter((e) => e.chunkId > 0);
  let dynamicFloats: Float32Array;

  if (dynamicEntries.length > 0) {
    dynamicFloats = await readChunkAsync(buffer, dynamicEntries[0], header);
  } else if (toc.length > 0) {
    dynamicFloats = await readChunkAsync(buffer, toc[0], header);
  } else {
    dynamicFloats = new Float32Array(dynamicGaussians * 19);
  }

  // 5. Build Unified Interleaved GPU Array
  const allGaussiansPacked = new Float32Array(totalGaussians * 19);
  if (staticGaussians > 0 && staticFloats.length >= staticGaussians * 10) {
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
  }

  const dynamicDstStart = staticGaussians > 0 ? staticGaussians * 19 : 0;
  const copyCount = Math.min(dynamicFloats.length, allGaussiansPacked.length - dynamicDstStart);
  if (copyCount > 0) {
    allGaussiansPacked.set(dynamicFloats.subarray(0, copyCount), dynamicDstStart);
  }

  // 6. Metadata
  let metadata: Decoded4DScene['metadata'] = {
    title: '4DV Scene',
    description: '',
    creationDate: '',
  };

  if (isJsonHeaderVariant(dataView)) {
    const { json } = parseJsonHeaderVariant(buffer);
    metadata = {
      title: json.title || json.name || '4DV Dynamic Scene',
      description: json.description || 'Decoded from JSON-header .4DV container',
      creationDate: json.creation_date || new Date().toISOString(),
      generator: json.generator || 'Python fourdv_encode.py',
      fps: header.fps,
      duration: header.duration,
      frameCount: header.frameCount,
    };
  } else {
    const lastChunk = toc[toc.length - 1];
    const metaStart = lastChunk.fileOffset + lastChunk.byteLength;
    if (metaStart + 4 <= totalByteLength) {
      const metaLen = dataView.getUint32(metaStart, true);
      if (metaStart + 4 + metaLen <= totalByteLength) {
        const metaBytes = new Uint8Array(arrayBuffer, byteOffset + metaStart + 4, metaLen);
        try {
          const jsonStr = new TextDecoder().decode(metaBytes);
          metadata = { ...metadata, ...JSON.parse(jsonStr) };
        } catch (e) {
          console.warn('[4DV] Failed to parse JSON metadata block:', e);
        }
      }
    }
  }

  console.log(`[4DV] Scene decoded ✓ (${totalGaussians} total Gaussians, ${staticGaussians} static, ${dynamicGaussians} dynamic)`);

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
 * Synchronous decoder for uncompressed .4DV buffers.
 */
export function decode4DV(buffer: ArrayBuffer | Uint8Array): Decoded4DScene {
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const byteOffset = buffer instanceof Uint8Array ? buffer.byteOffset : 0;
  const totalByteLength = buffer.byteLength;

  const header = parseHeader(buffer);
  const toc = parseToc(buffer, header);

  const staticGaussians = header.staticGaussians;
  const dynamicGaussians = header.dynamicGaussians;
  const totalGaussians = header.totalGaussians;

  const staticEntry = toc.find((e) => e.chunkId === 0) || toc[0];
  const dynamicEntry = toc.find((e) => e.chunkId > 0) || toc[1] || toc[0];

  const isQuantized = (header.flags & FourDVFlags.IS_QUANTIZED) !== 0;
  const dx = Math.max(header.boundsMax[0] - header.boundsMin[0], 0.0001);
  const dy = Math.max(header.boundsMax[1] - header.boundsMin[1], 0.0001);
  const dz = Math.max(header.boundsMax[2] - header.boundsMin[2], 0.0001);
  const sMax = Math.max(header.scaleMax, 0.0001);
  const vMax = Math.max(header.velMax, 0.0001);
  const aMax = Math.max(header.accelMax, 0.0001);

  const dataView = new DataView(arrayBuffer, byteOffset, totalByteLength);

  // 1. Static Floats
  const staticFloats = new Float32Array(staticGaussians * 10);
  const staticDataStart = staticEntry.fileOffset;
  const staticBytesPerElem = isQuantized ? STATIC_GAUSSIAN_QUANTIZED_BYTES : STATIC_GAUSSIAN_FLOAT32_BYTES;
  checkBounds(dataView, staticDataStart, staticGaussians * staticBytesPerElem, 'STATIC_DATA');

  if (isQuantized) {
    let offset = staticDataStart;
    for (let i = 0; i < staticGaussians; i++) {
      const dst = i * 10;
      staticFloats[dst + 0] = header.boundsMin[0] + (dataView.getUint16(offset + 0, true) / 65535) * dx;
      staticFloats[dst + 1] = header.boundsMin[1] + (dataView.getUint16(offset + 2, true) / 65535) * dy;
      staticFloats[dst + 2] = header.boundsMin[2] + (dataView.getUint16(offset + 4, true) / 65535) * dz;
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

  // 2. Dynamic Floats
  const dynamicFloats = new Float32Array(dynamicGaussians * 19);
  if (dynamicGaussians > 0 && dynamicEntry) {
    const dynamicDataStart = dynamicEntry.fileOffset;
    const dynamicBytesPerElem = isQuantized ? DYNAMIC_GAUSSIAN_QUANTIZED_BYTES : DYNAMIC_GAUSSIAN_FLOAT32_BYTES;
    checkBounds(dataView, dynamicDataStart, dynamicGaussians * dynamicBytesPerElem, 'DYNAMIC_DATA');

    if (isQuantized) {
      let offset = dynamicDataStart;
      for (let i = 0; i < dynamicGaussians; i++) {
        const dst = i * 19;
        dynamicFloats[dst + 0] = header.boundsMin[0] + (dataView.getUint16(offset + 0, true) / 65535) * dx;
        dynamicFloats[dst + 1] = header.boundsMin[1] + (dataView.getUint16(offset + 2, true) / 65535) * dy;
        dynamicFloats[dst + 2] = header.boundsMin[2] + (dataView.getUint16(offset + 4, true) / 65535) * dz;
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
  }

  // 3. Packed Array
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
