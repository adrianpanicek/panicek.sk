import {flushSync} from 'react-dom';
import {useLayoutEffect, useState} from 'react';
import {setupCurvature} from '../crt';

export function CrtFilterDefinitions() {
  const [bloom, setBloom] = useState(false);

  useLayoutEffect(() => {
    const update = () =>
      setBloom(document.documentElement.dataset.bloom === 'on');

    update();

    const changed = () => flushSync(update);

    window.addEventListener('display-config-change', changed);

    return () => window.removeEventListener('display-config-change', changed);
  }, []);

  useLayoutEffect(() => setupCurvature(), []);

  return (
    <defs>
      <filter
        id="crt-curve"
        filterUnits="userSpaceOnUse"
        x="0"
        y="0"
        colorInterpolationFilters="sRGB"
      >
        <feImage
          id="crt-curve-map"
          x="0"
          y="0"
          preserveAspectRatio="none"
          result="curve"
        />
        <feDisplacementMap
          id="crt-curve-displacement"
          in="SourceGraphic"
          in2="curve"
          xChannelSelector="R"
          yChannelSelector="G"
          result="curved"
        />
        {bloom && (
          <>
            <feComponentTransfer
              data-crt-bloom=""
              in="curved"
              result="highlights"
            >
              <feFuncR type="linear" slope="1.5" intercept="-0.35" />
              <feFuncG type="linear" slope="1.5" intercept="-0.35" />
              <feFuncB type="linear" slope="1.5" intercept="-0.35" />
            </feComponentTransfer>
            <feGaussianBlur
              data-crt-bloom=""
              id="crt-bloom"
              in="highlights"
              stdDeviation="2.2"
              result="bloom"
            />
            <feComposite
              data-crt-bloom=""
              in="bloom"
              in2="curved"
              operator="arithmetic"
              k1="0"
              k2="0.3"
              k3="1"
              k4="0"
            />
          </>
        )}
      </filter>
    </defs>
  );
}
