// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // SPA served by Nitro: the app works from local data, so there is nothing to server-render.
  ssr: false,
  modules: [
    '@nuxt/ui',
    '@nuxt/test-utils/module',
    '@nuxt/eslint',
    'nuxt-security',
    '@nuxtjs/i18n',
    '@vite-pwa/nuxt',
  ],
  // An installable PWA that opens offline: the service worker (`app/service-worker/sw.ts`)
  // precaches the app shell, the i18n catalogs and the icons (bundled into the JS, see
  // `icon`). API responses are never cached by it: the device store holds the data (ADR 0002).
  // The first visit is taken over right away, so it works offline without a reload; a new
  // version waits until every tab of the app is closed, or the "New version" toast reloads
  // (`useAppUpdatePrompt`). It also shows push notifications (#41).
  pwa: {
    // Off under Vitest, whose Nuxt environment can't load the service worker's virtual
    // modules; the ui e2e suite builds outside Vitest and gets the real thing, and the api
    // suite turns it back on.
    disable: !!process.env.VITEST,
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    client: {
      registerPlugin: !process.env.VITEST,
      // Looks for a new version hourly, as the app may stay open for days.
      periodicSyncForUpdates: 60 * 60,
      // Keeps the browser's install prompt for the install nudge on My Trips, which keeps its
      // own dismissal (`InstallNudge`).
      installPrompt: true,
    },
    manifest: {
      name: 'Owe Yeah',
      short_name: 'Owe Yeah',
      description: 'Shared Trip expenses, worked out exactly, even offline.',
      theme_color: '#10b981',
      background_color: '#ffffff',
      display: 'standalone',
      // Cut from `public/icon.svg`; the maskable one is a full-bleed square with the glyph
      // inside the safe zone (`app/assets/icons/app-mark.svg` says how to regenerate them).
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: '/maskable-icon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,json,svg,png,ico,woff,woff2}'],
    },
  },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', language: 'en-US', file: 'en.json' },
      { code: 'pl', language: 'pl-PL', file: 'pl.json' },
    ],
    langDir: '../i18n/locales',
    vueI18n: '../i18n/i18n.config.ts',
    // Follows the browser's language on every visit. Nothing remembers it: with no language
    // switcher, a cookie for it wouldn't be strictly necessary, and would need consent.
    detectBrowserLanguage: {
      useCookie: false,
      alwaysRedirect: false,
    },
  },
  app: {
    head: {
      // `viewport-fit=cover` lets the app draw under notches; headers and the tab bar pad
      // themselves with the safe-area insets.
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
    },
  },
  // Form-layout pages slide in and out; see `main.css`.
  experimental: {
    viewTransition: true,
  },
  css: ['~/assets/css/main.css'],
  // Bundle every Lucide icon referenced in app source, so icons never need a runtime fetch.
  // A missing icon stays blank rather than being fetched from the Iconify API, which would
  // send the visitor's IP to a third party.
  icon: {
    provider: 'none',
    fallbackToApi: false,
    clientBundle: {
      scan: true,
    },
  },
  // Bundled with @nuxt/ui. Follows the OS prefers-color-scheme until the user picks a mode.
  colorMode: {
    preference: 'system',
    fallback: 'light',
  },
  runtimeConfig: {
    // Where exchange rates come from (ADR 0003); `NUXT_FRANKFURTER_URL` points it at a
    // self-hosted Frankfurter, or at a stand-in in tests.
    frankfurterUrl: 'https://api.frankfurter.dev',
    // The VAPID keys Notifications are sent with (`NUXT_VAPID_PUBLIC_KEY`,
    // `NUXT_VAPID_PRIVATE_KEY`; `.env.example` says how to make a pair) and the
    // contact the push services see (`NUXT_VAPID_SUBJECT`, a `mailto:` or `https:` URL).
    // Without keys, notifications can't be turned on. Read from the server at runtime, not
    // baked into the app: the device asks `/api/vapid-key` for the public one.
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    // Push services are https only, so a device can't make the server post anywhere else;
    // `NUXT_NOTIFICATIONS_ALLOW_HTTP` lets the api e2e suite's stand-in push service be
    // plain http.
    notificationsAllowHttp: false,
    // The Git commit the server was built from, which `/healthz` reports. The runtime image
    // bakes it in as `NUXT_COMMIT_SHA` from its `COMMIT_SHA` build arg; the prerendered app
    // can't carry it.
    commitSha: 'dev',
    // Whether this server is a test environment, whose data may be wiped: `NUXT_TEST_ENVIRONMENT`
    // turns on the app's banner saying so (#105). The device asks `/api/environment`, as the
    // same image runs on test and production and the prerendered app can't carry it.
    testEnvironment: false,
  },
  // The files that name a version of the app are revalidated on every request, so a new
  // service worker isn't held back by a cache in between: Cloudflare caches `.js` by extension
  // otherwise. The hashed build assets they point to keep Nuxt's year-long immutable cache.
  routeRules: {
    '/sw.js': { headers: { 'cache-control': 'no-cache' } },
    '/': { headers: { 'cache-control': 'no-cache' } },
    '/index.html': { headers: { 'cache-control': 'no-cache' } },
    '/manifest.webmanifest': { headers: { 'cache-control': 'no-cache' } },
  },
  compatibilityDate: '2025-07-15',
  // Nitro defaults to es2019, which lacks the BigInt literals the domain package's exact
  // arithmetic uses; the server runs on Node 24.
  nitro: {
    esbuild: { options: { target: 'es2022' } },
    // The SPA shell as a static `index.html`, which the service worker precaches and serves
    // for every page while offline.
    prerender: { routes: ['/'] },
  },
  devtools: { enabled: true },
  security: {
    // The Trip link is the credential (ADR 0001) and there are no cookie sessions, so CSRF
    // tokens protect nothing here.
    csrf: false,
    // Keyed on `CF-Connecting-IP`, which Cloudflare sets to the client's address and a client
    // can't forge, unlike the `X-Forwarded-For` Cloudflare appends to. Without Cloudflare in
    // front the header is missing, and every client shares one limit.
    // Off in development, so Vite's many module requests don't exhaust the shared bucket, and
    // for the e2e suites (`UI_E2E`, and the api suite built under Vitest), whose requests all
    // come from one address.
    rateLimiter:
      process.env.NODE_ENV === 'development' || process.env.UI_E2E || process.env.VITEST
        ? false
        : { ipHeader: 'cf-connecting-ip' },
  },
  typescript: {
    // Disabled: the in-dev checker breaks under Nuxt's `/_nuxt/` base
    // (fi3ework/vite-plugin-checker#661). `type-check` still runs `vue-tsc` in CI.
    typeCheck: false,
    tsConfig: {
      // Adds unit tests to the app tsconfig; `test/nuxt` is already included by Nuxt. The
      // service worker has a tsconfig of its own, for its own global scope.
      include: ['../test/unit/**/*'],
      exclude: ['../app/service-worker/sw.ts'],
    },
  },
});
