import { ShaderManager } from './ShaderManager';
import { GaussianRenderer } from './GaussianRenderer';
import { GAUSSIAN_VERTEX_SHADER } from './shaders/gaussian.vert';
import { GAUSSIAN_FRAGMENT_SHADER } from './shaders/gaussian.frag';
import { Gaussian3D, GaussianRenderStats } from './types';
import { Mat4, Mat4Utils, Vec3 } from '../utils/math';

export class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private gaussianRenderer: GaussianRenderer;

  private isRunning: boolean = false;
  private animationFrameId: number | null = null;

  // Matrices
  private projectionMatrix: Mat4 = Mat4Utils.createIdentity();
  private viewMatrix: Mat4 = Mat4Utils.createIdentity();
  private modelMatrix: Mat4 = Mat4Utils.createIdentity();

  // Camera Settings
  private eyePosition: Vec3 = [0, 1.5, 4.0];
  private targetPosition: Vec3 = [0, 0, 0];
  private upVector: Vec3 = [0, 1, 0];
  private fovDegrees: number = 60;

  // Performance Tracking
  private lastTime: number = performance.now();
  private frameCount: number = 0;
  private fps: number = 0;
  private frameTimeMs: number = 0;
  private onStatsCallback?: (stats: GaussianRenderStats) => void;

  // Orbit angle for Phase 2 test visualization
  private autoRotate: boolean = true;
  private orbitAngle: number = 0;

  constructor(canvas: HTMLCanvasElement, onStats?: (stats: GaussianRenderStats) => void) {
    this.canvas = canvas;
    this.onStatsCallback = onStats;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error(
        'WebGL2 is not supported on this browser/device. Please ensure hardware acceleration is enabled.'
      );
    }

    this.gl = gl;
    this.shaderManager = new ShaderManager(gl);

    // Compile Gaussian splat program
    this.shaderManager.createProgram('gaussian', GAUSSIAN_VERTEX_SHADER, GAUSSIAN_FRAGMENT_SHADER);

    // Initialize Gaussian instanced renderer
    this.gaussianRenderer = new GaussianRenderer(gl);

    // Set clear color
    gl.clearColor(0.04, 0.05, 0.08, 1.0); // Deep cinematic dark background

    this.handleResize();
  }

  /**
   * Resizes drawing buffer to match display resolution and high-DPI
   */
  public handleResize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for performance on high-DPI screens
    const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
    const displayHeight = Math.floor(this.canvas.clientHeight * dpr);

    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
      this.gl.viewport(0, 0, displayWidth, displayHeight);

      // Update projection matrix
      const aspect = displayWidth / Math.max(displayHeight, 1);
      const fovRad = (this.fovDegrees * Math.PI) / 180;
      Mat4Utils.perspective(this.projectionMatrix, fovRad, aspect, 0.1, 100.0);
      return true;
    }
    return false;
  }

  /**
   * Load Gaussians to GPU
   */
  public setGaussians(gaussians: Gaussian3D[]) {
    this.gaussianRenderer.uploadGaussians(gaussians);
  }

  public setAutoRotate(enabled: boolean) {
    this.autoRotate = enabled;
  }

  /**
   * Starts the continuous WebGL2 render loop
   */
  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();

    const loop = (currentTime: number) => {
      if (!this.isRunning) return;

      const deltaMs = currentTime - this.lastTime;
      this.frameTimeMs = deltaMs;
      this.lastTime = currentTime;

      // FPS tracking (every 30 frames)
      this.frameCount++;
      if (this.frameCount >= 30) {
        this.fps = Math.round(1000 / Math.max(deltaMs, 0.001));
        this.frameCount = 0;
        if (this.onStatsCallback) {
          this.onStatsCallback({
            fps: this.fps,
            frameTimeMs: parseFloat(this.frameTimeMs.toFixed(2)),
            gaussianCount: this.gaussianRenderer.getGaussianCount(),
            viewportWidth: this.canvas.width,
            viewportHeight: this.canvas.height,
          });
        }
      }

      this.handleResize();
      this.renderFrame(deltaMs);

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Single frame render execution
   */
  public renderFrame(deltaMs: number = 16.6) {
    const gl = this.gl;

    // Optional gentle test orbit for Phase 2 demo inspection
    if (this.autoRotate) {
      this.orbitAngle += (deltaMs / 1000) * 0.4;
      const radius = 4.2;
      this.eyePosition[0] = Math.sin(this.orbitAngle) * radius;
      this.eyePosition[1] = 1.6 + Math.sin(this.orbitAngle * 0.5) * 0.4;
      this.eyePosition[2] = Math.cos(this.orbitAngle) * radius;
    }

    // Compute View Matrix
    Mat4Utils.lookAt(this.viewMatrix, this.eyePosition, this.targetPosition, this.upVector);

    // Clear color & depth buffers
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Draw Gaussians
    this.gaussianRenderer.render(
      this.shaderManager,
      'gaussian',
      this.projectionMatrix,
      this.viewMatrix,
      this.modelMatrix
    );
  }

  /**
   * Stops the render loop
   */
  public stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Cleans up GPU resources
   */
  public dispose() {
    this.stop();
    this.gaussianRenderer.dispose();
    this.shaderManager.dispose();
  }
}
