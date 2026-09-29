import {useState} from 'react';

export function EggCups({bits}: {bits: string}) {
  const [value, setValue] = useState(() => parseInt(bits, 2));

  return (
    <div
      className="egg-cups"
      data-egg-cups=""
      role="group"
      aria-label="Binary egg-cup calculator"
    >
      {[...bits].map((_, index) => {
        const weight = 2 ** (bits.length - index - 1);

        return (
          <button
            key={weight}
            type="button"
            className="egg-cup"
            data-value={weight}
            aria-label={`${weight}'s place`}
            aria-pressed={Boolean(value & weight)}
            onClick={() => setValue(current => current ^ weight)}
          >
            <span aria-hidden="true" />
          </button>
        );
      })}
      <span className="egg-cups-equals" aria-hidden="true">
        =
      </span>
      <output aria-label="Decimal value" aria-live="polite">
        {value}
      </output>
    </div>
  );
}
