import { Mat4, Mat4Utils, Vec3, Vec3Utils } from '../utils/math';
import { CameraPose, CameraMatrices } from './types';

/**
 * 6-Degrees-of-Freedom (6-DoF) Camera for 4DV Player.
 * Computes forward/right/up vectors, view, projection, and view-projection matrices.
 */
export class Camera {
  public position: Vec3 = [0, 1.5, 4.0];
  public yaw: number = 0;   // In radians (0 = looking down -Z axis)
  public pitch: number = 0; // In radians (-PI/2 to PI/2)
  public roll: number = 0;  // In radians

  public fov: number = 60;  // Vertical Field of View (Degrees)
  public near: number = 0.05;
  public far: number = 100.0;
  public aspect: number = 16 / 9;

  // Directions
  public forward: Vec3 = [0, 0, -1];
  public right: Vec3 = [1, 0, 0];
  public up: Vec3 = [0, 1, 0];

  // Cached Matrices
  public viewMatrix: Mat4 = Mat4Utils.createIdentity();
  public projectionMatrix: Mat4 = Mat4Utils.createIdentity();
  public viewProjectionMatrix: Mat4 = Mat4Utils.createIdentity();

  private isDirty: boolean = true;

  constructor(initialPose?: Partial<CameraPose>) {
    if (initialPose) {
      this.setPose(initialPose);
    }
    this.updateVectors();
    this.updateMatrices();
  }

  public setPose(pose: Partial<CameraPose>) {
    if (pose.position) this.position = [...pose.position];
    if (pose.yaw !== undefined) this.yaw = pose.yaw;
    if (pose.pitch !== undefined) this.pitch = pose.pitch;
    if (pose.roll !== undefined) this.roll = pose.roll;
    if (pose.fov !== undefined) this.fov = pose.fov;
    if (pose.near !== undefined) this.near = pose.near;
    if (pose.far !== undefined) this.far = pose.far;
    this.isDirty = true;
  }

  public setAspect(aspect: number) {
    if (Math.abs(this.aspect - aspect) > 0.0001) {
      this.aspect = aspect;
      this.isDirty = true;
    }
  }

  /**
   * Recalculates forward, right, and up vectors from Euler yaw & pitch.
   */
  public updateVectors() {
    // Clamp pitch to prevent gimbal flip (-89.5 deg to +89.5 deg)
    const maxPitch = (89.5 * Math.PI) / 180;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    // Standard OpenGL coordinate frame (Yaw=0 points along -Z)
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    const cosYaw = Math.cos(this.yaw);
    const sinYaw = Math.sin(this.yaw);

    this.forward[0] = sinYaw * cosPitch;
    this.forward[1] = sinPitch;
    this.forward[2] = -cosYaw * cosPitch;
    Vec3Utils.normalize(this.forward, this.forward);

    // World Up is [0, 1, 0]
    const worldUp: Vec3 = [0, 1, 0];
    Vec3Utils.cross(this.right, this.forward, worldUp);
    Vec3Utils.normalize(this.right, this.right);

    Vec3Utils.cross(this.up, this.right, this.forward);
    Vec3Utils.normalize(this.up, this.up);

    this.isDirty = true;
  }

  /**
   * Recomputes View, Projection, and VP matrices.
   */
  public updateMatrices(): CameraMatrices {
    if (!this.isDirty) {
      return {
        viewMatrix: this.viewMatrix,
        projectionMatrix: this.projectionMatrix,
        viewProjectionMatrix: this.viewProjectionMatrix,
      };
    }

    // Target point = Position + Forward
    const target: Vec3 = [
      this.position[0] + this.forward[0],
      this.position[1] + this.forward[1],
      this.position[2] + this.forward[2],
    ];

    // Compute View Matrix
    Mat4Utils.lookAt(this.viewMatrix, this.position, target, this.up);

    // Compute Projection Matrix
    const fovRad = (this.fov * Math.PI) / 180;
    Mat4Utils.perspective(this.projectionMatrix, fovRad, this.aspect, this.near, this.far);

    // Compute VP Matrix = Projection * View
    Mat4Utils.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);

    this.isDirty = false;

    return {
      viewMatrix: this.viewMatrix,
      projectionMatrix: this.projectionMatrix,
      viewProjectionMatrix: this.viewProjectionMatrix,
    };
  }

  public getPose(): CameraPose {
    return {
      position: [...this.position],
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      fov: this.fov,
      near: this.near,
      far: this.far,
    };
  }
}
