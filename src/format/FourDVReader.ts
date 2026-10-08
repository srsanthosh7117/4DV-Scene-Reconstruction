import {
  FOURDV_MAGIC,
  FOURDV_VERSION,
  FourDVHeader,
  FourDVTocEntry,
  Decoded4DScene,
} from './fourdvSchema';

/**
 * Decodes a raw .4DV binary file buffer into an uncompressed 4D Gaussian scene representation.
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

  const tocOffset = dataView.getUint32(56, true);
  const tocEntriesCount = dataView.getUint32(60, true);

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
    });
  }

  // 4. Read Static & Dynamic blocks
  const staticBlockSize = staticGaussians * 10 * 4;
  const dynamicBlockSize = dynamicGaussians * 19 * 4;
  const dataStart = tocOffset + tocEntriesCount * 32;
  const dynamicStart = dataStart + staticBlockSize;

  // Static attributes: 10 floats per static Gaussian
  const staticFloats = new Float32Array(staticGaussians * 10);
  for (let i = 0; i < staticGaussians * 10; i++) {
    staticFloats[i] = dataView.getFloat32(dataStart + i * 4, true);
  }

  // Dynamic attributes: 19 floats per dynamic Gaussian
  const dynamicFloats = new Float32Array(dynamicGaussians * 19);
  for (let i = 0; i < dynamicGaussians * 19; i++) {
    dynamicFloats[i] = dataView.getFloat32(dynamicStart + i * 4, true);
  }

  // 5. Build Unified Interleaved 19-float GPU Array for direct single-call rendering
  const allGaussiansPacked = new Float32Array(totalGaussians * 19);

  // Unpack Static into unified layout (zeros for velocity/harmonic)
  for (let i = 0; i < staticGaussians; i++) {
    const src = i * 10;
    const dst = i * 19;
    allGaussiansPacked[dst + 0] = staticFloats[src + 0]; // pos X
    allGaussiansPacked[dst + 1] = staticFloats[src + 1]; // pos Y
    allGaussiansPacked[dst + 2] = staticFloats[src + 2]; // pos Z
    allGaussiansPacked[dst + 3] = staticFloats[src + 3]; // scale X
    allGaussiansPacked[dst + 4] = staticFloats[src + 4]; // scale Y
    allGaussiansPacked[dst + 5] = staticFloats[src + 5]; // scale Z
    allGaussiansPacked[dst + 6] = staticFloats[src + 6]; // col R
    allGaussiansPacked[dst + 7] = staticFloats[src + 7]; // col G
    allGaussiansPacked[dst + 8] = staticFloats[src + 8]; // col B
    allGaussiansPacked[dst + 9] = staticFloats[src + 9]; // opacity
  }

  // Copy Dynamic into unified layout
  const dynamicDstStart = staticGaussians * 19;
  allGaussiansPacked.set(dynamicFloats, dynamicDstStart);

  // 6. Parse Metadata Block
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
        const metaStr = new TextDecoder().decode(metaBytes);
        metadata = JSON.parse(metaStr);
      } catch (e) {
        console.warn('[FourDVReader] Failed to parse metadata JSON:', e);
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
