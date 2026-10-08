import { encode4DVAsync } from '../src/format/FourDVWriter';
import { generateTemporalGaussianScene } from '../src/demo/temporalDemo';
import * as fs from 'fs';
import * as path from 'path';

async function generateSample() {
  console.log('[Generate 4DV] Generating canonical .4DV sample file...');
  const scene = generateTemporalGaussianScene(1200, 5.0, 30.0);
  
  const uint8 = await encode4DVAsync(scene.polynomials || [], {
    title: 'Dynamic Dual-Helix Stream',
    description: 'Canonical .4DV V1 Compressed Scene',
    fps: 30,
    duration: 5.0,
    useQuantization: true,
    chunkDuration: 1.0,
    compressChunks: true,
  });

  const publicDir = path.resolve(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const outPath = path.join(publicDir, 'sample_scene.4dv');
  fs.writeFileSync(outPath, Buffer.from(uint8));
  console.log(`[Generate 4DV] Wrote canonical sample file to ${outPath} (${uint8.byteLength} bytes) ✓`);
}

generateSample();
