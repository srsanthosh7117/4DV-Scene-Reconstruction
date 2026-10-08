import { Camera } from './Camera';
import { CameraTelemetry } from './types';
import { Vec3, Vec3Utils } from '../utils/math';

export interface CameraControllerOptions {
  moveSpeed?: number;
  sprintMultiplier?: number;
  lookSensitivity?: number;
  target?: Vec3;
}

export class CameraController {
  private camera: Camera;
  private canvas: HTMLCanvasElement;

  // Configuration
  public moveSpeed: number = 3.5;         // Units per second
  public sprintMultiplier: number = 2.5;   // Shift speed boost
  public lookSensitivity: number = 0.003;  // Radians per pixel
  public target: Vec3 = [0, 0, 0];        // Orbit focus point

  // Mode
  public mode: 'FREE_FLIGHT' | 'ORBIT' = 'FREE_FLIGHT';

  // Input states
  private keys: Set<string> = new Set();
  private isMouseDown: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  // Orbit parameters
  public orbitRadius: number = 4.2;
  public orbitAutoRotate: boolean = false;
  public orbitSpeed: number = 0.4; // Rad/sec

  // Event handler bindings
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;
  private onContextMenuBound: (e: MouseEvent) => void;

  constructor(camera: Camera, canvas: HTMLCanvasElement, options?: CameraControllerOptions) {
    this.camera = camera;
    this.canvas = canvas;

    if (options) {
      if (options.moveSpeed !== undefined) this.moveSpeed = options.moveSpeed;
      if (options.sprintMultiplier !== undefined) this.sprintMultiplier = options.sprintMultiplier;
      if (options.lookSensitivity !== undefined) this.lookSensitivity = options.lookSensitivity;
      if (options.target !== undefined) this.target = [...options.target];
    }

    this.onKeyDownBound = this.onKeyDown.bind(this);
    this.onKeyUpBound = this.onKeyUp.bind(this);
    this.onMouseDownBound = this.onMouseDown.bind(this);
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onMouseUpBound = this.onMouseUp.bind(this);
    this.onWheelBound = this.onWheel.bind(this);
    this.onContextMenuBound = (e) => e.preventDefault();

    this.attachEvents();
  }

  private attachEvents() {
    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);

    this.canvas.addEventListener('mousedown', this.onMouseDownBound);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    this.canvas.addEventListener('wheel', this.onWheelBound, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenuBound);
  }

  private onKeyDown(e: KeyboardEvent) {
    // Avoid capturing inputs if user is typing into an input/textarea
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
      return;
    }
    this.keys.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button === 0 || e.button === 2) {
      this.isMouseDown = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.isMouseDown) return;

    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    if (this.mode === 'FREE_FLIGHT') {
      // Rotate camera yaw & pitch
      this.camera.yaw += dx * this.lookSensitivity;
      this.camera.pitch -= dy * this.lookSensitivity;
      this.camera.updateVectors();
    } else if (this.mode === 'ORBIT') {
      // Orbit around target
      this.camera.yaw += dx * this.lookSensitivity;
      this.camera.pitch -= dy * this.lookSensitivity;
      this.updateOrbitPosition();
    }
  }

  private onMouseUp() {
    this.isMouseDown = false;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (this.mode === 'ORBIT') {
      // Adjust orbit radius (dolly in/out)
      this.orbitRadius = Math.max(0.5, Math.min(30.0, this.orbitRadius + Math.sign(e.deltaY) * 0.4));
      this.updateOrbitPosition();
    } else {
      // Adjust FOV (zoom)
      this.camera.fov = Math.max(15, Math.min(100, this.camera.fov + Math.sign(e.deltaY) * 2));
      this.camera.updateVectors();
    }
  }

  private updateOrbitPosition() {
    const maxPitch = (89.0 * Math.PI) / 180;
    this.camera.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.camera.pitch));

    const cosPitch = Math.cos(this.camera.pitch);
    const sinPitch = Math.sin(this.camera.pitch);
    const cosYaw = Math.cos(this.camera.yaw);
    const sinYaw = Math.sin(this.camera.yaw);

    this.camera.position[0] = this.target[0] + this.orbitRadius * sinYaw * cosPitch;
    this.camera.position[1] = this.target[1] + this.orbitRadius * sinPitch;
    this.camera.position[2] = this.target[2] + this.orbitRadius * cosYaw * cosPitch;

    // Point forward directly at target
    Vec3Utils.subtract(this.camera.forward, this.target, this.camera.position);
    Vec3Utils.normalize(this.camera.forward, this.camera.forward);

    // Compute right & up
    const worldUp: Vec3 = [0, 1, 0];
    Vec3Utils.cross(this.camera.right, this.camera.forward, worldUp);
    Vec3Utils.normalize(this.camera.right, this.camera.right);
    Vec3Utils.cross(this.camera.up, this.camera.right, this.camera.forward);
    Vec3Utils.normalize(this.camera.up, this.camera.up);
  }

  /**
   * Per-frame update step with delta-time
   */
  public update(deltaSec: number) {
    if (this.mode === 'ORBIT' && this.orbitAutoRotate && !this.isMouseDown) {
      this.camera.yaw += this.orbitSpeed * deltaSec;
      this.updateOrbitPosition();
      return;
    }

    if (this.mode === 'FREE_FLIGHT') {
      const isSprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = (this.moveSpeed * (isSprinting ? this.sprintMultiplier : 1.0)) * deltaSec;

      const moveDir: Vec3 = [0, 0, 0];

      // W: Forward
      if (this.keys.has('KeyW')) {
        Vec3Utils.scaleAndAdd(moveDir, moveDir, this.camera.forward, 1.0);
      }
      // S: Backward
      if (this.keys.has('KeyS')) {
        Vec3Utils.scaleAndAdd(moveDir, moveDir, this.camera.forward, -1.0);
      }
      // D: Right
      if (this.keys.has('KeyD')) {
        Vec3Utils.scaleAndAdd(moveDir, moveDir, this.camera.right, 1.0);
      }
      // A: Left
      if (this.keys.has('KeyA')) {
        Vec3Utils.scaleAndAdd(moveDir, moveDir, this.camera.right, -1.0);
      }
      // E: Up
      if (this.keys.has('KeyE')) {
        Vec3Utils.scaleAndAdd(moveDir, moveDir, [0, 1, 0], 1.0);
      }
      // Q: Down
      if (this.keys.has('KeyQ')) {
        Vec3Utils.scaleAndAdd(moveDir, moveDir, [0, 1, 0], -1.0);
      }

      if (Vec3Utils.length(moveDir) > 0.0001) {
        Vec3Utils.normalize(moveDir, moveDir);
        Vec3Utils.scaleAndAdd(this.camera.position, this.camera.position, moveDir, speed);
      }

      this.camera.updateVectors();
    }
  }

  public setMode(mode: 'FREE_FLIGHT' | 'ORBIT') {
    this.mode = mode;
    if (mode === 'ORBIT') {
      this.updateOrbitPosition();
    } else {
      this.camera.updateVectors();
    }
  }

  public getTelemetry(): CameraTelemetry {
    return {
      position: [...this.camera.position],
      yawDeg: parseFloat(((this.camera.yaw * 180) / Math.PI).toFixed(1)),
      pitchDeg: parseFloat(((this.camera.pitch * 180) / Math.PI).toFixed(1)),
      fovDeg: Math.round(this.camera.fov),
      mode: this.mode,
    };
  }

  public reset(pos: Vec3 = [0, 1.5, 4.0], yaw = 0, pitch = 0) {
    this.camera.position = [...pos];
    this.camera.yaw = yaw;
    this.camera.pitch = pitch;
    this.camera.fov = 60;
    if (this.mode === 'ORBIT') {
      this.orbitRadius = Vec3Utils.length(pos);
      this.updateOrbitPosition();
    } else {
      this.camera.updateVectors();
    }
  }

  public dispose() {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    this.canvas.removeEventListener('mousedown', this.onMouseDownBound);
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    window.removeEventListener('mouseup', this.onMouseUpBound);
    this.canvas.removeEventListener('wheel', this.onWheelBound);
    this.canvas.removeEventListener('contextmenu', this.onContextMenuBound);
    this.keys.clear();
  }
}
