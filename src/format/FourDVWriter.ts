import { Gaussian4DPolynomial } from '../renderer/types';
import { FOURDV_MAGIC, FOURDV_VERSION, FourDVFlags } from './fourdvSchema';
import { separateStaticDynamicGaussians } from './separation';
import { computeSceneRanges } from './quantization';
import { getMortonKey } from './morton';

export interface Encode4DVOptions {
  title?: string;
  description?: string;
  fps?: number;
  duration?: number;
  useQuantization?: boolean;
}

/**
 * Encodes 4D dynamic Gaussian scene into a standalone .4DV binary file buffer.
 * Performs static/dynamic classification, 16-bit/8-bit integer quantization,
 * and 3D Morton space-filling curve spatial reordering.
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
  const useQuantization = options?.useQuantization !== false; // Default true

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

  // 3. Morton Spatial Sorting for Optimal Cache Locality
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

  // 4. Serialize Metadata to JSON
  const metaJson = JSON.stringify({
    title,
    description,
    creationDate: new Date().toISOString(),
    generator: '4DV Studio Engine v1.0',
    fps,
    duration,
    frameCount,
    quantization: useQuantization
      ? { positionBits: 16, scaleBits: 16, colorBits: 8, opacityBits: 8, velocityBits: 16 }
      : 'Float32',
  });
  const metaBytes = new TextEncoder().encode(metaJson);

  // 5. Buffer Sizes:
  const headerSize = 96; // 96-byte Header
  const tocEntriesCount = 1;
  const tocSize = tocEntriesCount * 32;

  // Quantized: Static 16 bytes, Dynamic 34 bytes
  // Float32: Static 40 bytes, Dynamic 76 bytes
  const staticBytesPerElem = useQuantization ? 16 : 40;
  const dynamicBytesPerElem = useQuantization ? 34 : 76;

  const staticBlockSize = staticCount * staticBytesPerElem;
  const dynamicBlockSize = dynamicCount * dynamicBytesPerElem;
  const metaBlockSize = 4 + metaBytes.length;

  const totalFileSize = headerSize + tocSize + staticBlockSize + dynamicBlockSize + metaBlockSize;
  const buffer = new ArrayBuffer(totalFileSize);
  const dataView = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);

  // ---------------- Write Header (96B) ----------------
  dataView.setUint32(0, FOURDV_MAGIC, true);          // 0: Magic '4DV1'
  dataView.setUint16(4, FOURDV_VERSION, true);        // 4: Version 1

  let flags = FourDVFlags.HAS_STATIC_SPLIT | FourDVFlags.HAS_SPATIAL_MORTON;
  if (useQuantization) flags |= FourDVFlags.IS_QUANTIZED;

  dataView.setUint16(6, flags, true);                 // 6: Flags
  dataView.setUint32(8, frameCount, true);            // 8: Frame Count
  dataView.setFloat32(12, fps, true);                 // 12: FPS
  dataView.setFloat32(16, duration, true);            // 16: Duration (sec)
  dataView.setUint32(20, totalCount, true);           // 20: Total Gaussians
  dataView.setUint32(24, staticCount, true);          // 24: Static Gaussians
  dataView.setUint32(28, dynamicCount, true);         // 28: Dynamic Gaussians

  // Bounds (32..55)
  dataView.setFloat32(32, ranges.boundsMin[0], true);
  dataView.setFloat32(36, ranges.boundsMin[1], true);
  dataView.setFloat32(40, ranges.boundsMin[2], true);
  dataView.setFloat32(44, ranges.boundsMax[0], true);
  dataView.setFloat32(48, ranges.boundsMax[1], true);
  dataView.setFloat32(52, ranges.boundsMax[2], true);

  // Normalization Max Ranges (56..79)
  dataView.setFloat32(56, ranges.scaleMax, true);
  dataView.setFloat32(60, ranges.velMax, true);
  dataView.setFloat32(64, ranges.accelMax, true);
  dataView.setFloat32(68, ranges.harmonicMax[0], true);
  dataView.setFloat32(72, ranges.harmonicMax[1], true);
  dataView.setFloat32(76, ranges.harmonicMax[2], true);

  // TOC Pointers (80..87)
  const tocOffset = headerSize;
  dataView.setUint32(80, tocOffset, true);            // 80: TOC Offset
  dataView.setUint32(84, tocEntriesCount, true);      // 84: TOC Entries count
  dataView.setUint32(88, 0, true);                    // 88: Reserved
  dataView.setUint32(92, 0, true);                    // 92: Reserved

  // ---------------- Write TOC (32B) ----------------
  const dataOffset = headerSize + tocSize;
  const dynamicOffset = dataOffset + staticBlockSize;

  let tocPtr = tocOffset;
  dataView.setUint32(tocPtr + 0, 0, true);              // Chunk ID: 0
  dataView.setFloat32(tocPtr + 4, 0.0, true);           // Time Start: 0.0
  dataView.setFloat32(tocPtr + 8, duration, true);      // Time End: duration
  dataView.setUint32(tocPtr + 12, dataOffset, true);    // File Offset
  dataView.setUint32(tocPtr + 16, staticBlockSize + dynamicBlockSize, true); // Byte Length
  dataView.setUint32(tocPtr + 20, staticBlockSize + dynamicBlockSize, true); // Uncompressed Length
  dataView.setUint32(tocPtr + 24, totalCount, true);    // Gaussian Count
  dataView.setUint32(tocPtr + 28, flags, true);         // Chunk Flags

  // ---------------- Write Static Block ----------------
  let offset = dataOffset;
  if (useQuantization) {
    for (let i = 0; i < staticCount; i++) {
      const g = staticList[i];
      // 16-bit Position [0..65535] (6B)
      const qx = Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535);
      const qy = Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535);
      const qz = Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535);
      dataView.setUint16(offset + 0, qx, true);
      dataView.setUint16(offset + 2, qy, true);
      dataView.setUint16(offset + 4, qz, true);

      // 16-bit Scale [0..65535] (6B)
      const qsx = Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535);
      const qsy = Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535);
      const qsz = Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535);
      dataView.setUint16(offset + 6, qsx, true);
      dataView.setUint16(offset + 8, qsy, true);
      dataView.setUint16(offset + 10, qsz, true);

      // 8-bit Color (3B)
      dataView.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
      dataView.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
      dataView.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));

      // 8-bit Opacity (1B)
      dataView.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));

      offset += 16;
    }
  } else {
    for (let i = 0; i < staticCount; i++) {
      const g = staticList[i];
      dataView.setFloat32(offset + 0, g.position[0], true);
      dataView.setFloat32(offset + 4, g.position[1], true);
      dataView.setFloat32(offset + 8, g.position[2], true);
      dataView.setFloat32(offset + 12, g.scale[0], true);
      dataView.setFloat32(offset + 16, g.scale[1], true);
      dataView.setFloat32(offset + 20, g.scale[2], true);
      dataView.setFloat32(offset + 24, g.color[0], true);
      dataView.setFloat32(offset + 28, g.color[1], true);
      dataView.setFloat32(offset + 32, g.color[2], true);
      dataView.setFloat32(offset + 36, g.opacity, true);
      offset += 40;
    }
  }

  // ---------------- Write Dynamic Block ----------------
  offset = dynamicOffset;
  if (useQuantization) {
    for (let i = 0; i < dynamicCount; i++) {
      const g = dynamicList[i];
      // 16-bit Base Position (6B)
      const qx = Math.round(Math.min(Math.max((g.position[0] - ranges.boundsMin[0]) / dx, 0), 1) * 65535);
      const qy = Math.round(Math.min(Math.max((g.position[1] - ranges.boundsMin[1]) / dy, 0), 1) * 65535);
      const qz = Math.round(Math.min(Math.max((g.position[2] - ranges.boundsMin[2]) / dz, 0), 1) * 65535);
      dataView.setUint16(offset + 0, qx, true);
      dataView.setUint16(offset + 2, qy, true);
      dataView.setUint16(offset + 4, qz, true);

      // 16-bit Scale (6B)
      const qsx = Math.round(Math.min(Math.max(g.scale[0] / sMax, 0), 1) * 65535);
      const qsy = Math.round(Math.min(Math.max(g.scale[1] / sMax, 0), 1) * 65535);
      const qsz = Math.round(Math.min(Math.max(g.scale[2] / sMax, 0), 1) * 65535);
      dataView.setUint16(offset + 6, qsx, true);
      dataView.setUint16(offset + 8, qsy, true);
      dataView.setUint16(offset + 10, qsz, true);

      // 8-bit Color (3B)
      dataView.setUint8(offset + 12, Math.round(Math.min(Math.max(g.color[0], 0), 1) * 255));
      dataView.setUint8(offset + 13, Math.round(Math.min(Math.max(g.color[1], 0), 1) * 255));
      dataView.setUint8(offset + 14, Math.round(Math.min(Math.max(g.color[2], 0), 1) * 255));

      // 8-bit Opacity (1B)
      dataView.setUint8(offset + 15, Math.round(Math.min(Math.max(g.opacity, 0), 1) * 255));

      // 16-bit Velocity P1 (6B)
      const vx = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[0] / vMax, -1), 1) * 32767) : 0;
      const vy = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[1] / vMax, -1), 1) * 32767) : 0;
      const vz = g.motionP1 ? Math.round(Math.min(Math.max(g.motionP1[2] / vMax, -1), 1) * 32767) : 0;
      dataView.setInt16(offset + 16, vx, true);
      dataView.setInt16(offset + 18, vy, true);
      dataView.setInt16(offset + 20, vz, true);

      // 16-bit Accel P2 (6B)
      const ax = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[0] / aMax, -1), 1) * 32767) : 0;
      const ay = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[1] / aMax, -1), 1) * 32767) : 0;
      const az = g.motionP2 ? Math.round(Math.min(Math.max(g.motionP2[2] / aMax, -1), 1) * 32767) : 0;
      dataView.setInt16(offset + 22, ax, true);
      dataView.setInt16(offset + 24, ay, true);
      dataView.setInt16(offset + 26, az, true);

      // 16-bit Harmonic P3 (6B)
      const hAmp = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[0] / ranges.harmonicMax[0], 0), 1) * 65535) : 0;
      const hFreq = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[1] / ranges.harmonicMax[1], 0), 1) * 65535) : 0;
      const hPhase = g.motionP3 ? Math.round(Math.min(Math.max(g.motionP3[2] / ranges.harmonicMax[2], 0), 1) * 65535) : 0;
      dataView.setUint16(offset + 28, hAmp, true);
      dataView.setUint16(offset + 30, hFreq, true);
      dataView.setUint16(offset + 32, hPhase, true);

      offset += 34;
    }
  } else {
    for (let i = 0; i < dynamicCount; i++) {
      const g = dynamicList[i];
      dataView.setFloat32(offset + 0, g.position[0], true);
      dataView.setFloat32(offset + 4, g.position[1], true);
      dataView.setFloat32(offset + 8, g.position[2], true);
      dataView.setFloat32(offset + 12, g.scale[0], true);
      dataView.setFloat32(offset + 16, g.scale[1], true);
      dataView.setFloat32(offset + 20, g.scale[2], true);
      dataView.setFloat32(offset + 24, g.color[0], true);
      dataView.setFloat32(offset + 28, g.color[1], true);
      dataView.setFloat32(offset + 32, g.color[2], true);
      dataView.setFloat32(offset + 36, g.opacity, true);
      dataView.setFloat32(offset + 40, g.motionP1 ? g.motionP1[0] : 0, true);
      dataView.setFloat32(offset + 44, g.motionP1 ? g.motionP1[1] : 0, true);
      dataView.setFloat32(offset + 48, g.motionP1 ? g.motionP1[2] : 0, true);
      dataView.setFloat32(offset + 52, g.motionP2 ? g.motionP2[0] : 0, true);
      dataView.setFloat32(offset + 56, g.motionP2 ? g.motionP2[1] : 0, true);
      dataView.setFloat32(offset + 60, g.motionP2 ? g.motionP2[2] : 0, true);
      dataView.setFloat32(offset + 64, g.motionP3 ? g.motionP3[0] : 0, true);
      dataView.setFloat32(offset + 68, g.motionP3 ? g.motionP3[1] : 0, true);
      dataView.setFloat32(offset + 72, g.motionP3 ? g.motionP3[2] : 0, true);
      offset += 76;
    }
  }

  // ---------------- Write Metadata Block ----------------
  dataView.setUint32(offset, metaBytes.length, true);
  uint8View.set(metaBytes, offset + 4);

  return uint8View;
}
