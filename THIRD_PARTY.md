# Third-Party Dependencies & Attributions

This document tracks all external open-source libraries used in the 4DV Player project, strictly adhering to hackathon transparency rules.

---

### React & React DOM
* **Version**: ^19.0.0
* **License**: MIT
* **Purpose**: User interface components, state management for player controls and status panels.
* **Functionality used**: UI shell, timeline slider state, modal dialogs, held-out pose input forms. (Rendering of 4D Gaussians is done directly in WebGL2, completely decoupled from React).

### Vite
* **Version**: ^6.2.0
* **License**: MIT
* **Purpose**: Development server and module bundler.
* **Functionality used**: Hot module reloading and bundling.

### TypeScript
* **Version**: ^5.7.3
* **License**: Apache-2.0
* **Purpose**: Static type checking and interface contracts for .4DV binary format specifications and mathematical abstractions.
* **Functionality used**: Type definitions and compile-time validation.

### Lucide React
* **Version**: ^1.16.0
* **License**: ISC
* **Purpose**: Minimal lightweight SVG icons for UI controls.
* **Functionality used**: Play, pause, camera, settings, speed icon glyphs.

---

### In-House / Scratch Implementations (No Third-Party Splatting/4D Engines)
* **WebGL2 4D Gaussian Splatting Engine**: Custom shader pipeline, instanced quads, polynomial trajectory evaluation.
* **.4DV Binary Format & Decoder**: Custom binary specification, chunk parser, and Web Worker thread offloading.
* **6-DoF Free Camera System**: Custom quaternion & matrix mathematics for 6-axis flight navigation.
* **Deterministic Held-Out Pose Evaluator**: Custom pose projection and canvas capture engine.
