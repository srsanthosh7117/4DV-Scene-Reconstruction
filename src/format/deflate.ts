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
    const writer = cs.writable.getWriter();
    writer.write(data as unknown as BufferSource);
    writer.close();

    const response = new Response(cs.readable);
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
    const writer = ds.writable.getWriter();
    writer.write(compressedData as unknown as BufferSource);
    writer.close();

    const response = new Response(ds.readable);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  return compressedData;
}
