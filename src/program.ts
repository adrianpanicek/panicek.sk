import type { BrowserProgram } from './executables';
import { programWorker } from './program-worker';

// This bootstrap runs in an opaque origin; program code runs only in its worker.
function sandbox() {
  let worker: Worker;
  const send = (message: unknown) => parent.postMessage(message, '*');
  addEventListener('message', (event) => {
    if (event.source !== parent || worker || event.data?.type !== 'start') return;
    const url = URL.createObjectURL(new Blob([event.data.source], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (event) => {
      if (
        event.data?.type === 'view' &&
        typeof event.data.html === 'string' &&
        event.data.html.length <= 262144
      ) {
        const template = document.createElement('template');
        template.innerHTML = event.data.html;
        const tags = new Set(
          'div span p h1 h2 h3 h4 h5 h6 button input select option textarea label pre code br hr ul ol li table thead tbody tr td th canvas strong em small details summary style'.split(
            ' ',
          ),
        );
        const attributes = new Set(
          'id class title role type value checked disabled placeholder min max step rows cols selected multiple width height style'.split(
            ' ',
          ),
        );
        for (const element of template.content.querySelectorAll('*')) {
          if (!tags.has(element.tagName.toLowerCase())) {
            element.remove();
            continue;
          }
          for (const attribute of [...element.attributes])
            if (!attributes.has(attribute.name) && !attribute.name.startsWith('aria-'))
              element.removeAttribute(attribute.name);
        }
        document.body.replaceChildren(template.content);
      }
      send(event.data);
    };
    worker.onerror = (event) => {
      send({
        type: 'output',
        text: (event.message || 'Program worker failed to load') + '\n',
        error: true,
      });
      send({ type: 'exit', code: 1 });
    };
    worker.postMessage(event.data.request);
  });
  for (const type of ['click', 'input', 'change'])
    document.addEventListener(type, (event) => {
      const target = event.target instanceof Element ? event.target.closest('[id]') : null;
      if (target)
        worker?.postMessage({
          type: 'event',
          event: { type, id: target.id, value: 'value' in target ? String(target.value) : '' },
        });
    });
  document.addEventListener('click', (event) => {
    if ((event.target as Element)?.closest('a')) event.preventDefault();
  });
  document.addEventListener('submit', (event) => event.preventDefault());
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      send({ type: 'interrupt' });
    }
  });
  send({ type: 'ready' });
}

export function launchProgram(
  request: BrowserProgram,
  options: {
    onOutput: (text: string, error: boolean) => void;
    onExit: (code: number) => void;
  },
) {
  const frame = document.createElement('iframe');
  frame.className = 'browser-program';
  frame.title = request.executablePath;
  frame.sandbox.add('allow-scripts');
  frame.hidden = true;
  frame.style.cssText = 'width:100%;height:50vh;border:1px solid currentColor;background:#fff';
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><script nonce="${nonce}">(${sandbox.toString()})()<\/script>`;
  let done = false;
  let size = 0;
  let messages = 0;
  let initialized = false;
  const finish = (code: number) => {
    if (done) return;
    done = true;
    clearTimeout(deadline);
    removeEventListener('message', receive);
    frame.remove(); // Removing the owning document terminates its dedicated worker.
    options.onExit(code);
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || done) return;
    if (++messages > 10000) {
      options.onOutput('Program message limit exceeded\n', true);
      finish(1);
      return;
    }
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready' && !initialized) {
      initialized = true;
      frame.contentWindow!.postMessage(
        { type: 'start', source: `(${programWorker.toString()})()`, request },
        '*',
      );
    } else if (message.type === 'output' && typeof message.text === 'string') {
      size += message.text.length;
      if (size > 1048576) {
        options.onOutput('Program output exceeded 1 MiB\n', true);
        finish(1);
      } else options.onOutput(message.text, Boolean(message.error));
    } else if (message.type === 'view') {
      frame.hidden = false;
    } else if (message.type === 'exit') {
      finish(Number.isInteger(message.code) ? message.code & 255 : 1);
    } else if (message.type === 'interrupt') finish(130);
  };
  // An explicit ceiling also covers programs that never yield or never finish loading.
  const deadline = setTimeout(() => {
    options.onOutput('Program reached the 5 minute limit\n', true);
    finish(124);
  }, 300000);
  addEventListener('message', receive);
  const transcript = document.querySelector('#transcript')!;
  (transcript.querySelector('.entry:last-child') || transcript).append(frame);
  return () => finish(130);
}
