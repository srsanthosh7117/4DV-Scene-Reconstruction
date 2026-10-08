import { Mat4, Vec3 } from '../utils/math';

export interface CameraPose {
  position: Vec3;
  yaw: number;   // Radians
  pitch: number; // Radians
  roll: number;  // Radians
  fov: number;   // Degrees
  near: number;
  far: number;
}

export interface CameraMatrices {
  viewMatrix: Mat4;
  projectionMatrix: Mat4;
  viewProjectionMatrix: Mat4;
}

export interface CameraTelemetry {
  position: Vec3;
  yawDeg: number;
  pitchDeg: number;
  fovDeg: number;
  mode: 'FREE_FLIGHT' | 'ORBIT';
}
