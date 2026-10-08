import { decode4DVAsync, parseHeader, parseToc, readChunkAsync } from '../format/FourDVReader';
import { FourDVTocEntry, FourDVHeader } from '../format/fourdvSchema';

/**
 * Web Worker for off-thread .4DV binary decoding, decompression, and chunked streaming.
 */
self.onmessage = async (e: MessageEvent) => {
  const { id, type = 'DECODE_ALL', buffer, tocEntry, header, chunkIndex } = e.data;

  try {
    const startTime = performance.now();

    if (type === 'GET_METADATA') {
      const parsedHeader = parseHeader(buffer);
      const parsedToc = parseToc(buffer, parsedHeader);
      const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

      self.postMessage({
        id,
        success: true,
        header: parsedHeader,
        toc: parsedToc,
        decodeTimeMs,
      });
      return;
    }

    if (type === 'DECODE_CHUNK') {
      const parsedHeader: FourDVHeader = header || parseHeader(buffer);
      const parsedToc: FourDVTocEntry[] = tocEntry ? [tocEntry] : parseToc(buffer, parsedHeader);
      const targetEntry = tocEntry || parsedToc[chunkIndex || 0];

      if (!targetEntry) {
        throw new Error(`TOC Entry not found for chunkIndex: ${chunkIndex}`);
      }

      const chunkFloats = await readChunkAsync(buffer, targetEntry, parsedHeader);
      const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

      (self as unknown as { postMessage: (msg: unknown, transfer: Transferable[]) => void }).postMessage(
        {
          id,
          success: true,
          chunkId: targetEntry.chunkId,
          floats: chunkFloats,
          decodeTimeMs,
        },
        [chunkFloats.buffer as ArrayBuffer]
      );
      return;
    }

    // Default: Full scene decoding
    const decoded = await decode4DVAsync(buffer);
    const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

    // Post decoded data back with transferable array buffers
    const transferables: Transferable[] = [];
    if (decoded.allGaussiansPacked?.buffer) {
      transferables.push(decoded.allGaussiansPacked.buffer as ArrayBuffer);
    }
    if (decoded.staticAttributes?.buffer) {
      transferables.push(decoded.staticAttributes.buffer as ArrayBuffer);
    }
    if (decoded.dynamicAttributes?.buffer) {
      transferables.push(decoded.dynamicAttributes.buffer as ArrayBuffer);
    }

    (self as unknown as { postMessage: (msg: unknown, transfer: Transferable[]) => void }).postMessage(
      {
        id,
        success: true,
        decoded,
        decodeTimeMs,
      },
      transferables
    );
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process .4DV in worker',
    });
  }
};

