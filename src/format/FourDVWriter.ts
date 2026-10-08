import { Gaussian4DPolynomial } from '../renderer/types';
import { FOURDV_MAGIC, FOURDV_VERSION, FourDVFlags } from './fourdvSchema';
import { separateStaticDynamicGaussians } from './separation';
import { computeSceneBounds } from './quantization';

export interface Encode4DVOptions {
  title?: string;
  description?: string;
  fps?: number;
  duration?: number;
}

/**
 * Encodes 4D dynamic Gaussian scene into a standalone .4DV binary file buffer.
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

  // 1. Separate Static / Dynamic
  const separated = separateStaticDynamicGaussians(gaussians, 0.0001);
  const staticList = separated.staticGaussians;
  const dynamicList = separated.dynamicGaussians;

  const totalCount = gaussians.length;
  const staticCount = staticList.length;
  const dynamicCount = dynamicList.length;

  // 2. Compute Bounds
  const bounds = computeSceneBounds(gaussians);

  // 3. Serialize metadata to UTF-8 JSON
  const metaJson = JSON.stringify({
    title,
    description,
    creationDate: new Date().toISOString(),
    generator: '4DV Player Hackathon Suite v1.0',
    fps,
    duration,
    frameCount,
  });
  const metaBytes = new TextEncoder().encode(metaJson);

  // 4. Calculate buffer sizes:
  // Header: 64 bytes
  const headerSize = 64;

  // Static Block: 10 floats per static Gaussian (40 bytes each)
  const staticBlockSize = staticCount * 10 * 4;

  // Dynamic Block: 19 floats per dynamic Gaussian (76 bytes each)
  const dynamicBlockSize = dynamicCount * 19 * 4;

  // TOC: 1 chunk entry for single container = 32 bytes
  const tocEntriesCount = 1;
  const tocSize = tocEntriesCount * 32;

  // Metadata block: 4 bytes length + metaBytes.length
  const metaBlockSize = 4 + metaBytes.length;

  const totalFileSize = headerSize + tocSize + staticBlockSize + dynamicBlockSize + metaBlockSize;
  const buffer = new ArrayBuffer(totalFileSize);
  const dataView = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);

  // ---------------- Write Header (64B) ----------------
  dataView.setUint32(0, FOURDV_MAGIC, true);          // 0: Magic '4DV1'
  dataView.setUint16(4, FOURDV_VERSION, true);        // 4: Version 1
  dataView.setUint16(6, FourDVFlags.HAS_STATIC_SPLIT, true); // 6: Flags
  dataView.setUint32(8, frameCount, true);            // 8: Frame Count
  dataView.setFloat32(12, fps, true);                 // 12: FPS
  dataView.setFloat32(16, duration, true);            // 16: Duration (sec)
  dataView.setUint32(20, totalCount, true);           // 20: Total Gaussians
  dataView.setUint32(24, staticCount, true);          // 24: Static Gaussians
  dataView.setUint32(28, dynamicCount, true);         // 28: Dynamic Gaussians

  // Bounds (32..55)
  dataView.setFloat32(32, bounds.min[0], true);
  dataView.setFloat32(36, bounds.min[1], true);
  dataView.setFloat32(40, bounds.min[2], true);
  dataView.setFloat32(44, bounds.max[0], true);
  dataView.setFloat32(48, bounds.max[1], true);
  dataView.setFloat32(52, bounds.max[2], true);

  // TOC Pointers
  const tocOffset = headerSize;
  dataView.setUint32(56, tocOffset, true);            // 56: TOC Offset
  dataView.setUint32(60, tocEntriesCount, true);      // 60: TOC Entries count

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
  dataView.setUint32(tocPtr + 28, 0, true);             // Reserved

  // ---------------- Write Static Block ----------------
  let offset = dataOffset;
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

  // ---------------- Write Dynamic Block ----------------
  offset = dynamicOffset;
  for (let i = 0; i < dynamicCount; i++) {
    const g = dynamicList[i];
    // Base 3D
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

    // Temporal coefficients P1
    dataView.setFloat32(offset + 40, g.motionP1 ? g.motionP1[0] : 0, true);
    dataView.setFloat32(offset + 44, g.motionP1 ? g.motionP1[1] : 0, true);
    dataView.setFloat32(offset + 48, g.motionP1 ? g.motionP1[2] : 0, true);

    // Temporal coefficients P2
    dataView.setFloat32(offset + 52, g.motionP2 ? g.motionP2[0] : 0, true);
    dataView.setFloat32(offset + 56, g.motionP2 ? g.motionP2[1] : 0, true);
    dataView.setFloat32(offset + 60, g.motionP2 ? g.motionP2[2] : 0, true);

    // Harmonic coefficients P3
    dataView.setFloat32(offset + 64, g.motionP3 ? g.motionP3[0] : 0, true);
    dataView.setFloat32(offset + 68, g.motionP3 ? g.motionP3[1] : 0, true);
    dataView.setFloat32(offset + 72, g.motionP3 ? g.motionP3[2] : 0, true);

    offset += 76;
  }

  // ---------------- Write Metadata Block ----------------
  dataView.setUint32(offset, metaBytes.length, true);
  uint8View.set(metaBytes, offset + 4);

  return uint8View;
}
