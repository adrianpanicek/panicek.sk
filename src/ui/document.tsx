import {CrtFilterDefinitions} from './crt-filter';
import {renderToString} from 'react-dom/server';
import {App} from './app';
import {createTerminalStore, type InitialPage} from '../terminal/store';

const description =
  'Adrián Paníček — embedded software engineer working with Rust, C++, backend systems, payments, and Linux.';

const title = 'Adrián Paníček — Software & Electronics';

const socialImageAlt =
  'Adrián Paníček’s terminal-style portfolio, with his portrait and software and electronics focus.';

export const serializeJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

export function renderPage(
  initial: InitialPage,
  canonical: string,
  bootScript: string,
) {
  const socialImage = `${initial.origin}/assets/social-card.png`;

  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Adrián Paníček',
    url: initial.origin,
    image: socialImage,
    description,
    jobTitle: 'Expert Embedded Software Engineer',
    sameAs: [
      'https://www.linkedin.com/in/adrian-panicek/',
      'https://github.com/adrianpanicek',
    ],
  };

  return (
    '<!doctype html>' +
    renderToString(
      <html lang="en" data-crt="off">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <script dangerouslySetInnerHTML={{__html: bootScript}} />
          <title>{title}</title>
          <meta name="author" content="Adrián Paníček" />
          <meta name="application-name" content="Adrián Paníček — Portfolio" />
          <meta name="description" content={description} />
          <meta name="robots" content="index,follow" />
          <meta name="theme-color" content="#0b0d10" />
          <link rel="canonical" href={canonical} />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="stylesheet" href="/assets/styles.css" />
          <link
            rel="preload"
            href="/filesystem.json"
            as="fetch"
            crossOrigin="anonymous"
            fetchPriority="high"
          />
          <link
            rel="alternate"
            type="text/plain"
            href="/llms-full.txt"
            title="Portfolio as Markdown"
          />
          {Object.entries({
            'og:type': 'website',
            'og:site_name': 'Adrián Paníček — Portfolio',
            'og:locale': 'en_GB',
            'og:title': title,
            'og:description': description,
            'og:url': canonical,
            'og:image': socialImage,
            'og:image:secure_url': socialImage,
            'og:image:type': 'image/png',
            'og:image:width': '1200',
            'og:image:height': '630',
            'og:image:alt': socialImageAlt,
          }).map(([property, content]) => (
            <meta key={property} property={property} content={content} />
          ))}
          {Object.entries({
            'twitter:card': 'summary_large_image',
            'twitter:title': title,
            'twitter:description': description,
            'twitter:image': socialImage,
            'twitter:image:alt': socialImageAlt,
          }).map(([name, content]) => (
            <meta key={name} name={name} content={content} />
          ))}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{__html: serializeJson(person)}}
          />
          <script
            id="initial-page"
            type="application/json"
            dangerouslySetInnerHTML={{__html: serializeJson(initial)}}
          />
          <script defer src="/assets/crt.js" />
          <script type="module" src="/assets/client.js" />
        </head>
        <body>
          <svg className="crt-filter" aria-hidden="true" width="0" height="0">
            <CrtFilterDefinitions />
          </svg>
          <div id="app">
            <App initial={initial} store={createTerminalStore(initial)} />
          </div>
        </body>
      </html>,
    )
  );
}
