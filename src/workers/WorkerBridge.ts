import { Decoded4DScene, FourDVTocEntry, FourDVHeader } from '../format/fourdvSchema';

export interface WorkerDecodeResult {
  decoded: Decoded4DScene;
  decodeTimeMs: number;
}

export interface WorkerChunkResult {
  chunkId: number;
  floats: Float32Array;
  decodeTimeMs: number;
}

export interface WorkerMetadataResult {
  header: FourDVHeader;
  toc: FourDVTocEntry[];
  decodeTimeMs: number;
}

/**
 * Bridge interface for communicating with background Decoder Web Worker.
 */
export class WorkerBridge {
  private worker: Worker | null = null;
  private pendingRequests: Map<
    number,
    { resolve: (res: any) => void; reject: (err: Error) => void }
  > = new Map();
  private reqIdCounter: number = 0;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    try {
      this.worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = (e: MessageEvent) => {
        const { id, success, error, ...data } = e.data;
        const request = this.pendingRequests.get(id);
        if (!request) return;

        this.pendingRequests.delete(id);
        if (success) {
          request.resolve(data);
        } else {
          request.reject(new Error(error || 'Worker operation failed'));
        }
      };

      this.worker.onerror = (err) => {
        console.error('[WorkerBridge] Worker error:', err);
      };
    } catch (e) {
      console.warn('[WorkerBridge] Web Worker initialization fallback to main thread:', e);
    }
  }

  /**
   * Decodes full .4DV binary buffer off-thread.
   */
  public async decode4DVAsync(buffer: ArrayBuffer): Promise<WorkerDecodeResult> {
    if (!this.worker) {
      // Fallback to main thread
      const { decode4DVAsync } = await import('../format/FourDVReader');
      const startTime = performance.now();
      const decoded = await decode4DVAsync(buffer);
      const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
      return { decoded, decodeTimeMs };
    }

    const id = ++this.reqIdCounter;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type: 'DECODE_ALL', buffer }, [buffer]);
    });
  }

  /**
   * Decodes a specific temporal/static chunk off-thread for fast seeking.
   */
  public async decodeChunkAsync(
    buffer: ArrayBuffer,
    tocEntry: FourDVTocEntry,
    header: FourDVHeader
  ): Promise<WorkerChunkResult> {
    if (!this.worker) {
      const { readChunkAsync } = await import('../format/FourDVReader');
      const startTime = performance.now();
      const floats = await readChunkAsync(buffer, tocEntry, header);
      const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
      return { chunkId: tocEntry.chunkId, floats, decodeTimeMs };
    }

    const id = ++this.reqIdCounter;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type: 'DECODE_CHUNK', buffer, tocEntry, header });
    });
  }

  /**
   * Retrieves container header & TOC metadata without full decompression.
   */
  public async getMetadataAsync(buffer: ArrayBuffer): Promise<WorkerMetadataResult> {
    if (!this.worker) {
      const { parseHeader, parseToc } = await import('../format/FourDVReader');
      const startTime = performance.now();
      const header = parseHeader(buffer);
      const toc = parseToc(buffer, header);
      const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
      return { header, toc, decodeTimeMs };
    }

    const id = ++this.reqIdCounter;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type: 'GET_METADATA', buffer });
    });
  }

  public dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

