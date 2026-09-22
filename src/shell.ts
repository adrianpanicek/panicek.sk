import { collectDownloads, type Download } from './downloads';
import { Bash, type BashExecResult, type IFileSystem, type ExecOptions } from 'just-bash/browser';
import { resolveExecutable, type ApplicationRequest } from './executables';
import { HOME } from './paths';

type ShellExecResult = BashExecResult & {
  documents: { path: string; text: string }[];
  downloads: Download[];
  editorPath?: string;
  application?: ApplicationRequest;
};

export const HELP = `Explore the portfolio\n\n  cat ~/ABOUT.md | render   About me\n  cat ~/CAREER.md | render  Career history\n  cat ~/CONTACTS.md | render  Get in touch\n  cat ~/portrait.txt  ASCII portrait\n  save <files...>    Download files (/usr/sbin/save)\n  vim <file>, vi      Edit a file (:w, :q, :wq)\n  ls, cd, pwd, find    Explore files\n  grep, sort, sed      Work with text and pipes\n  help                Show this help\n  clear               Clear the transcript\n  reset               Restore the published files\n\nTab completes paths. Shift+Enter adds a line; Enter runs it. Paste never auto-runs.\nUp/down browse history. Ctrl+C interrupts.\nEdits stay in this browser. Output is plain text. Pipe into render for Markdown and images. Markdown links run cat | render.\nOpen /~/CAREER.md in your address bar to read a raw file.\n`;
export function createShell(fs: IFileSystem) {
  let cwd = HOME;
  let env: Record<string, string> = {
    HOME,
    USER: 'web',
    LOGNAME: 'web',
    HOSTNAME: 'panicek.sk',
    TERM: 'xterm-256color',
    PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
  };
  const reads: string[] = [];
  const downloads: Download[] = [];
  let rendered: { path: string; text: string } | undefined;
  let editorPath: string | undefined;
  let interactiveEditor = false;
  const openEditor = async (args: string[]) => {
    if (!interactiveEditor)
      return {
        stdout: '',
        stderr: 'vim: use a standalone vim <file> command (no pipes or redirects)\n',
        exitCode: 1,
      };
    if (args.length > 1 || args.some((arg) => arg.startsWith('-')))
      return { stdout: '', stderr: 'Usage: vim [file]\n', exitCode: 1 };
    editorPath = fs.resolvePath(cwd, args[0] || 'untitled.txt');
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  const tracked = new Proxy(fs, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (['readFile', 'readFileBytes', 'readFileBuffer'].includes(String(property))) {
        return (path: string, ...args: unknown[]) => {
          reads.push(path);
          return value.call(target, path, ...args);
        };
      }
      return value.bind(target);
    },
  });
  const engine = new Bash({
    fs: tracked,
    cwd: HOME,
    env: {
      HOME,
      USER: 'web',
      LOGNAME: 'web',
      HOSTNAME: 'panicek.sk',
      TERM: 'xterm-256color',
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
    },
    executionLimits: {
      maxExecutionTimeMs: 5000,
      maxCommandCount: 2000,
      maxLoopIterations: 100000,
      maxOutputSize: 1024 * 1024,
      maxSourceBytes: 16384,
      maxLiveBytes: 16 * 1024 * 1024,
      maxFileSystemBytes: 8 * 1024 * 1024,
    },
    customCommands: [
      {
        name: '__portfolio_download',
        execute: async (args, ctx) => collectDownloads(ctx.fs, ctx.cwd, args, downloads),
      },
      {
        name: 'render',
        execute: async (args, ctx) => {
          if (args.length > 1)
            return {
              stdout: '',
              stderr: 'Usage: cat file.md | render, or render file.md\n',
              exitCode: 1,
            };
          try {
            const paths = [...new Set(reads)];
            const path = args.length
              ? ctx.fs.resolvePath(ctx.cwd, args[0])
              : paths.length === 1
                ? ctx.fs.resolvePath(ctx.cwd, paths[0])
                : ctx.cwd + '/.terminal-output.md';
            const text = args.length
              ? await ctx.fs.readFile(path)
              : new TextDecoder().decode(
                  Uint8Array.from(String(ctx.stdin), (character) => character.charCodeAt(0)),
                );
            rendered = { path, text };
            return { stdout: text, stderr: '', exitCode: 0 };
          } catch (error) {
            return { stdout: '', stderr: `render: ${String(error)}\n`, exitCode: 1 };
          }
        },
      },
      { name: 'vim', execute: openEditor },
      { name: 'vi', execute: openEditor },
      { name: 'help', execute: async () => ({ stdout: HELP, stderr: '', exitCode: 0 }) },
      { name: 'whoami', execute: async () => ({ stdout: 'web\n', stderr: '', exitCode: 0 }) },
      {
        name: 'hostname',
        execute: async () => ({ stdout: 'panicek.sk\n', stderr: '', exitCode: 0 }),
      },
    ],
  });
  return {
    fs,
    getCwd: () => cwd,
    async exec(command: string, options?: ExecOptions): Promise<ShellExecResult> {
      reads.length = 0;
      downloads.length = 0;
      editorPath = undefined;
      interactiveEditor = false;
      rendered = undefined;
      let markdown = false;
      try {
        const ast = engine.transform(command).ast;
        const statements = ast.statements;
        const pipeline = statements[0]?.pipelines[0];
        const cmd = pipeline?.commands[0];
        interactiveEditor =
          statements.length === 1 &&
          statements[0].pipelines.length === 1 &&
          !statements[0].background &&
          pipeline?.commands.length === 1 &&
          !pipeline.timed &&
          cmd?.type === 'SimpleCommand' &&
          !cmd.redirections.length &&
          ['vim', 'vi'].includes(
            cmd.name?.parts.map((part: any) => part.value || '').join('') || '',
          );
        const last = pipeline?.commands.at(-1);
        markdown =
          statements.length === 1 &&
          statements[0].pipelines.length === 1 &&
          !statements[0].background &&
          !pipeline?.timed &&
          last?.type === 'SimpleCommand' &&
          !last.redirections.some((r) => !['<', '<<<', '<<', '<<-'].includes(r.operator)) &&
          last.name?.parts.length === 1 &&
          last.name.parts[0].type === 'Literal' &&
          last.name.parts[0].value === 'render';

        const executable = await resolveExecutable(ast, fs, cwd);
        if (executable.kind === 'error')
          return {
            stdout: '',
            stderr: executable.stderr,
            exitCode: executable.exitCode,
            env,
            documents: [],
            downloads: [],
            application: undefined,
          };
        if (executable.kind === 'application')
          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            env,
            documents: [],
            downloads: [],
            application: executable.application,
          };
      } catch {}
      const result = await engine.exec(command, { ...options, cwd, env, replaceEnv: true });
      env = result.env;
      cwd = result.env.PWD || cwd;
      const documents: { path: string; text: string }[] = [];
      const document = rendered as { path: string; text: string } | undefined;
      if (markdown && result.exitCode === 0 && document && result.stdout === document.text)
        documents.push(document);
      return {
        ...result,
        documents,
        downloads: [...downloads],
        editorPath: editorPath as string | undefined,
        application: undefined,
      };
    },
  };
}
