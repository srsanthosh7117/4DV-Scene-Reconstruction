import { ShaderManager } from './ShaderManager';
import { Gaussian3D } from './types';
import { Mat4 } from '../utils/math';

/**
 * Manages GPU buffers and instanced drawing of 3D Gaussian splats in WebGL2.
 */
export class GaussianRenderer {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;

  private instanceCount: number = 0;
  private currentCapacity: number = 0;

  // Stride: 3 (pos) + 3 (scale) + 3 (color) + 1 (opacity) = 10 floats per Gaussian
  public static readonly FLOATS_PER_GAUSSIAN = 10;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.initBuffers();
  }

  private initBuffers() {
    const gl = this.gl;

    this.vao = gl.createVertexArray();
    if (!this.vao) {
      throw new Error('[GaussianRenderer] Failed to create WebGL2 VertexArrayObject');
    }

    gl.bindVertexArray(this.vao);

    // 1. Static Unit Quad Geometry (2 Triangles, covering [-2, +2] in local space)
    // 6 vertices * 2 components = 12 floats
    const quadVertices = new Float32Array([
      -2.0, -2.0,
       2.0, -2.0,
      -2.0,  2.0,
      -2.0,  2.0,
       2.0, -2.0,
       2.0,  2.0,
    ]);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    // Attribute 0: a_quadCorner (vec2)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0); // Per-vertex attribute

    // 2. Dynamic/Instanced Gaussian Data Buffer
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

    const strideBytes = GaussianRenderer.FLOATS_PER_GAUSSIAN * 4; // 40 bytes

    // Attribute 1: a_position (vec3, offset 0)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, strideBytes, 0);
    gl.vertexAttribDivisor(1, 1); // 1 per instance

    // Attribute 2: a_scale (vec3, offset 12 bytes)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, strideBytes, 3 * 4);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: a_color (vec3, offset 24 bytes)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, strideBytes, 6 * 4);
    gl.vertexAttribDivisor(3, 1);

    // Attribute 4: a_opacity (float, offset 36 bytes)
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, strideBytes, 9 * 4);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);
  }

  /**
   * Uploads raw interleaved Float32Array data directly to GPU VBO.
   */
  public uploadRawData(data: Float32Array, count: number) {
    const gl = this.gl;
    this.instanceCount = count;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

    if (count > this.currentCapacity) {
      // Reallocate GPU buffer if larger
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.currentCapacity = count;
    } else {
      // Subdata update to avoid driver reallocation
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
  }

  /**
   * Helper to pack and upload an array of Gaussian3D structures.
   */
  public uploadGaussians(gaussians: Gaussian3D[]) {
    const count = gaussians.length;
    const packed = new Float32Array(count * GaussianRenderer.FLOATS_PER_GAUSSIAN);

    for (let i = 0; i < count; i++) {
      const g = gaussians[i];
      const offset = i * GaussianRenderer.FLOATS_PER_GAUSSIAN;

      // Position (x, y, z)
      packed[offset + 0] = g.position[0];
      packed[offset + 1] = g.position[1];
      packed[offset + 2] = g.position[2];

      // Scale (sx, sy, sz)
      packed[offset + 3] = g.scale[0];
      packed[offset + 4] = g.scale[1];
      packed[offset + 5] = g.scale[2];

      // Color (r, g, b)
      packed[offset + 6] = g.color[0];
      packed[offset + 7] = g.color[1];
      packed[offset + 8] = g.color[2];

      // Opacity
      packed[offset + 9] = g.opacity;
    }

    this.uploadRawData(packed, count);
  }

  /**
   * Renders all active Gaussian instances using instanced draw call.
   */
  public render(
    shaderManager: ShaderManager,
    programName: string,
    projection: Mat4,
    view: Mat4,
    model: Mat4
  ) {
    if (this.instanceCount === 0 || !this.vao) return;

    const gl = this.gl;
    const program = shaderManager.getProgram(programName);
    gl.useProgram(program);

    // Bind uniforms
    const uProj = shaderManager.getUniformLocation(programName, 'u_projection');
    const uView = shaderManager.getUniformLocation(programName, 'u_view');
    const uModel = shaderManager.getUniformLocation(programName, 'u_model');

    if (uProj) gl.uniformMatrix4fv(uProj, false, projection);
    if (uView) gl.uniformMatrix4fv(uView, false, view);
    if (uModel) gl.uniformMatrix4fv(uModel, false, model);

    // Configure blending & depth for transparent Gaussian splatting
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false); // Disable depth writes for soft additive/alpha accumulation

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);

    // Restore state
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  public getGaussianCount(): number {
    return this.instanceCount;
  }

  public dispose() {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    this.vao = null;
    this.quadBuffer = null;
    this.instanceBuffer = null;
    this.instanceCount = 0;
  }
}
