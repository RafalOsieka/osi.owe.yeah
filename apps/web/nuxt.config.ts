// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // SPA served by Nitro: the app works from local data, so there is nothing to server-render.
  ssr: false,
  modules: ['@nuxt/ui', '@nuxt/test-utils/module', '@nuxt/eslint', 'nuxt-security', '@nuxtjs/i18n'],
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', language: 'en-US', file: 'en.json' },
      { code: 'pl', language: 'pl-PL', file: 'pl.json' },
    ],
    langDir: '../i18n/locales',
    vueI18n: '../i18n/i18n.config.ts',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      cookieSecure: process.env.NODE_ENV === 'production',
      cookieCrossOrigin: false,
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
  icon: {
    clientBundle: {
      scan: true,
    },
  },
  // Bundled with @nuxt/ui. Follows the OS prefers-color-scheme until the user picks a mode.
  colorMode: {
    preference: 'system',
    fallback: 'light',
  },
  compatibilityDate: '2025-07-15',
  // Nitro defaults to es2019, which lacks the BigInt literals the domain package's exact
  // arithmetic uses; the server runs on Node 24.
  nitro: {
    esbuild: { options: { target: 'es2022' } },
  },
  devtools: { enabled: true },
  security: {
    // The Trip link is the credential (ADR 0001) and there are no cookie sessions, so CSRF
    // tokens protect nothing here.
    csrf: false,
    // Off in development, so Vite's many module requests don't exhaust the shared bucket.
    rateLimiter: process.env.NODE_ENV === 'development' ? false : undefined,
  },
  typescript: {
    // Disabled: the in-dev checker breaks under Nuxt's `/_nuxt/` base
    // (fi3ework/vite-plugin-checker#661). `type-check` still runs `vue-tsc` in CI.
    typeCheck: false,
    tsConfig: {
      // Adds unit tests to the app tsconfig; `test/nuxt` is already included by Nuxt.
      include: ['../test/unit/**/*'],
    },
  },
});
