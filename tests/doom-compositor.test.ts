import { describe, expect, test } from 'bun:test';
import { createDoomCompositor, fitFourByThree } from '../src/doom/compositor';

type Handle = { kind: string; id: number };
type Uniform = { name: string };

class FakeWebGLContext {
  readonly ARRAY_BUFFER = 0x8892;
  readonly STATIC_DRAW = 0x88e4;
  readonly FLOAT = 0x1406;
  readonly TRIANGLES = 0x0004;
  readonly VERTEX_SHADER = 0x8b31;
  readonly FRAGMENT_SHADER = 0x8b30;
  readonly COMPILE_STATUS = 0x8b81;
  readonly LINK_STATUS = 0x8b82;
  readonly TEXTURE_2D = 0x0de1;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly NEAREST = 0x2600;
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly RGBA = 0x1908;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly UNPACK_ALIGNMENT = 0x0cf5;
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240;
  readonly COLOR_BUFFER_BIT = 0x4000;

  failCompilation = false;
  private nextId = 1;
  readonly shaders: Handle[] = [];
  readonly programs: Handle[] = [];
  readonly buffers: Handle[] = [];
  readonly textures: Handle[] = [];
  readonly shaderSources: string[] = [];
  readonly textureParameters: Array<[number, number]> = [];
  readonly pixelStores: Array<[number, number]> = [];
  readonly vectorUniforms: Array<[string, number, number]> = [];
  readonly uploads: ArrayBufferView[] = [];
  readonly draws: Array<[number, number, number]> = [];
  readonly viewports: Array<[number, number, number, number]> = [];
  readonly deletedShaders: Handle[] = [];
  readonly deletedPrograms: Handle[] = [];
  readonly deletedBuffers: Handle[] = [];
  readonly deletedTextures: Handle[] = [];

  createShader(type: number): Handle {
    const shader = { kind: type === this.VERTEX_SHADER ? 'vertex' : 'fragment', id: this.nextId++ };
    this.shaders.push(shader);
    return shader;
  }

  shaderSource(_shader: Handle, source: string): void {
    this.shaderSources.push(source);
  }

  compileShader(): void {}

  getShaderParameter(): boolean {
    return !this.failCompilation;
  }

  getShaderInfoLog(): string {
    return 'synthetic shader failure';
  }

  deleteShader(shader: Handle): void {
    this.deletedShaders.push(shader);
  }

  createProgram(): Handle {
    const program = { kind: 'program', id: this.nextId++ };
    this.programs.push(program);
    return program;
  }

  attachShader(): void {}
  linkProgram(): void {}

  getProgramParameter(): boolean {
    return true;
  }

  getProgramInfoLog(): string {
    return '';
  }

  deleteProgram(program: Handle): void {
    this.deletedPrograms.push(program);
  }

  createBuffer(): Handle {
    const buffer = { kind: 'buffer', id: this.nextId++ };
    this.buffers.push(buffer);
    return buffer;
  }

  bindBuffer(): void {}
  bufferData(): void {}

  deleteBuffer(buffer: Handle): void {
    this.deletedBuffers.push(buffer);
  }

  createTexture(): Handle {
    const texture = { kind: 'texture', id: this.nextId++ };
    this.textures.push(texture);
    return texture;
  }

  activeTexture(): void {}
  bindTexture(): void {}

  texParameteri(_target: number, parameter: number, value: number): void {
    this.textureParameters.push([parameter, value]);
  }

  pixelStorei(parameter: number, value: number): void {
    this.pixelStores.push([parameter, value]);
  }

  deleteTexture(texture: Handle): void {
    this.deletedTextures.push(texture);
  }

  useProgram(): void {}

  getAttribLocation(_program: Handle, name: string): number {
    return name === 'a_position' ? 0 : -1;
  }

  enableVertexAttribArray(): void {}
  vertexAttribPointer(): void {}

  getUniformLocation(_program: Handle, name: string): Uniform {
    return { name };
  }

  uniform1i(): void {}

  uniform2f(location: Uniform, x: number, y: number): void {
    this.vectorUniforms.push([location.name, x, y]);
  }

  texImage2D(
    _target: number,
    _level: number,
    _internalFormat: number,
    _width: number,
    _height: number,
    _border: number,
    _format: number,
    _type: number,
    pixels: ArrayBufferView,
  ): void {
    this.uploads.push(pixels);
  }

  viewport(x: number, y: number, width: number, height: number): void {
    this.viewports.push([x, y, width, height]);
  }

  clearColor(): void {}
  clear(): void {}

  drawArrays(mode: number, first: number, count: number): void {
    this.draws.push([mode, first, count]);
  }
}

class FakeCanvas extends EventTarget {
  width = 0;
  height = 0;
  style = { width: '', height: '' };
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor(readonly gl: FakeWebGLContext) {
    super();
  }

  getContext(contextId: string): WebGLRenderingContext | null {
    return contextId === 'webgl' ? (this.gl as unknown as WebGLRenderingContext) : null;
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options);
    if (!callback) return;
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback, options);
    if (callback) this.listeners.get(type)?.delete(callback);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

function asCanvas(canvas: FakeCanvas): HTMLCanvasElement {
  return canvas as unknown as HTMLCanvasElement;
}

function memoryWithFrame(byteLength: number): WebAssembly.Memory {
  const memory = new WebAssembly.Memory({ initial: 1 });
  new Uint8Array(memory.buffer, 8, byteLength).fill(127);
  return memory;
}

describe('Doom compositor geometry', () => {
  test.each([
    [1920, 1080, { width: 1440, height: 1080 }],
    [1280, 1024, { width: 1280, height: 960 }],
    [800, 1200, { width: 800, height: 600 }],
  ])('fits %ix%i inside a four-by-three boundary', (width, height, expected) => {
    expect(fitFourByThree(width, height)).toEqual(expected);
  });
});

describe('Doom WebGL compositor', () => {
  test('presents cached frames at animation cadence and cancels presentation on disposal', () => {
    const request = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const cancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callbacks.set(++id, callback);
        return id;
      },
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => callbacks.delete(id),
    });
    try {
      const gl = new FakeWebGLContext();
      const compositor = createDoomCompositor(asCanvas(new FakeCanvas(gl)), { crt: true });
      compositor.resize(640, 480);
      compositor.draw(memoryWithFrame(16), 8, 2, 2);
      expect(gl.draws).toHaveLength(1);
      expect(callbacks.size).toBe(1);
      const [nextId, callback] = [...callbacks][0];
      callbacks.delete(nextId);
      callback(16.7);
      expect(gl.draws).toHaveLength(2);
      expect(gl.uploads).toHaveLength(1);
      expect(callbacks.size).toBe(1);
      compositor.dispose();
      expect(callbacks.size).toBe(0);
      callback(33.4);
      expect(gl.draws).toHaveLength(2);
    } finally {
      if (request) Object.defineProperty(globalThis, 'requestAnimationFrame', request);
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      if (cancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancel);
      else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    }
  });

  test('uses nearest-neighbor texture filtering and reuses one texture and buffer across frames', () => {
    const gl = new FakeWebGLContext();
    const compositor = createDoomCompositor(asCanvas(new FakeCanvas(gl)));
    const memory = memoryWithFrame(2 * 2 * 4);

    compositor.draw(memory, 8, 2, 2);
    compositor.draw(memory, 8, 2, 2);

    expect(gl.textureParameters).toContainEqual([gl.TEXTURE_MIN_FILTER, gl.NEAREST]);
    expect(gl.textureParameters).toContainEqual([gl.TEXTURE_MAG_FILTER, gl.NEAREST]);
    expect(gl.pixelStores).toContainEqual([gl.UNPACK_FLIP_Y_WEBGL, 1]);
    expect(gl.vectorUniforms.filter(([name]) => name === 'u_textureSize')).toEqual([
      ['u_textureSize', 2, 2],
      ['u_textureSize', 2, 2],
    ]);
    expect(gl.textures).toHaveLength(1);
    expect(gl.buffers).toHaveLength(1);
    expect(gl.uploads).toHaveLength(2);
    expect(gl.draws).toEqual([
      [gl.TRIANGLES, 0, 6],
      [gl.TRIANGLES, 0, 6],
    ]);
    expect([...new Uint8Array(gl.uploads[0].buffer, gl.uploads[0].byteOffset, 16)]).toEqual(
      Array(16).fill(127),
    );
  });

  test('keeps a four-by-three CSS box and scales its backing store for device pixels', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 2 });
    try {
      const gl = new FakeWebGLContext();
      const canvas = new FakeCanvas(gl);
      const compositor = createDoomCompositor(asCanvas(canvas));

      compositor.resize(1920, 1080);

      expect(canvas.style).toEqual({ width: '1440px', height: '1080px' });
      expect([canvas.width, canvas.height]).toEqual([2880, 2160]);
      expect(gl.viewports.at(-1)).toEqual([0, 0, 2880, 2160]);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'devicePixelRatio', descriptor);
      else Reflect.deleteProperty(globalThis, 'devicePixelRatio');
    }
  });

  test.each([
    [800, 600, 0.0525, 0.07],
    [1920, 1080, 0.03333333333333333, 0.044444444444444446],
  ])(
    'normalizes terminal curvature for a %ix%i viewport on both pixel axes',
    (width, height, expectedX, expectedY) => {
      const gl = new FakeWebGLContext();
      const compositor = createDoomCompositor(asCanvas(new FakeCanvas(gl)));

      compositor.resize(width, height);

      const curve = gl.vectorUniforms.filter(([name]) => name === 'u_curve').at(-1);
      expect(curve).toBeDefined();
      expect(curve![1]).toBeCloseTo(expectedX);
      expect(curve![2]).toBeCloseTo(expectedY);
    },
  );

  test('pauses drawing while the context is lost and recreates resources after restoration', () => {
    const gl = new FakeWebGLContext();
    const canvas = new FakeCanvas(gl);
    const failures: Error[] = [];
    const compositor = createDoomCompositor(asCanvas(canvas), {
      onFailure: (error) => failures.push(error),
    });
    const memory = memoryWithFrame(16);
    const lost = new Event('webglcontextlost', { cancelable: true });

    canvas.dispatchEvent(lost);
    compositor.draw(memory, 8, 2, 2);
    expect(lost.defaultPrevented).toBe(true);
    expect(gl.draws).toHaveLength(0);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    compositor.draw(memory, 8, 2, 2);
    expect(gl.programs).toHaveLength(2);
    expect(gl.buffers).toHaveLength(2);
    expect(gl.textures).toHaveLength(2);
    expect(gl.draws).toHaveLength(1);
    expect(failures).toEqual([]);
  });

  test.each(['restore', 'dispose'])('cancels the context recovery deadline on %s', (action) => {
    const originalSet = globalThis.setTimeout;
    const originalClear = globalThis.clearTimeout;
    const timers = new Map<number, () => void>();
    let nextId = 0;
    globalThis.setTimeout = ((callback: () => void) => {
      timers.set(++nextId, callback);
      return nextId;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
    const canvas = new FakeCanvas(new FakeWebGLContext());
    const failures: Error[] = [];
    const compositor = createDoomCompositor(asCanvas(canvas), {
      onFailure: (error) => failures.push(error),
    });
    try {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      expect(timers.size).toBe(1);
      const deadline = [...timers.values()][0];
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      expect(timers.size).toBe(1);
      if (action === 'restore') canvas.dispatchEvent(new Event('webglcontextrestored'));
      else compositor.dispose();
      expect(timers.size).toBe(0);
      deadline();
      expect(failures).toEqual([]);
    } finally {
      compositor.dispose();
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    }
  });

  test('reports an unrecoverable resource failure after context restoration', () => {
    const gl = new FakeWebGLContext();
    const canvas = new FakeCanvas(gl);
    const failures: Error[] = [];
    createDoomCompositor(asCanvas(canvas), { onFailure: (error) => failures.push(error) });

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    gl.failCompilation = true;
    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('synthetic shader failure');
  });

  test('deletes every owned resource and removes context listeners exactly once', () => {
    const gl = new FakeWebGLContext();
    const canvas = new FakeCanvas(gl);
    const compositor = createDoomCompositor(asCanvas(canvas));
    expect(canvas.listenerCount()).toBe(2);

    compositor.dispose();
    compositor.dispose();

    expect(gl.deletedPrograms).toHaveLength(1);
    expect(gl.deletedShaders).toHaveLength(2);
    expect(gl.deletedBuffers).toHaveLength(1);
    expect(gl.deletedTextures).toHaveLength(1);
    expect(canvas.listenerCount()).toBe(0);
  });
});
