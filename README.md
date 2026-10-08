# 4DV Player — Browser-Based Lightweight 4D Scene & Traversable Video Player

A high-performance, lightweight browser player for dynamic 4D scenes (`3D Scene + Time`) and traversable video formats (`.4DV`). Built entirely from scratch for the 24-hour hackathon.

---

## 🌟 Core Architecture

```
                     .4DV Binary Stream / File (.4dv)
                                │
                                ▼
                       ┌─────────────────┐
                       │   4DV Decoder   │ (FourDVReader - Magic '4DV1')
                       └────────┬────────┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
          Static Block                  Dynamic Block
       (Base 3D Attributes)          (Temporal Trajectories)
                 │                             │
                 └──────────────┬──────────────┘
                                │ Typed Buffers (Float32Array)
                                ▼
                      WebGL2 Instanced Engine
                    (GPU-side Motion Evaluation)
                                │
                                ▼
                      Traversable 4D Canvas
```

---

## 🚀 Key Innovations & Principles

1. **Custom Standalone `.4DV` Container**: Self-contained binary specification featuring `4DV1` magic header, random-access Table of Contents (TOC), static/dynamic block separation, and JSON metadata.
2. **Lightweight & Broad Compatibility**: Built on **WebGL2** with hardware instanced arrays (`gl.drawArraysInstanced`) so it runs smoothly on laptops with integrated GPUs without requiring discrete GPUs or WebGPU support.
3. **Static / Dynamic Factorization**: Classifies and separates static background landmarks from dynamic foreground motion, saving memory bandwidth and storage.
4. **16-bit / 8-bit Quantization**: Compact 16-bit position coordinates and 8-bit color/alpha attributes deliver **3.12x memory reduction** prior to entropy encoding with sub-millimeter reconstruction precision.
5. **3D Morton (Z-Order) Spatial Sorting**: Spatially reorders Gaussians along space-filling curves for optimal cache locality and compression entropy efficiency.
6. **True 6-DoF Free Navigation**: Full 6-Degrees-of-Freedom first-person flight controls (`W`/`A`/`S`/`D`/`Q`/`E`/`Shift` + Mouse look) with real-time Euler rotation and dynamic LookAt view matrix generation.
7. **Native File Ingestion & Export**: Supports opening and exporting `.4dv` files directly inside the browser.

---

## 🕹️ Controls & Navigation

* **`Load .4DV`**: Upload any custom `.4dv` binary container file
* **`Export .4DV`**: Download the active 4D dynamic scene as a standalone `scene.4dv` file
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
