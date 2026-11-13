import { expect, test, tripLinkFor } from './fixtures';

// Journeys of the privacy notice, the terms and the licenses, the app's icons, its language,
// and its cookies.

test('the terms link the licenses of the bundled dependencies, which open past the service worker', async ({
  page,
}) => {
  await page.goto('/terms');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await page.getByRole('main').getByRole('link', { name: '/licenses.txt' }).click();

  await expect(page).toHaveURL('/licenses.txt');
  await expect(page.locator('body')).toContainText('## dexie - ');
});

test('the tab, the home screen and the installed app all get the Owe Yeah icons', async ({
  page,
  request,
}) => {
  await page.goto('/');
  // The mark is decorative: the header link is named by the title alone.
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Owe Yeah', exact: true }),
  ).toBeVisible();
  const head = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest: { icons: { src: string; sizes: string; purpose: string }[] } = await (
    await request.get(manifestHref!)
  ).json();

  expect(head).toEqual(['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png']);
  expect(manifest.icons.map(({ sizes, purpose }) => `${sizes} ${purpose}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  // The SPA answers a missing file with its index page, so `ok()` alone would pass (#161).
  for (const href of [...head, ...manifest.icons.map(({ src }) => src)]) {
    const response = await request.get(href);
    expect(response.ok(), href).toBe(true);
    expect(response.headers()['content-type'], href).toMatch(/^image\//);
  }
});

test('opening the app leaves no cookies, so it needs no consent banner', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible();

  expect(await context.cookies()).toEqual([]);
});

test('a Polish browser gets the app in Polish, each time it opens it', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'pl-PL' });
  const page = await context.newPage();
  const myTrips = page.getByRole('heading', { name: 'Moje podróże' });

  await page.goto('/');
  await expect(myTrips).toBeVisible();
  // Nothing remembers the language: it is the browser's again on the next visit.
  await page.reload();
  await expect(myTrips).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  expect(await context.cookies()).toEqual([]);
  await context.close();
});

test('the privacy notice names who runs the app, in English and in Polish', async ({
  page,
  browser,
}) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy notice', level: 1 })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('NIP');
  await expect(page.getByRole('link', { name: 'owe-yeah@osieka.dev' }).first()).toBeVisible();

  const context = await browser.newContext({ locale: 'pl-PL' });
  const polish = await context.newPage();
  await polish.goto('/privacy');
  await expect(
    polish.getByRole('heading', { name: 'Polityka prywatności', level: 1 }),
  ).toBeVisible();
  await expect(polish.getByRole('main')).toContainText('Urzędu Ochrony Danych Osobowych');
  await context.close();
});

for (const [doc, path, title] of [
  ['privacy notice', '/privacy', 'Privacy notice'],
  ['terms', '/terms', 'Terms of service'],
] as const) {
  test(`the app opens the ${doc} offline after the first visit`, async ({ page, context }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);

    await page.goto(path);

    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await context.setOffline(false);
  });

  test(`My Trips, New Trip, joining a Trip and the Trip tab link the ${doc}`, async ({
    page,
    request,
  }) => {
    const heading = page.getByRole('heading', { name: title, level: 1 });

    await page.goto('/');
    await page.getByRole('link', { name: title }).click();
    await expect(heading).toBeVisible();

    await page.goto('/trips/new');
    await page.getByRole('link', { name: title }).click();
    await expect(heading).toBeVisible();

    // Joining from a Trip link asks "Who are you?" first; both are linked right there.
    const link = await tripLinkFor(request, 'Hel 2026', ['Ania', 'Kasia']);
    await page.goto(link);
    const sheet = page.getByRole('dialog', { name: 'Who are you?' });
    await sheet.getByRole('link', { name: title }).click();
    await expect(heading).toBeVisible();

    await page.goBack();
    await page.getByRole('link', { name: 'Trip', exact: true }).click();
    await page.getByRole('link', { name: title }).click();
    await expect(heading).toBeVisible();
  });
}

test('the terms name who provides the app and where to report illegal content, in English and in Polish', async ({
  page,
  browser,
}) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms of service', level: 1 })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main).toContainText('NIP');
  await expect(main.getByRole('heading', { name: 'Reporting illegal content' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'owe-yeah@osieka.dev' }).first()).toBeVisible();

  const context = await browser.newContext({ locale: 'pl-PL' });
  const polish = await context.newPage();
  await polish.goto('/terms');
  await expect(polish.getByRole('heading', { name: 'Regulamin', level: 1 })).toBeVisible();
  await expect(
    polish.getByRole('main').getByRole('heading', { name: 'Zgłaszanie nielegalnych treści' }),
  ).toBeVisible();
  await context.close();
});
