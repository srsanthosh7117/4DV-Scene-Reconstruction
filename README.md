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
                 ┌─────────────────────────────┐
                 │ Static / Dynamic Separator  │
                 ├──────────────┬──────────────┤
                 │ Static (30%) │ Dynamic(70%) │
                 │ (10 floats)  │ (19 floats)  │
                 └──────────────┴──────────────┘
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
2. **Static / Dynamic Factorization**: Classifies and separates static background landmarks (30%) from dynamic foreground motion (70%), dramatically reducing memory bandwidth and compression payload size.
3. **GPU-Side 4D Trajectory Evaluation**: Polynomial motion coefficients $\mathbf{P}(t) = \mathbf{P}_0 + \mathbf{P}_1 t + \mathbf{P}_2 t^2 + \mathbf{A} \sin(\omega t + \phi)$ are evaluated directly inside the vertex shader, avoiding per-frame CPU-GPU bandwidth bottlenecks.
4. **True 6-DoF Free Navigation**: Full 6-Degrees-of-Freedom first-person flight controls (`W`/`A`/`S`/`D`/`Q`/`E`/`Shift` + Mouse look) with real-time Euler rotation and dynamic LookAt view matrix generation.
5. **Interactive 4D Timeline**: Live time scrubber, variable playback speeds (0.25x–2x), discrete time jump testing, and sub-millisecond seeking.
6. **Decoupled Architecture**: UI is managed cleanly in React, while rendering is executed directly via typed arrays in WebGL2 without creating individual React elements per Gaussian.

---

## 🕹️ Controls & Navigation

* **`W` / `S`**: Move Forward / Backward
* **`A` / `D`**: Strafe Left / Right
* **`Q` / `E`**: Move Down / Up
* **`Shift`**: Sprint movement (2.5x speed)
* **`Mouse Drag`**: Look direction (Yaw / Pitch)
* **`Mouse Wheel`**: Adjust Field of View (FOV) / Orbit Dolly
* **`Separation Filters`**: View `All (1,200)`, `Static (360)`, or `Dynamic (840)`
* **`Timeline Slider`**: Scrub through time $t \in [0, 5\text{s}]$
* **`Speed Selector`**: Adjust playback rate (0.25x, 0.5x, 1x, 2x)
* **`Test Points`**: Jump to normalized timestamps $t = 0.0, 0.25, 0.50, 0.75, 1.0$

---

## ⚡ Quick Start & Live Link

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Live Browser Viewport: **[http://localhost:3000/](http://localhost:3000/)**
