import { decode4DVAsync, parseHeader, parseToc } from '../src/format/FourDVReader';
import { runDeterministicRoundTripTest } from '../src/format/compressionTests';

/**
 * Creates a synthetic Python fourdv_encode.py output file with a JSON header:
 * - Bytes 0..3: '4DV1' (0x31564434)
 * - Bytes 4..7: version uint32 = 1
 * - Bytes 8..11: jsonLen uint32
 * - Bytes 12..: UTF-8 JSON text (contains "time_end" matching the user's scenario)
 * - Binary payload: 32-byte Gaussian records
 */
function createSyntheticPython4DVFile(count = 50): Uint8Array {
  const jsonHeader = {
    generator: "fourdv_encode.py",
    version: 1,
    num_gaussians: count,
    num_static: 10,
    num_dynamic: 40,
    fps: 30.0,
    time_end: 2.5,
    duration: 2.5,
    bbox_min: [-3.0, -1.0, -3.0],
    bbox_max: [3.0, 4.0, 3.0],
    scale_max: 0.5,
    vel_max: 1.5,
    accel_max: 0.8,
    record_size: 32,
  };

  const jsonStr = JSON.stringify(jsonHeader);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const jsonLen = jsonBytes.byteLength;

  const binaryLen = count * 32;
  const totalLength = 12 + jsonLen + binaryLen;
  const buffer = new ArrayBuffer(totalLength);
  const dataView = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // 1. Magic '4DV1' (0x31564434)
  dataView.setUint32(0, 0x31564434, true);

  // 2. Version
  dataView.setUint32(4, 1, true);

  // 3. JSON length
  dataView.setUint32(8, jsonLen, true);

  // 4. JSON UTF-8 payload
  uint8.set(jsonBytes, 12);

  // 5. Binary 32-byte records
  const binOffset = 12 + jsonLen;
  for (let i = 0; i < count; i++) {
    const recOffset = binOffset + i * 32;
    const angle = (i / count) * Math.PI * 2;
    // Position (Float32 x 3 = 12B)
    dataView.setFloat32(recOffset + 0, Math.cos(angle) * 2.0, true);
    dataView.setFloat32(recOffset + 4, 1.2, true);
    dataView.setFloat32(recOffset + 8, Math.sin(angle) * 2.0, true);

    // Scale (Uint16 x 3 = 6B)
    dataView.setUint16(recOffset + 12, 13107, true); // 0.1 / 0.5 * 65535
    dataView.setUint16(recOffset + 14, 13107, true);
    dataView.setUint16(recOffset + 16, 13107, true);

    // Color & Opacity (Uint8 x 4 = 4B)
    dataView.setUint8(recOffset + 18, 220);
    dataView.setUint8(recOffset + 19, 150);
    dataView.setUint8(recOffset + 20, 80);
    dataView.setUint8(recOffset + 21, 230);

    // Velocity (Int16 x 3 = 6B)
    dataView.setInt16(recOffset + 22, 4000, true);
    dataView.setInt16(recOffset + 24, 0, true);
    dataView.setInt16(recOffset + 26, -4000, true);

    // Accel/Harm (Int16 x 2 = 4B)
    dataView.setInt16(recOffset + 28, 500, true);
    dataView.setInt16(recOffset + 30, -500, true);
  }

  return uint8;
}

async function runTests() {
  console.log('==================================================');
  console.log('TEST 1: CANONICAL V1 ROUND-TRIP VERIFICATION');
  console.log('==================================================');
  const canonicalRes = await runDeterministicRoundTripTest();
  console.log(`Canonical V1 Test Result: ${canonicalRes.passed ? '✓ PASSED' : '✗ FAILED'}`);
  if (!canonicalRes.passed) throw new Error('Canonical V1 test failed');

  console.log('\n==================================================');
  console.log('TEST 2: PYTHON JSON-HEADER VARIANT AUTO-DETECTION');
  console.log('==================================================');
  const syntheticPython4DV = createSyntheticPython4DVFile(100);
  console.log(`Generated synthetic Python .4dv file: ${syntheticPython4DV.byteLength} bytes`);

  // Test parseHeader
  const header = parseHeader(syntheticPython4DV);
  console.log('[Test 2] Parsed Header:', {
    version: header.version,
    frameCount: header.frameCount,
    fps: header.fps,
    duration: header.duration,
    totalGaussians: header.totalGaussians,
    staticGaussians: header.staticGaussians,
    dynamicGaussians: header.dynamicGaussians,
    tocOffset: header.tocOffset,
  });

  // Test parseToc
  const toc = parseToc(syntheticPython4DV, header);
  console.log(`[Test 2] Parsed TOC (${toc.length} chunks):`, toc[0]);

  // Test full asynchronous decode
  const decoded = await decode4DVAsync(syntheticPython4DV);
  console.log(`[Test 2] Decoded Scene: ${decoded.header.totalGaussians} total Gaussians, allGaussiansPacked length = ${decoded.allGaussiansPacked.length}`);

  if (decoded.header.totalGaussians === 100 && decoded.allGaussiansPacked.length === 100 * 19) {
    console.log('✓ PYTHON JSON-HEADER VARIANT PARSED AND DECODED SUCCESSFULLY!');
  } else {
    throw new Error(`Mismatch in decoded floats: got ${decoded.allGaussiansPacked.length}, expected ${100 * 19}`);
  }

  console.log('\n==================================================');
  console.log('ALL DUAL-MODE DECODER TESTS PASSED WITH 0 ERRORS ✓');
  console.log('==================================================');
}

runTests();
