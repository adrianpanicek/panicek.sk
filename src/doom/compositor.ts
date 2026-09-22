import {
  CRT_CURVE_LIMIT,
  CRT_CURVE_RATE,
  FRAGMENT_SHADER_SOURCE,
  VERTEX_SHADER_SOURCE,
} from './shaders';

export type FourByThreeSize = {
  width: number;
  height: number;
};

export type DoomCompositor = {
  resize(width: number, height: number): void;
  draw(memory: WebAssembly.Memory, pointer: number, width: number, height: number): void;
  dispose(): void;
};

export type DoomCompositorOptions = {
  onFailure?(error: Error): void;
  crt?: boolean;
  reducedMotion?(): boolean;
};

type Resources = {
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  texture: WebGLTexture;
  position: number;
  curve: WebGLUniformLocation;
  textureSize: WebGLUniformLocation;
  screenSize: WebGLUniformLocation;
  effects: WebGLUniformLocation;
};

export function fitFourByThree(width: number, height: number): FourByThreeSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Doom compositor dimensions must be positive finite numbers');
  }
  if (width / height > 4 / 3) return { width: (height * 4) / 3, height };
  return { width, height: (width * 3) / 4 };
}

function webGLContext(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL is unavailable');
  return gl;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create a WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown compilation error';
    gl.deleteShader(shader);
    throw new Error(`Unable to compile Doom compositor shader: ${message}`);
  }
  return shader;
}

function deleteResources(gl: WebGLRenderingContext, resources: Resources): void {
  gl.deleteTexture(resources.texture);
  gl.deleteBuffer(resources.buffer);
  gl.deleteProgram(resources.program);
  gl.deleteShader(resources.vertexShader);
  gl.deleteShader(resources.fragmentShader);
}

function createResources(gl: WebGLRenderingContext): Resources {
  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;

  try {
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    program = gl.createProgram();
    if (!program) throw new Error('Unable to create the Doom compositor program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Unable to link the Doom compositor program: ${gl.getProgramInfoLog(program) || 'unknown link error'}`,
      );
    }

    const position = gl.getAttribLocation(program, 'a_position');
    const frame = gl.getUniformLocation(program, 'u_frame');
    const textureSize = gl.getUniformLocation(program, 'u_textureSize');
    const curve = gl.getUniformLocation(program, 'u_curve');
    const screenSize = gl.getUniformLocation(program, 'u_screenSize');
    const effects = gl.getUniformLocation(program, 'u_effects');
    if (position < 0 || !frame || !textureSize || !curve || !screenSize || !effects) {
      throw new Error('Doom compositor shader inputs are unavailable');
    }

    buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to create the Doom compositor buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    texture = gl.createTexture();
    if (!texture) throw new Error('Unable to create the Doom compositor texture');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(frame, 0);
    gl.clearColor(0, 0, 0, 1);

    return {
      vertexShader,
      fragmentShader,
      program,
      buffer,
      texture,
      position,
      curve,
      textureSize,
      screenSize,
      effects,
    };
  } catch (error) {
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    throw error;
  }
}

function errorValue(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function applyGeometry(
  gl: WebGLRenderingContext,
  resources: Resources,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): void {
  gl.viewport(0, 0, canvas.width, canvas.height);
  if (cssWidth === 0 || cssHeight === 0) return;
  const curvePixels = Math.min(CRT_CURVE_LIMIT, Math.min(cssWidth, cssHeight) * CRT_CURVE_RATE);
  gl.useProgram(resources.program);
  gl.uniform2f(resources.curve, (2 * curvePixels) / cssWidth, (2 * curvePixels) / cssHeight);
  gl.uniform2f(resources.screenSize, cssWidth, cssHeight);
}

export function createDoomCompositor(
  canvas: HTMLCanvasElement,
  options: DoomCompositorOptions = {},
): DoomCompositor {
  let gl = webGLContext(canvas);
  let resources: Resources | null = createResources(gl);
  let contextLost = false;
  let disposed = false;
  let failureReported = false;
  let cssWidth = 0;
  let cssHeight = 0;
  let animationFrame: number | null = null;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelRecovery = () => {
    if (recoveryTimer !== null) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };

  const stopPresentation = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  };

  const present = () => {
    animationFrame = null;
    if (disposed || contextLost || failureReported || !resources) return;
    const band = Math.ceil((cssHeight * 0.14) / 12) * 12;
    const end = Math.ceil(cssHeight / 12) * 12;
    const top = options.reducedMotion?.()
      ? -band
      : -band + Math.floor(((performance.now() % 8000) / 8000) * ((band + end) / 12)) * 12;
    gl.useProgram(resources.program);
    gl.uniform2f(resources.effects, options.crt ? 1 : 0, top);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (typeof requestAnimationFrame === 'function')
      animationFrame = requestAnimationFrame(present);
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    if (disposed || failureReported || contextLost) return;
    contextLost = true;
    stopPresentation();
    resources = null;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (disposed || failureReported || !contextLost) return;
      failureReported = true;
      options.onFailure?.(new Error('WebGL context could not be restored'));
    }, 5000);
  };

  const onContextRestored = () => {
    if (disposed || failureReported) return;
    cancelRecovery();
    try {
      gl = webGLContext(canvas);
      resources = createResources(gl);
      contextLost = false;
      applyGeometry(gl, resources, canvas, cssWidth, cssHeight);
    } catch (error) {
      contextLost = true;
      failureReported = true;
      options.onFailure?.(errorValue(error));
    }
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  return {
    resize(width, height) {
      if (disposed) return;
      const fitted = fitFourByThree(width, height);
      cssWidth = fitted.width;
      cssHeight = fitted.height;
      const ratio =
        Number.isFinite(globalThis.devicePixelRatio) && globalThis.devicePixelRatio > 0
          ? globalThis.devicePixelRatio
          : 1;
      canvas.style.width = `${fitted.width}px`;
      canvas.style.height = `${fitted.height}px`;
      canvas.width = Math.max(1, Math.round(fitted.width * ratio));
      canvas.height = Math.max(1, Math.round(fitted.height * ratio));
      if (!contextLost && resources) applyGeometry(gl, resources, canvas, cssWidth, cssHeight);
    },

    draw(memory, pointer, width, height) {
      const current = resources;
      if (disposed || contextLost || !current) return;
      const byteLength = width * height * 4;
      if (
        !Number.isSafeInteger(pointer) ||
        pointer < 0 ||
        !Number.isSafeInteger(width) ||
        width <= 0 ||
        !Number.isSafeInteger(height) ||
        height <= 0 ||
        !Number.isSafeInteger(byteLength) ||
        pointer + byteLength > memory.buffer.byteLength
      ) {
        throw new RangeError('Doom framebuffer is outside WebAssembly memory');
      }

      const pixels = new Uint8Array(memory.buffer, pointer, byteLength);
      gl.useProgram(current.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, current.buffer);
      gl.enableVertexAttribArray(current.position);
      gl.vertexAttribPointer(current.position, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, current.texture);
      gl.uniform2f(current.textureSize, width, height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (animationFrame === null) present();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRecovery();
      stopPresentation();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (!contextLost && resources) deleteResources(gl, resources);
      resources = null;
    },
  };
}
