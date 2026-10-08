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
                                │ Typed Buffers
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

1. **Lightweight & Broad Compatibility**: Built on **WebGL2** with instanced arrays so it runs smoothly on laptops with integrated GPUs without requiring discrete GPUs or WebGPU support.
2. **GPU-Side Motion Evaluation**: Position trajectories $P(t) = P_0 + P_1 t + P_2 t^2 + P_3 t^3$ are evaluated directly inside the vertex shader, avoiding CPU-GPU bandwidth bottlenecks each frame.
3. **Decoupled Architecture**: UI is managed cleanly in React, while rendering is executed directly via typed arrays in WebGL2.
4. **Deterministic Held-Out Evaluation**: Built-in camera matrix renderer for validation against ground-truth camera viewpoints.

---

## 🛠️ Project Structure

```text
4dv-player/
│
├── src/
│   ├── app/           # React UI shell, playback HUD, stats panel
│   ├── renderer/      # WebGL2 shader pipelines, VAOs, instanced Gaussian rasterizer
│   ├── camera/        # 6-DoF free flight / orbital camera controller
│   ├── format/        # .4DV binary parser, header schemas, decompression
│   ├── timeline/      # Sub-millisecond scrub & playback rate controller
│   ├── workers/       # Off-thread binary decoding web worker
│   ├── demo/          # Procedural 4D dynamic Gaussian test scenes
│   ├── evaluation/    # Held-out matrix pose evaluator & deterministic renderer
│   └── utils/         # Fast vector/quaternion/matrix arithmetic
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
