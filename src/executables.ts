import { programFormat } from './program-format';
import type { Bash, IFileSystem } from 'just-bash/browser';

export type BrowserProgram = {
  name: 'browser';
  executablePath: string;
  args: string[];
  format: 'js' | 'wasm';
  bytes: Uint8Array;
};

export type ApplicationRequest =
  | BrowserProgram
  | {
      name: 'doom';
      executablePath: string;
      args: string[];
    };

export type ExecutableResolution =
  | { kind: 'none' }
  | { kind: 'error'; stderr: string; exitCode: number }
  | { kind: 'application'; application: ApplicationRequest };

type Script = ReturnType<Bash['transform']>['ast'];

const none: ExecutableResolution = { kind: 'none' };

export async function resolveExecutable(
  ast: Script,
  fs: IFileSystem,
  cwd: string,
): Promise<ExecutableResolution> {
  if (ast.statements.length !== 1) return none;
  const statement = ast.statements[0];
  if (statement.background || statement.pipelines.length !== 1) return none;
  const pipeline = statement.pipelines[0];
  if (pipeline.timed || pipeline.negated || pipeline.commands.length !== 1) return none;
  const command = pipeline.commands[0];
  if (command.type !== 'SimpleCommand' || command.redirections.length !== 0) return none;
  if (command.name?.parts.length !== 1 || command.name.parts[0].type !== 'Literal') return none;

  const commandName = command.name.parts[0].value;
  if (!commandName.includes('/')) return none;
  const executablePath = fs.resolvePath(cwd, commandName);

  let stat;
  let contents;
  try {
    stat = await fs.stat(executablePath);
    if (!stat.isFile) return none;
    contents = await fs.readFileBuffer(executablePath);
  } catch {
    return none;
  }

  const format = programFormat(await fs.realpath(executablePath), contents);
  const launcher = new TextDecoder()
    .decode(contents)
    .match(/^#!\/usr\/bin\/env portfolio-app\n([^\n]+)\n$/);
  if (!format && (!launcher || launcher[1] !== 'doom')) return none;
  if ((stat.mode & 0o111) === 0)
    return { kind: 'error', stderr: `bash: ${commandName}: Permission denied\n`, exitCode: 126 };
  if (format) {
    const literal = (parts: NonNullable<typeof command.name>['parts']): string =>
      parts
        .map((part) => {
          if (part.type === 'Literal' || part.type === 'SingleQuoted' || part.type === 'Escaped')
            return part.value;
          if (part.type === 'DoubleQuoted') return literal(part.parts);
          throw new Error('Use literal arguments (quotes are supported; expansions are not).');
        })
        .join('');
    try {
      if (command.assignments.length)
        throw new Error('Environment assignments are not supported for browser programs.');
      return {
        kind: 'application',
        application: {
          name: 'browser',
          executablePath,
          args: command.args.map((arg) => literal(arg.parts)),
          format,
          bytes: contents,
        },
      };
    } catch (error) {
      return {
        kind: 'error',
        stderr: `${commandName}: ${error instanceof Error ? error.message : error}\n`,
        exitCode: 2,
      };
    }
  }
  if (command.args.length !== 0)
    return { kind: 'error', stderr: 'DOOM: does not accept arguments\n', exitCode: 1 };

  return {
    kind: 'application',
    application: { name: 'doom', executablePath, args: [] },
  };
}
