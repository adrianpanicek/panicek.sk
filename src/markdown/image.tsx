import {useEffect, useRef, type ImgHTMLAttributes} from 'react';

export function ArticleImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const source = image.current!;
    const bloom = canvas.current!;

    const paint = () => {
      if (!source.naturalWidth || !source.naturalHeight) {
        return;
      }

      const ratio = Math.min(
        1,
        256 / Math.max(source.naturalWidth, source.naturalHeight),
      );
      bloom.width = Math.max(1, Math.round(source.naturalWidth * ratio));
      bloom.height = Math.max(1, Math.round(source.naturalHeight * ratio));
      const context = bloom.getContext('2d');

      if (!context) {
        return;
      }

      context.drawImage(source, 0, 0, bloom.width, bloom.height);
      bloom.dataset.ready = 'true';
    };

    source.addEventListener('load', paint);

    if (source.complete) {
      paint();
    }

    return () => source.removeEventListener('load', paint);
  }, [props.src]);

  return (
    <span
      style={props.style?.width ? {width: props.style.width} : undefined}
      className={['crt-image', props.className].filter(Boolean).join(' ')}
    >
      <img
        {...props}
        className={undefined}
        style={props.style?.height ? {height: props.style.height} : undefined}
        ref={image}
      />
      <canvas ref={canvas} className="crt-image-bloom" aria-hidden="true" />
    </span>
  );
}
