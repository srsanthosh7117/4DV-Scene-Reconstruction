/**
 * Browser-native DEFLATE chunk compression and decompression utilities.
 * Uses standard Web Streams API (CompressionStream / DecompressionStream).
 */

/**
 * Compresses an ArrayBuffer/Uint8Array with raw DEFLATE stream.
 */
export async function compressDeflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const sliceBuffer =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? (data.buffer as ArrayBuffer)
        : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    const blob = new Blob([sliceBuffer]);
    const stream = blob.stream().pipeThrough(cs);
    const response = new Response(stream);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  return data;
}

/**
 * Decompresses raw DEFLATE compressed bytes.
 */
export async function decompressDeflate(compressedData: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const sliceBuffer =
      compressedData.byteOffset === 0 && compressedData.byteLength === compressedData.buffer.byteLength
        ? (compressedData.buffer as ArrayBuffer)
        : (compressedData.buffer.slice(
            compressedData.byteOffset,
            compressedData.byteOffset + compressedData.byteLength
          ) as ArrayBuffer);
    const blob = new Blob([sliceBuffer]);
    const stream = blob.stream().pipeThrough(ds);
    const response = new Response(stream);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  return compressedData;
}

