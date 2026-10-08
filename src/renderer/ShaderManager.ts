/**
 * ShaderManager for WebGL2 pipeline.
 * Compiles shaders, links programs, and caches uniform locations.
 */

export class ShaderManager {
  private gl: WebGL2RenderingContext;
  private programs: Map<string, WebGLProgram> = new Map();
  private uniformLocations: Map<string, Map<string, WebGLUniformLocation>> = new Map();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /**
   * Compiles and links a WebGL2 shader program
   */
  public createProgram(name: string, vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;

    const vertShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) {
      throw new Error(`[ShaderManager] Failed to create WebGL program: ${name}`);
    }

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`[ShaderManager] Program link error (${name}): ${info}`);
    }

    // Clean up individual shaders once attached and linked
    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);

    this.programs.set(name, program);
    this.uniformLocations.set(name, new Map());
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('[ShaderManager] Unable to create WebGLShader object');
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      const typeStr = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
      throw new Error(`[ShaderManager] ${typeStr} Shader compilation failed: ${info}\nSource:\n${source}`);
    }

    return shader;
  }

  public getProgram(name: string): WebGLProgram {
    const prog = this.programs.get(name);
    if (!prog) {
      throw new Error(`[ShaderManager] Program '${name}' not found.`);
    }
    return prog;
  }

  public getUniformLocation(programName: string, uniformName: string): WebGLUniformLocation | null {
    const prog = this.getProgram(programName);
    const cache = this.uniformLocations.get(programName)!;

    if (cache.has(uniformName)) {
      return cache.get(uniformName) || null;
    }

    const loc = this.gl.getUniformLocation(prog, uniformName);
    if (loc) {
      cache.set(uniformName, loc);
    }
    return loc;
  }

  public dispose() {
    for (const prog of this.programs.values()) {
      this.gl.deleteProgram(prog);
    }
    this.programs.clear();
    this.uniformLocations.clear();
  }
}
