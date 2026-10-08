/**
 * Morton (Z-Order Curve) 3D Spatial Ordering.
 * Interleaves 10 bits each of X, Y, Z integer coordinates into a 30-bit integer key.
 * Used to spatially sort 4D Gaussians for spatial coherency and compression ratio gains.
 */

/** Expands a 10-bit integer into 30 bits by inserting 2 zeros between each bit */
function expandBits10(v: number): number {
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8))  & 0x0300f00f;
  v = (v | (v << 4))  & 0x030c30c3;
  v = (v | (v << 2))  & 0x09249249;
  return v;
}

/** Computes 30-bit Morton code for normalized [0..1023] 3D coordinates */
export function computeMorton3D(x: number, y: number, z: number): number {
  const ix = Math.max(0, Math.min(1023, Math.floor(x)));
  const iy = Math.max(0, Math.min(1023, Math.floor(y)));
  const iz = Math.max(0, Math.min(1023, Math.floor(z)));

  return (expandBits10(ix) << 2) | (expandBits10(iy) << 1) | expandBits10(iz);
}

/**
 * Normalizes 3D coordinates to [0..1023] based on scene bounding box and calculates Morton code.
 */
export function getMortonKey(
  pos: [number, number, number],
  boundsMin: [number, number, number],
  boundsMax: [number, number, number]
): number {
  const dx = Math.max(boundsMax[0] - boundsMin[0], 0.0001);
  const dy = Math.max(boundsMax[1] - boundsMin[1], 0.0001);
  const dz = Math.max(boundsMax[2] - boundsMin[2], 0.0001);

  const nx = ((pos[0] - boundsMin[0]) / dx) * 1023.0;
  const ny = ((pos[1] - boundsMin[1]) / dy) * 1023.0;
  const nz = ((pos[2] - boundsMin[2]) / dz) * 1023.0;

  return computeMorton3D(nx, ny, nz);
}
