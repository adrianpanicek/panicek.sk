import {useEffect, useLayoutEffect, useState} from 'react';
import {readDisplayConfig, saveDisplayConfig} from '../display-config';
import {defaultBloom} from '../crt-bloom';
import {setupCrtPointer} from '../crt-pointer';
import {countVisitor} from '../visitors';

export function useDisplay() {
  const [config, setConfig] = useState({
    crt: false,
    animations: true,
  });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setConfig(readDisplayConfig());
    setReady(true);
  }, []);

  useLayoutEffect(() => {
    if (!ready) {
      return;
    }

    const root = document.documentElement;
    root.dataset.crt = config.crt ? 'on' : 'off';
    root.dataset.bloom = config.crt && defaultBloom() ? 'on' : 'off';
    root.dataset.animations = config.animations ? 'on' : 'off';
  }, [config, ready]);

  return {
    config,
    ready,

    toggle(key: keyof typeof config) {
      const main = document.querySelector('main')!;
      const curved = document.documentElement.dataset.crtCurved === 'ready';
      const scroll = config.crt && curved ? main.scrollTop : window.scrollY;
      const next = {...config, [key]: !config[key]};
      delete document.documentElement.dataset.crtPointer;

      // Set the layout mode before restoring the scroll position.
      if (key === 'crt') {
        document.documentElement.dataset.crt = next.crt ? 'on' : 'off';

        if (next.crt && curved) {
          main.scrollTop = scroll;
        } else {
          window.scrollTo(0, scroll);
        }
      }

      if (key === 'crt') {
        document.documentElement.dataset.bloom =
          next.crt && defaultBloom() ? 'on' : 'off';
        window.dispatchEvent(new Event('display-config-change'));
      }

      setConfig(next);
      saveDisplayConfig(next);
    },
  };
}

export function DisplayControls({
  display,
}: {
  display: ReturnType<typeof useDisplay>;
}) {
  const [visitors, setVisitors] = useState<number>();

  useEffect(() => {
    let active = true;
    void countVisitor().then(value => {
      if (active) {
        setVisitors(value);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      {visitors !== undefined && (
        <span id="visitor-count">visitors: {visitors.toLocaleString()}</span>
      )}
      {(['crt', 'animations'] as const).map(key => (
        <button
          key={key}
          id={`${key}-toggle`}
          type="button"
          hidden={!display.ready}
          aria-label={
            {
              crt: 'CRT effect',
              animations: 'Animations',
            }[key]
          }
          aria-pressed={display.config[key]}
          onClick={() => display.toggle(key)}
        >
          {key}: {display.config[key] ? 'on' : 'off'}
        </button>
      ))}
    </>
  );
}

const pixels = [
  'x',
  'xx',
  'xox',
  'xoox',
  'xooox',
  'xoooox',
  'xooooox',
  'xoooooox',
  'xooooooox',
  'xoooooooox',
  'xoooooxxxx',
  'xooxoox',
  'xox xoox',
  'xx  xoox',
  'x    xoox',
  '     xxxx',
];

const path = (pixel: string) =>
  pixels
    .flatMap((row, y) =>
      [...row].map((value, x) => (value === pixel ? `M${x} ${y}h1v1h-1z` : '')),
    )
    .join('');

export function CrtPointer() {
  useEffect(() => setupCrtPointer(), []);

  return (
    <div className="crt-pointer" aria-hidden="true">
      <svg
        viewBox="0 0 12 16"
        width="24"
        height="32"
        shapeRendering="crispEdges"
      >
        <path d={path('x')} fill="#10151b" />
        <path d={path('o')} fill="currentColor" />
      </svg>
    </div>
  );
}
