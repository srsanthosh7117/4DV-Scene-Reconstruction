import { decode4DVAsync, parseHeader, parseToc } from '../src/format/FourDVReader';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
  const samplePath = path.resolve(process.cwd(), 'public/sample_scene.4dv');
  const buffer = fs.readFileSync(samplePath);
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  console.log('[Verify Sample] Reading', samplePath);
  const header = parseHeader(uint8);
  console.log('[Verify Sample] Header:', {
    version: header.version,
    flags: `0x${header.flags.toString(16)}`,
    total: header.totalGaussians,
    static: header.staticGaussians,
    dynamic: header.dynamicGaussians,
    duration: header.duration,
    fps: header.fps,
  });

  const toc = parseToc(uint8, header);
  console.log(`[Verify Sample] TOC entries (${toc.length}):`);
  for (const entry of toc) {
    console.log(`  Chunk ${entry.chunkId}: time=[${entry.timeStart}s, ${entry.timeEnd}s] offset=${entry.fileOffset} compSize=${entry.byteLength} rawSize=${entry.uncompressedLength} count=${entry.gaussianCount}`);
  }

  const decoded = await decode4DVAsync(uint8);
  console.log(`[Verify Sample] Decoded successfully! Packed floats count: ${decoded.allGaussiansPacked.length} (expected ${header.totalGaussians * 19})`);
  
  if (decoded.allGaussiansPacked.length === header.totalGaussians * 19) {
    console.log('[Verify Sample] ALL CHECKS PASSED ✓');
  } else {
    throw new Error('Mismatch in decoded float count!');
  }
}

verify();
