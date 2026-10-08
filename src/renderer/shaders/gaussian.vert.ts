/**
 * Vertex Shader for 4D Temporal Gaussian Splats in WebGL2 (#version 300 es).
 *
 * GPU-Side 4D Trajectory Evaluation:
 * P(t) = P0 + P1*t + P2*t^2 + Amplitude * sin(Freq * t + Phase)
 *
 * This performs exact temporal motion evaluation inside the GPU vertex shader,
 * avoiding expensive CPU-to-GPU transfers on every playback frame.
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

// Transform & Time Uniforms
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform float u_time;                      // Current playback timestamp t

// Outputs to Fragment Shader
out vec2 v_uv;
out vec3 v_color;
out float v_opacity;

void main() {
    v_uv = a_quadCorner;
    v_color = a_color;
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

    // 3. Expand billboard quad in camera space based on Gaussian scale
    vec4 viewPos = viewCenter;
    viewPos.xy += a_quadCorner * a_scale.xy;

    // 4. Transform to clip space
    gl_Position = u_projection * viewPos;
}
`;
