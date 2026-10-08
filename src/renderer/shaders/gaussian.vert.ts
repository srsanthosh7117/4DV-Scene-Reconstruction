/**
 * Vertex Shader for 4D Temporal Gaussian Splats in WebGL2 (#version 300 es).
 *
 * GPU-Side 4D Trajectory Evaluation:
 * P(t) = P0 + P1*t + P2*t^2 + Amplitude * sin(Freq * t + Phase)
 */

export const GAUSSIAN_VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex quad mesh attributes (billboard corners: [-2, -2] to [+2, +2])
layout(location = 0) in vec2 a_quadCorner;

// Per-instance 4D Gaussian Base Attributes
layout(location = 1) in vec3 a_position;   // P0: Base 3D Position
layout(location = 2) in vec3 a_scale;      // Splat 3D Scale
layout(location = 3) in vec3 a_color;      // RGB Color [0..1]
layout(location = 4) in float a_opacity;   // Base Opacity [0..1]

// Per-instance Temporal Motion Coefficients
layout(location = 5) in vec3 a_velocity;   // P1: Linear Velocity
layout(location = 6) in vec3 a_accel;      // P2: Acceleration / Quadratic coefficient
layout(location = 7) in vec3 a_harmonic;   // Harmonic params: [Amplitude, Frequency, Phase]

// Transform & Render Uniforms
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform float u_time;                      // Current playback timestamp t
uniform float u_splatScale;                // Dynamic splat scale multiplier [0.1..3.0]
uniform int u_renderMode;                  // 0: RGB, 1: Motion Heatmap, 2: Depth, 3: Stream Class

// Outputs to Fragment Shader
out vec2 v_uv;
out vec3 v_color;
out float v_opacity;
out float v_depth;

void main() {
    v_uv = a_quadCorner;
    v_opacity = a_opacity;

    // 1. Evaluate 4D Trajectory at time t on GPU
    float t = u_time;
    float t2 = t * t;

    // Polynomial trajectory P(t) = P0 + P1*t + P2*t^2
    vec3 animatedPos = a_position + a_velocity * t + a_accel * t2;

    // Add harmonic oscillation if amplitude > 0
    if (a_harmonic.x > 0.0) {
        float osc = sin(a_harmonic.y * t + a_harmonic.z);
        animatedPos.y += a_harmonic.x * osc;
        animatedPos.x += (a_harmonic.x * 0.5) * cos(a_harmonic.y * t + a_harmonic.z);
    }

    // 2. Transform Gaussian center into camera view space
    vec4 viewCenter = u_view * u_model * vec4(animatedPos, 1.0);
    v_depth = -viewCenter.z;

    // Dynamic Color Modes
    if (u_renderMode == 1) {
        // Motion Energy Heatmap (Velocity + Accel + Harmonic magnitude)
        float motionEnergy = length(a_velocity) * 1.5 + length(a_accel) * 2.0 + a_harmonic.x * 2.5;
        float heat = clamp(motionEnergy, 0.0, 1.0);
        // Cool Blue (0.0) -> Cyan (0.3) -> Yellow (0.7) -> Bright Magenta/Red (1.0)
        vec3 heatColor = mix(vec3(0.05, 0.4, 0.9), vec3(0.0, 0.95, 0.8), smoothstep(0.0, 0.35, heat));
        heatColor = mix(heatColor, vec3(1.0, 0.8, 0.1), smoothstep(0.35, 0.7, heat));
        heatColor = mix(heatColor, vec3(1.0, 0.1, 0.4), smoothstep(0.7, 1.0, heat));
        v_color = heatColor;
    } else if (u_renderMode == 2) {
        // Depth Visualization (near: bright cyan, far: dark indigo)
        float dNorm = clamp((v_depth - 1.0) / 7.0, 0.0, 1.0);
        v_color = mix(vec3(0.1, 0.9, 1.0), vec3(0.1, 0.05, 0.3), dNorm);
    } else if (u_renderMode == 3) {
        // Static vs Dynamic Stream Classification
        bool isDynamic = (length(a_velocity) > 0.001 || length(a_accel) > 0.001 || a_harmonic.x > 0.001);
        v_color = isDynamic ? vec3(0.68, 0.35, 1.0) : vec3(0.0, 0.9, 0.85); // Dynamic: Violet, Static: Cyan
    } else {
        // Standard RGB
        v_color = a_color;
    }

    // 3. Expand billboard quad in camera space based on Gaussian scale * user scale
    float scaleFactor = max(u_splatScale, 0.05);
    vec4 viewPos = viewCenter;
    viewPos.xy += a_quadCorner * (a_scale.xy * scaleFactor);

    // 4. Transform to clip space
    gl_Position = u_projection * viewPos;
}
`;
