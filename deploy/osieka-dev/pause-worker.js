// A Cloudflare Worker that pauses test: routed to `owe-yeah-test.osieka.dev/*`, it answers every
// request itself, so nothing reaches the tunnel. Deleting the route resumes test. Set up and used
// as the README's "Pausing test" describes.

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Owe Yeah is unavailable for now</title>
    <style>
      body {
        margin: 0 auto;
        padding: 3rem 1.5rem;
        max-width: 36rem;
        font: 1rem/1.5 system-ui, sans-serif;
        color: #1c1917;
        background: #fafaf9;
      }
      @media (prefers-color-scheme: dark) {
        body {
          color: #e7e5e4;
          background: #1c1917;
        }
        a {
          color: #93c5fd;
        }
      }
      section + section {
        margin-top: 2.5rem;
      }
    </style>
  </head>
  <body>
    <section>
      <h1>Owe Yeah is unavailable for now</h1>
      <p>This test environment is paused and will be back later.</p>
      <p>
        If you have the app installed, it still opens on your device. What you change there stays
        on the device and syncs once Owe Yeah is back.
      </p>
      <p>Questions: <a href="mailto:owe-yeah@osieka.dev">owe-yeah@osieka.dev</a></p>
    </section>
    <section lang="pl">
      <h1>Owe Yeah jest chwilowo niedostępny</h1>
      <p>To środowisko testowe jest wstrzymane i wróci później.</p>
      <p>
        Jeśli masz zainstalowaną aplikację, nadal otworzysz ją na swoim urządzeniu. Zmiany, które w
        niej wprowadzisz, zostają na urządzeniu i zsynchronizują się, gdy Owe Yeah wróci.
      </p>
      <p>Pytania: <a href="mailto:owe-yeah@osieka.dev">owe-yeah@osieka.dev</a></p>
    </section>
  </body>
</html>
`;

export default {
  fetch() {
    return new Response(page, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Not cached anywhere, so test answers again the moment the route is gone.
        'Cache-Control': 'no-store',
        'Retry-After': '3600',
      },
    });
  },
};
