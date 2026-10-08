import { ShaderManager } from './ShaderManager';
import { GaussianRenderer } from './GaussianRenderer';
import { GAUSSIAN_VERTEX_SHADER } from './shaders/gaussian.vert';
import { GAUSSIAN_FRAGMENT_SHADER } from './shaders/gaussian.frag';
import { Gaussian3D, GaussianRenderStats } from './types';
import { Mat4, Mat4Utils } from '../utils/math';
import { Camera, CameraController, CameraTelemetry } from '../camera';

export interface RendererCallbacks {
  onStats?: (stats: GaussianRenderStats) => void;
  onCameraTelemetry?: (telemetry: CameraTelemetry) => void;
}

export class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private shaderManager: ShaderManager;
  private gaussianRenderer: GaussianRenderer;

  // 6-DoF Camera System
  public camera: Camera;
  public cameraController: CameraController;

  private isRunning: boolean = false;
  private animationFrameId: number | null = null;

  // Matrices
  private modelMatrix: Mat4 = Mat4Utils.createIdentity();

  // Performance Tracking
  private lastTime: number = performance.now();
  private frameCount: number = 0;
  private fps: number = 0;
  private frameTimeMs: number = 0;
  private callbacks: RendererCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks?: RendererCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks || {};

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

    // Initialize Camera & Controller
    this.camera = new Camera({
      position: [0, 1.5, 4.2],
      yaw: 0,
      pitch: -0.1,
      fov: 60,
    });
    this.cameraController = new CameraController(this.camera, canvas, {
      moveSpeed: 3.5,
      sprintMultiplier: 2.5,
      lookSensitivity: 0.003,
    });

    // Deep cinematic dark background
    gl.clearColor(0.04, 0.05, 0.08, 1.0);

    this.handleResize();
  }

  /**
   * Resizes drawing buffer to match display resolution and high-DPI
   */
  public handleResize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
    const displayHeight = Math.floor(this.canvas.clientHeight * dpr);

    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
      this.gl.viewport(0, 0, displayWidth, displayHeight);

      const aspect = displayWidth / Math.max(displayHeight, 1);
      this.camera.setAspect(aspect);
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

      const deltaSec = Math.min(deltaMs / 1000, 0.1); // Guard against giant delta jumps

      // Update 6-DoF Camera Controller with input & delta-time
      this.cameraController.update(deltaSec);

      // FPS and Telemetry updates
      this.frameCount++;
      if (this.frameCount >= 15) {
        this.fps = Math.round(1000 / Math.max(deltaMs, 0.001));
        this.frameCount = 0;
        if (this.callbacks.onStats) {
          this.callbacks.onStats({
            fps: this.fps,
            frameTimeMs: parseFloat(this.frameTimeMs.toFixed(2)),
            gaussianCount: this.gaussianRenderer.getGaussianCount(),
            viewportWidth: this.canvas.width,
            viewportHeight: this.canvas.height,
          });
        }
        if (this.callbacks.onCameraTelemetry) {
          this.callbacks.onCameraTelemetry(this.cameraController.getTelemetry());
        }
      }

      this.handleResize();
      this.renderFrame();

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Single frame render execution
   */
  public renderFrame() {
    const gl = this.gl;

    // Get current View and Projection matrices from 6-DoF Camera
    const matrices = this.camera.updateMatrices();

    // Clear color & depth buffers
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Draw Gaussians
    this.gaussianRenderer.render(
      this.shaderManager,
      'gaussian',
      matrices.projectionMatrix,
      matrices.viewMatrix,
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
   * Cleans up GPU resources & event listeners
   */
  public dispose() {
    this.stop();
    this.cameraController.dispose();
    this.gaussianRenderer.dispose();
    this.shaderManager.dispose();
  }
}
