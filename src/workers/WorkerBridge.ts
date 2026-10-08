import { Decoded4DScene } from '../format/fourdvSchema';

export interface WorkerDecodeResult {
  decoded: Decoded4DScene;
  decodeTimeMs: number;
}

/**
 * Bridge interface for communicating with background Decoder Web Worker.
 */
export class WorkerBridge {
  private worker: Worker | null = null;
  private pendingRequests: Map<
    number,
    { resolve: (res: WorkerDecodeResult) => void; reject: (err: Error) => void }
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
        const { id, success, decoded, decodeTimeMs, error } = e.data;
        const request = this.pendingRequests.get(id);
        if (!request) return;

        this.pendingRequests.delete(id);
        if (success) {
          request.resolve({ decoded, decodeTimeMs });
        } else {
          request.reject(new Error(error));
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
   * Decodes .4DV binary buffer off-thread.
   */
  public async decode4DVAsync(buffer: ArrayBuffer): Promise<WorkerDecodeResult> {
    if (!this.worker) {
      // Fallback to main thread
      const { decode4DV } = await import('../format/FourDVReader');
      const startTime = performance.now();
      const decoded = decode4DV(buffer);
      const decodeTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
      return { decoded, decodeTimeMs };
    }

    const id = ++this.reqIdCounter;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker!.postMessage({ id, buffer }, [buffer]);
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
