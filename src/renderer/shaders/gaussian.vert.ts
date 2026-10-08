/**
 * Vertex Shader for 3D Gaussian Splats in WebGL2 (#version 300 es).
 *
 * How it works:
 * 1. Takes instance attributes (Gaussian center position, scale, color, opacity).
 * 2. Takes a 2D billboard quad corner [-2.0, +2.0] for instanced rendering.
 * 3. Transforms Gaussian center into camera/view space (u_view * u_model * vec4(pos, 1.0)).
 * 4. Expands the quad corners directly in view space along camera-aligned X and Y axes (billboard).
 * 5. Projects the billboard vertex into clip space (u_projection * viewPos).
 * 6. Passes normalized quad UV coordinates, color, and opacity to fragment shader.
 */

export const GAUSSIAN_VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex quad mesh attributes (billboard corners: [-2, -2] to [+2, +2])
layout(location = 0) in vec2 a_quadCorner;

// Per-instance Gaussian attributes
layout(location = 1) in vec3 a_position;
layout(location = 2) in vec3 a_scale;
layout(location = 3) in vec3 a_color;
layout(location = 4) in float a_opacity;

// Transform Uniforms
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;

// Outputs to Fragment Shader
out vec2 v_uv;
out vec3 v_color;
out float v_opacity;

void main() {
    v_uv = a_quadCorner;
    v_color = a_color;
    v_opacity = a_opacity;

    // Transform Gaussian center into camera view space
    vec4 viewCenter = u_view * u_model * vec4(a_position, 1.0);

    // Expand billboard quad in camera space based on Gaussian scale
    vec4 viewPos = viewCenter;
    viewPos.xy += a_quadCorner * a_scale.xy;

    // Transform to clip space
    gl_Position = u_projection * viewPos;
}
`;
