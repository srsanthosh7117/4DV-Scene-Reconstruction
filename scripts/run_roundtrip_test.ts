import { runDeterministicRoundTripTest } from '../src/format/compressionTests';

async function main() {
  console.log('==================================================');
  console.log('EXECUTING DETERMINISTIC .4DV V1 ROUND-TRIP TEST');
  console.log('==================================================\n');

  try {
    const result = await runDeterministicRoundTripTest();
    console.log('\n==================================================');
    console.log('ROUND-TRIP TEST RESULT:');
    console.log(`Passed: ${result.passed ? '✓ YES' : '✗ NO'}`);
    console.log(`Uncompressed Passed: ${result.uncompressedPassed ? '✓ YES' : '✗ NO'}`);
    console.log(`Compressed Passed: ${result.compressedPassed ? '✓ YES' : '✗ NO'}`);
    console.log(`Random Access Passed: ${result.randomAccessPassed ? '✓ YES' : '✗ NO'}`);
    console.log(`Uncompressed Size: ${result.uncompressedSize} bytes`);
    console.log(`Compressed Size: ${result.compressedSize} bytes`);
    console.log(`Position MAE: ${result.positionMAE.toFixed(8)}`);
    console.log(`Scale MAE: ${result.scaleMAE.toFixed(8)}`);
    console.log(`Color MAE: ${result.colorMAE.toFixed(8)}`);
    console.log(`Details: ${result.details}`);
    console.log('==================================================\n');

    if (!result.passed) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test threw unexpected error:', err);
    process.exit(1);
  }
}

main();
