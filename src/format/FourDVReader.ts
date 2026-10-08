import {
  FOURDV_MAGIC,
  FOURDV_VERSION,
  FourDVFlags,
  FourDVHeader,
  FourDVTocEntry,
  Decoded4DScene,
} from './fourdvSchema';

/**
 * Decodes a raw .4DV binary file buffer into an uncompressed 4D Gaussian scene representation.
 * Supports both Quantized (16-bit/8-bit) and legacy Float32 container streams.
 */
export function decode4DV(buffer: ArrayBuffer | Uint8Array): Decoded4DScene {
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

  // 2. Validate Version
  const version = dataView.getUint16(4, true);
  if (version > FOURDV_VERSION) {
    throw new Error(
      `[FourDVReader] Unsupported .4DV container version ${version}. Current reader supports up to v${FOURDV_VERSION}.`
    );
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

  // 3. Parse Table of Contents (TOC)
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

  // 4. Normalization Deltas
  const dx = Math.max(boundsMax[0] - boundsMin[0], 0.0001);
  const dy = Math.max(boundsMax[1] - boundsMin[1], 0.0001);
  const dz = Math.max(boundsMax[2] - boundsMin[2], 0.0001);
  const sMax = Math.max(header.scaleMax, 0.0001);
  const vMax = Math.max(header.velMax, 0.0001);
  const aMax = Math.max(header.accelMax, 0.0001);

  const isQuantized = (flags & FourDVFlags.IS_QUANTIZED) !== 0;

  const staticBytesPerElem = isQuantized ? 16 : 40;
  const dynamicBytesPerElem = isQuantized ? 34 : 76;

  const staticBlockSize = staticGaussians * staticBytesPerElem;
  const dynamicBlockSize = dynamicGaussians * dynamicBytesPerElem;
  const dataStart = tocOffset + tocEntriesCount * 32;
  const dynamicStart = dataStart + staticBlockSize;

  // 5. Decode Static Attributes (10 floats per primitive)
  const staticFloats = new Float32Array(staticGaussians * 10);
  if (isQuantized) {
    let offset = dataStart;
    for (let i = 0; i < staticGaussians; i++) {
      const dst = i * 10;
      // 16-bit Position
      const qx = dataView.getUint16(offset + 0, true);
      const qy = dataView.getUint16(offset + 2, true);
      const qz = dataView.getUint16(offset + 4, true);
      staticFloats[dst + 0] = boundsMin[0] + (qx / 65535) * dx;
      staticFloats[dst + 1] = boundsMin[1] + (qy / 65535) * dy;
      staticFloats[dst + 2] = boundsMin[2] + (qz / 65535) * dz;

      // 16-bit Scale
      const qsx = dataView.getUint16(offset + 6, true);
      const qsy = dataView.getUint16(offset + 8, true);
      const qsz = dataView.getUint16(offset + 10, true);
      staticFloats[dst + 3] = (qsx / 65535) * sMax;
      staticFloats[dst + 4] = (qsy / 65535) * sMax;
      staticFloats[dst + 5] = (qsz / 65535) * sMax;

      // 8-bit Color
      staticFloats[dst + 6] = dataView.getUint8(offset + 12) / 255;
      staticFloats[dst + 7] = dataView.getUint8(offset + 13) / 255;
      staticFloats[dst + 8] = dataView.getUint8(offset + 14) / 255;

      // 8-bit Opacity
      staticFloats[dst + 9] = dataView.getUint8(offset + 15) / 255;

      offset += 16;
    }
  } else {
    for (let i = 0; i < staticGaussians * 10; i++) {
      staticFloats[i] = dataView.getFloat32(dataStart + i * 4, true);
    }
  }

  // 6. Decode Dynamic Attributes (19 floats per primitive)
  const dynamicFloats = new Float32Array(dynamicGaussians * 19);
  if (isQuantized) {
    let offset = dynamicStart;
    for (let i = 0; i < dynamicGaussians; i++) {
      const dst = i * 19;
      // 16-bit Base Position
      const qx = dataView.getUint16(offset + 0, true);
      const qy = dataView.getUint16(offset + 2, true);
      const qz = dataView.getUint16(offset + 4, true);
      dynamicFloats[dst + 0] = boundsMin[0] + (qx / 65535) * dx;
      dynamicFloats[dst + 1] = boundsMin[1] + (qy / 65535) * dy;
      dynamicFloats[dst + 2] = boundsMin[2] + (qz / 65535) * dz;

      // 16-bit Scale
      const qsx = dataView.getUint16(offset + 6, true);
      const qsy = dataView.getUint16(offset + 8, true);
      const qsz = dataView.getUint16(offset + 10, true);
      dynamicFloats[dst + 3] = (qsx / 65535) * sMax;
      dynamicFloats[dst + 4] = (qsy / 65535) * sMax;
      dynamicFloats[dst + 5] = (qsz / 65535) * sMax;

      // 8-bit Color
      dynamicFloats[dst + 6] = dataView.getUint8(offset + 12) / 255;
      dynamicFloats[dst + 7] = dataView.getUint8(offset + 13) / 255;
      dynamicFloats[dst + 8] = dataView.getUint8(offset + 14) / 255;

      // 8-bit Opacity
      dynamicFloats[dst + 9] = dataView.getUint8(offset + 15) / 255;

      // 16-bit Velocity P1
      const vx = dataView.getInt16(offset + 16, true);
      const vy = dataView.getInt16(offset + 18, true);
      const vz = dataView.getInt16(offset + 20, true);
      dynamicFloats[dst + 10] = (vx / 32767) * vMax;
      dynamicFloats[dst + 11] = (vy / 32767) * vMax;
      dynamicFloats[dst + 12] = (vz / 32767) * vMax;

      // 16-bit Accel P2
      const ax = dataView.getInt16(offset + 22, true);
      const ay = dataView.getInt16(offset + 24, true);
      const az = dataView.getInt16(offset + 26, true);
      dynamicFloats[dst + 13] = (ax / 32767) * aMax;
      dynamicFloats[dst + 14] = (ay / 32767) * aMax;
      dynamicFloats[dst + 15] = (az / 32767) * aMax;

      // 16-bit Harmonic P3
      const hAmp = dataView.getUint16(offset + 28, true);
      const hFreq = dataView.getUint16(offset + 30, true);
      const hPhase = dataView.getUint16(offset + 32, true);
      dynamicFloats[dst + 16] = (hAmp / 65535) * header.harmonicMax[0];
      dynamicFloats[dst + 17] = (hFreq / 65535) * header.harmonicMax[1];
      dynamicFloats[dst + 18] = (hPhase / 65535) * header.harmonicMax[2];

      offset += 34;
    }
  } else {
    for (let i = 0; i < dynamicGaussians * 19; i++) {
      dynamicFloats[i] = dataView.getFloat32(dynamicStart + i * 4, true);
    }
  }

  // 7. Build Unified Interleaved 19-float GPU Array
  const allGaussiansPacked = new Float32Array(totalGaussians * 19);

  // Unpack Static into unified layout
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

  // Copy Dynamic into unified layout
  const dynamicDstStart = staticGaussians * 19;
  allGaussiansPacked.set(dynamicFloats, dynamicDstStart);

  // 8. Parse Metadata Block
  const metaStart = dynamicStart + dynamicBlockSize;
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
        const parsed = JSON.parse(jsonStr);
        metadata = { ...metadata, ...parsed };
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
