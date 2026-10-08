# 4DV Player — Browser-Based Lightweight 4D Scene & Traversable Video Player

A high-performance, lightweight browser player for dynamic 4D scenes (`3D Scene + Time`) and traversable video formats (`.4DV`). Built entirely from scratch for the 24-hour hackathon.

---

## 🌟 Core Architecture

```
                     .4DV Binary Stream / File
                                │
                                ▼
                       ┌─────────────────┐
                       │   4DV Decoder   │ (Web Worker)
                       └────────┬────────┘
                                │ Typed Buffers (Float32Array)
                                ▼
                      4D Gaussian Scene Model
                    (Static + Polynomial Motion)
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
         Playback Time t               6-DoF Camera Pose
          (Scrub/Play)               (WASDQE + Mouse Orbit)
                 │                             │
                 └──────────────┬──────────────┘
                                ▼
                      WebGL2 Instanced Engine
                    (GPU-side Motion Evaluation)
                                │
                                ▼
                      Traversable 4D Canvas
```

---

## 🚀 Key Innovations & Principles

1. **Lightweight & Broad Compatibility**: Built on **WebGL2** with hardware instanced arrays (`gl.drawArraysInstanced`) so it runs smoothly on laptops with integrated GPUs without requiring discrete GPUs or WebGPU support.
2. **True 6-DoF Free Navigation**: Full 6-Degrees-of-Freedom first-person flight controls (`W`/`A`/`S`/`D`/`Q`/`E`/`Shift` + Mouse look) with real-time Euler rotation and dynamic LookAt view matrix generation.
3. **True Gaussian Kernel Blending**: Fragment shader evaluates the exact radial decay $G(r) = \exp(-0.5 \cdot r^2)$ with $2\sigma$ envelope clipping, delivering soft, smooth splats.
4. **Decoupled Architecture**: UI is managed cleanly in React, while rendering is executed directly via typed arrays in WebGL2 without creating individual React elements per Gaussian.
5. **Deterministic Held-Out Evaluation**: Built-in camera matrix renderer for validation against ground-truth camera viewpoints.

---

## 🕹️ Camera Controls

* **`W` / `S`**: Move Forward / Backward
* **`A` / `D`**: Strafe Left / Right
* **`Q` / `E`**: Move Down / Up
* **`Shift`**: Sprint movement (2.5x speed)
* **`Mouse Drag`**: Look direction (Yaw / Pitch)
* **`Mouse Wheel`**: Adjust Field of View (FOV) / Orbit Dolly
* **Modes**: Switch between **6-DoF Free Flight** and **Orbit Target** via top navbar.

---

## 🛠️ Project Structure

```text
4dv-player/
│
├── src/
│   ├── app/           # React UI shell, diagnostics HUD, telemetry readout
│   ├── renderer/      # WebGL2 engine, shader managers, instanced Gaussian rasterizer
│   │   ├── shaders/   # GLSL 300 es vertex & fragment Gaussian shaders
│   │   ├── GaussianRenderer.ts # VAO & instanced VBO manager
│   │   ├── ShaderManager.ts    # Program linker & uniform cache
│   │   └── WebGLRenderer.ts    # WebGL2 context & render loop
│   ├── camera/        # 6-DoF free flight / orbital camera controller
│   │   ├── Camera.ts           # Euler math, vector calculations, matrix builder
│   │   ├── CameraController.ts # Key & pointer event handler, delta updates
│   │   └── types.ts            # CameraPose, CameraMatrices, CameraTelemetry
│   ├── format/        # .4DV binary parser & decoder (Phase 5-8)
│   ├── timeline/      # Sub-millisecond scrub & playback rate controller (Phase 11)
│   ├── workers/       # Off-thread binary decoding web worker (Phase 10)
│   ├── demo/          # Procedural 3D/4D test scene generator
│   ├── evaluation/    # Held-out matrix pose evaluator (Phase 13)
│   └── utils/         # Fast vector/matrix arithmetic (Mat4Utils, Vec3Utils)
│
├── docs/              # Architectural diagrams & specifications
├── THIRD_PARTY.md     # Third-party attributions & isolation boundaries
├── HACKATHON_LOG.md   # Chronological development log
├── package.json
└── vite.config.ts
```

---

## ⚡ Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```
