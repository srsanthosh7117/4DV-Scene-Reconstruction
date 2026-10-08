/**
 * Fragment Shader for 3D Gaussian Splats in WebGL2 (#version 300 es).
 *
 * How it works:
 * 1. Takes local quad coordinates v_uv [-2.0, +2.0] from vertex shader.
 * 2. Computes radial distance squared: r2 = uv.x^2 + uv.y^2.
 * 3. Clips fragments outside 2-sigma radius (r2 > 4.0) to eliminate unnecessary rasterization overhead.
 * 4. Computes true Gaussian radial falloff: G(r) = exp(-0.5 * r2).
 * 5. Multiplies by Gaussian base opacity.
 * 6. Outputs smooth anti-aliased RGBA color with alpha blending.
 */

export const GAUSSIAN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_color;
in float v_opacity;

out vec4 fragColor;

void main() {
    // Compute distance squared from Gaussian centroid
    float r2 = dot(v_uv, v_uv);

    // Hard cutoff at 2-sigma radius (r=2.0, r2=4.0)
    if (r2 > 4.0) {
        discard;
    }

    // Gaussian radial decay function: exp(-0.5 * (x^2 + y^2))
    float gaussianWeight = exp(-0.5 * r2);
    float alpha = v_opacity * gaussianWeight;

    // Discard nearly transparent fragments
    if (alpha < 0.005) {
        discard;
    }

    // Output final blended color
    fragColor = vec4(v_color, alpha);
}
`;
