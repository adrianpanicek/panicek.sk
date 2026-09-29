import {memo, useEffect, useState} from 'react';
import type {ImageDimensions} from '../markdown/tokens';
import {Article} from '../markdown/article';
import type {Entry, Output} from '../terminal/store';
import {displayPath} from '../paths';
import {Highlight} from './highlight';

function Downloads({files}: {files: {name: string; bytes: Uint8Array}[]}) {
  const [links, setLinks] = useState<{name: string; href: string}[]>([]);

  useEffect(() => {
    const next = files.map(file => ({
      name: file.name,
      href: URL.createObjectURL(
        new Blob([new Uint8Array(file.bytes)], {
          type: 'application/octet-stream',
        }),
      ),
    }));

    setLinks(next);

    return () => {
      for (const link of next) {
        URL.revokeObjectURL(link.href);
      }
    };
  }, [files]);

  return (
    <div className="downloads">
      {links.map((link, i) => (
        <DownloadLink key={i} {...link} />
      ))}
    </div>
  );
}

function DownloadLink({name, href}: {name: string; href: string}) {
  return (
    <a
      href={href}
      download={name}
      data-download=""
      ref={node => {
        node?.click();
      }}
    >
      Download {name}
    </a>
  );
}

const OutputView = memo(function OutputView({
  output,
  origin,
  imageDimensions,
}: {
  output: Output;
  origin: string;
  imageDimensions?: ImageDimensions;
}) {
  switch (output.kind) {
    case 'text':
      return (
        <pre className={output.error ? 'output error' : 'output'}>
          {output.text}
        </pre>
      );

    case 'article':
      return (
        <Article
          {...output}
          origin={origin}
          imageDimensions={imageDimensions}
        />
      );

    case 'downloads':
      return <Downloads files={output.files} />;
  }
});

export const EntryView = memo(function EntryView({
  entry,
  origin,
  imageDimensions,
}: {
  entry: Entry;
  origin: string;
  imageDimensions?: ImageDimensions;
}) {
  return (
    <section className="entry" id={entry.id}>
      {entry.command !== undefined && (
        <div className="prompt-line">
          <span className="user">web</span>@
          <span className="host">panicek.sk</span>{' '}
          <span className="cwd">{displayPath(entry.cwd)}</span>
          {' $ '}
          <Highlight line={entry.command} />
        </div>
      )}
      {entry.outputs.map(output => (
        <OutputView
          key={output.id}
          output={output}
          origin={origin}
          imageDimensions={imageDimensions}
        />
      ))}
      <div className="application-slot" />
    </section>
  );
});
