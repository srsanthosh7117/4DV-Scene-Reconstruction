# 24-Hour Hackathon Development Log

**Problem Statement:** 4D Scene Reconstruction and a Traversable Video Format
**Artifact:** Lightweight Browser-Based 4DV Player

---

## Timeline & Milestones

### Hour 0:00 – Hour 0:30: Project Initialization & Foundations (Phase 1)
- Initialized clean Git repository.
- Bootstrapped modular React + TypeScript + Vite project structure.
- Configured strict TypeScript compiler options, path aliasing (`@/*`), and lightweight dependency graph.
- Designed complete architectural skeleton across `/renderer`, `/camera`, `/format`, `/timeline`, `/workers`, `/demo`, `/evaluation`, and `/utils`.
- Created `.gitignore`, `THIRD_PARTY.md`, and initial documentation.
- Verified local dev server compilation.

### Hour 0:30 – Hour 1:15: WebGL2 Viewport & Basic Gaussian Renderer (Phase 2)
- Implemented in-house 3D math engine (`Mat4Utils`, `Vec3`) without third-party math bloat.
- Built `ShaderManager` for GLSL 300 es vertex/fragment compilation, program linking, and uniform caching.
- Created `GAUSSIAN_VERTEX_SHADER` (#version 300 es) for camera view projection and camera-facing billboard expansion.
- Created `GAUSSIAN_FRAGMENT_SHADER` (#version 300 es) for mathematical Gaussian radial decay $G(r) = \exp(-0.5 \cdot r^2)$ with alpha cutoff at $2\sigma$.
- Built `GaussianRenderer` using WebGL2 Vertex Array Objects (VAO) and hardware instancing (`gl.drawArraysInstanced`) with a packed 10-float stride per Gaussian.
- Built `WebGLRenderer` managing WebGL2 canvas context, high-DPI resize tracking (`devicePixelRatio`), RAF render loop, and FPS diagnostic instrumentation.
- Created procedural 3D Gaussian test scene generator (`generateProceduralGaussianScene`) rendering 600 structured 3D Gaussians across a core cluster and torus spiral.
- Verified WebGL2 rendering and zero React DOM overhead during 60 FPS animation.

### Hour 1:15 – Hour 2:00: Full 6-DoF Camera System & Spatial Navigation (Phase 3)
- Built `Camera` class managing position $[x, y, z]$, yaw, pitch, roll, FOV, near/far clipping planes, and right-handed OpenGL coordinate frames.
- Implemented trigonometrical forward, right, and up vector generation and dynamic view-projection ($VP = P \times V$) updates.
- Built `CameraController` handling real-time inputs:
  - `W` / `A` / `S` / `D` for horizontal camera translation.
  - `Q` / `E` for vertical elevation translation.
  - `Shift` key for sprint velocity boosting ($\times 2.5$).
  - Mouse drag / Pointer events for continuous Yaw & Pitch flight orientation.
  - Mouse scroll wheel for dynamic FOV zooming and orbit dollying.
  - Switchable modes: 6-DoF Free Flight mode & Orbit Target mode.
- Integrated camera view matrices directly into `WebGLRenderer` per-frame pipeline.
- Implemented live Camera Telemetry HUD in `App.tsx` displaying real-time coordinate position, Euler yaw/pitch angles, and FOV.
- Verified smooth 60 FPS flight navigation through 3D Gaussian volume.
