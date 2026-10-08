import { decode4DV } from '../format/FourDVReader';

/**
 * Web Worker for off-thread .4DV binary decoding and decompression.
 */
self.onmessage = async (e: MessageEvent) => {
  const { id, buffer } = e.data;

  try {
    const startTime = performance.now();
    const decoded = decode4DV(buffer);
    const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

    // Post decoded data back
    (self as unknown as { postMessage: (msg: unknown, transfer: Transferable[]) => void }).postMessage(
      {
        id,
        success: true,
        decoded,
        decodeTimeMs,
      },
      [decoded.allGaussiansPacked.buffer as ArrayBuffer]
    );
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Failed to decode .4DV file in worker',
    });
  }
};
