import type {TerminalState} from '../terminal/store';
import {displayPath} from '../paths';
import {Highlight} from './highlight';

export function CommandForm({state}: {state: TerminalState}) {
  return (
    <form
      id="command-form"
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      hidden={!state.interactive}
      aria-busy={state.busy}
    >
      <label htmlFor="command">
        <span className="user">web</span>@
        <span className="host">panicek.sk</span>{' '}
        <span id="cwd" className="cwd">
          {displayPath(state.cwd)}
        </span>{' '}
        <span id="exit-status">
          {state.exitCode ? `[${state.exitCode}] ` : ''}
        </span>
        {'$ '}
        <span className="sr-only">Shell command</span>
      </label>
      <div className="input-wrap">
        <div id="input-highlight" aria-hidden="true">
          <Highlight line={state.input} end={state.caret} />
          {!state.selection && (
            <span className="block-caret" aria-hidden="true" />
          )}
          <Highlight line={state.input} start={state.caret} />
        </div>
        <textarea
          rows={1}
          id="command"
          name="command"
          aria-label="Shell command"
          placeholder=" "
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          maxLength={16384}
          disabled={!state.enabled}
        />
      </div>
    </form>
  );
}
