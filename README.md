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
2. **True Gaussian Kernel Blending**: Fragment shader evaluates the exact radial decay $G(r) = \exp(-0.5 \cdot r^2)$ with $2\sigma$ envelope clipping, delivering soft, smooth splats.
3. **Decoupled Architecture**: UI is managed cleanly in React, while rendering is executed directly via typed arrays in WebGL2 without creating individual React elements per Gaussian.
4. **Deterministic Held-Out Evaluation**: Built-in camera matrix renderer for validation against ground-truth camera viewpoints.

---

## 🛠️ Project Structure

```text
4dv-player/
│
├── src/
│   ├── app/           # React UI shell, diagnostics HUD, status overlay
│   ├── renderer/      # WebGL2 engine, shader managers, instanced Gaussian rasterizer
│   │   ├── shaders/   # GLSL 300 es vertex & fragment Gaussian shaders
│   │   ├── GaussianRenderer.ts # VAO & instanced VBO manager
│   │   ├── ShaderManager.ts    # Program linker & uniform cache
│   │   └── WebGLRenderer.ts    # WebGL2 context & render loop
│   ├── camera/        # 6-DoF free flight / orbital camera controller (Phase 3)
│   ├── format/        # .4DV binary parser & decoder (Phase 5-7)
│   ├── timeline/      # Sub-millisecond scrub & playback rate controller (Phase 7)
│   ├── workers/       # Off-thread binary decoding web worker (Phase 12)
│   ├── demo/          # Procedural 3D/4D test scene generator
│   ├── evaluation/    # Held-out matrix pose evaluator (Phase 8/10)
│   └── utils/         # Fast vector/matrix arithmetic (Mat4Utils)
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
