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
                                ▼
                 ┌─────────────────────────────┐
                 │  3D Morton Code Reordering  │ (Z-Curve Spatial Locality)
                 └──────────────┬──────────────┘
                                │
                                ▼
                 ┌─────────────────────────────┐
                 │  16-bit / 8-bit Quantizer   │ (3.12x Memory Reduction)
                 └──────────────┬──────────────┘
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
3. **16-bit / 8-bit Quantization**: Compact 16-bit position coordinates and 8-bit color/alpha attributes deliver **3.12x memory reduction** prior to entropy encoding with sub-millimeter reconstruction precision.
4. **3D Morton (Z-Order) Spatial Sorting**: Spatially reorders Gaussians along space-filling curves for optimal cache locality and compression entropy efficiency.
5. **GPU-Side 4D Trajectory Evaluation**: Polynomial motion coefficients are evaluated directly inside the vertex shader, avoiding per-frame CPU-GPU bandwidth bottlenecks.
6. **True 6-DoF Free Navigation**: Full 6-Degrees-of-Freedom first-person flight controls (`W`/`A`/`S`/`D`/`Q`/`E`/`Shift` + Mouse look) with real-time Euler rotation and dynamic LookAt view matrix generation.
7. **Interactive 4D Timeline**: Live time scrubber, variable playback speeds (0.25x–2x), discrete time jump testing, and sub-millisecond seeking.

---

## 🕹️ Controls & Navigation

* **`W` / `S`**: Move Forward / Backward
* **`A` / `D`**: Strafe Left / Right
* **`Q` / `E`**: Move Down / Up
* **`Shift`**: Sprint movement (2.5x speed)
* **`Mouse Drag`**: Look direction (Yaw / Pitch)
* **`Mouse Wheel`**: Adjust Field of View (FOV) / Orbit Dolly
* **`Separation Filters`**: View `All (1,200)`, `Static (360)`, or `Dynamic (840)`
* **`Run Compression Suite`**: Launches modal displaying exact mathematical reconstruction error across 8,400 sub-frame samples.
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
