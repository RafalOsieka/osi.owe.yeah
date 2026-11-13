import { createTrip, expect, test, tripLinkFromInvite, tripWithExpenses } from './fixtures';

// Journeys of the Expense, Income and Repayment forms: Receipts, Contributions, Manual rates,
// Balances and settling up, leaving a form, and an Expense's History.

test('a Line discount follows the Units and a Receipt discount is shared by what is left', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Title').fill('Konoba');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  await adding.getByLabel('New Line item unit price').fill('2,00');
  await adding.getByLabel('New Line item quantity').fill('5');
  await adding.getByLabel('New Line item name').fill('Beer');
  await adding.getByRole('button', { name: 'Add' }).click();

  const beer = page.getByRole('region', { name: 'Line items' }).getByRole('listitem').first();
  await beer.getByRole('button', { name: /Beer/ }).click();
  await beer.getByRole('button', { name: 'Units' }).click();
  await beer.getByLabel('Units for Kasia').fill('2');
  await beer.getByLabel('Units for Ania').fill('2');
  await beer.getByLabel('Units for Ola').fill('1');
  // The stepper takes what is typed when it loses focus; once every unit is assigned, the
  // unassigned note above goes and the line moves up.
  await beer.getByLabel('Units for Ola').press('Tab');
  await expect(page.getByRole('main')).not.toContainText('unassigned');
  await beer.getByRole('button', { name: 'Line discount and Deposit' }).click();
  await beer.getByRole('textbox', { name: 'Line discount' }).fill('1');
  await beer.getByRole('button', { name: 'Done' }).click();
  await expect(beer).toContainText('€1.00 off, included');
  const total = page.getByRole('status', { name: 'Receipt total' });
  await expect(total).toHaveText('€9.00');

  await page.getByRole('textbox', { name: 'Receipt discount' }).fill('10');
  await page
    .getByRole('group', { name: 'Receipt discount: amount or percent' })
    .getByRole('button', { name: '%' })
    .click();
  await expect(total).toHaveText('€8.10');
  await expect(page.getByRole('main')).toContainText('10% off (−€0.90)');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  const row = page.getByRole('link', { name: /Konoba/ });
  await expect(row).not.toContainText('not synced');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(await tripLinkFromInvite(page));
  await otherPage.getByRole('dialog').getByRole('button', { name: 'Ania' }).click();
  const otherRow = otherPage.getByRole('link', { name: /Konoba/ });
  // Two beers at 1.80 after the Line discount, less 10 %.
  await expect(otherRow).toContainText('your share €3.24');
  await otherRow.click();
  const main = otherPage.getByRole('main');
  await expect(main).toContainText('€1.00 off, included');
  await expect(main).toContainText('Receipt discount');
  await expect(main).toContainText('10% off (−€0.90)');
  await other.close();
});

test('a Deposit is never discounted, and a Deposit refund comes off the Receipt total', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Title').fill('Lidl Rovinj');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  await adding.getByLabel('New Line item unit price').fill('0,53');
  await adding.getByLabel('New Line item quantity').fill('10');
  await adding.getByLabel('New Line item name').fill('Mineral water');
  await adding.getByLabel('New Line item Deposit per unit').fill('0,25');
  await adding.getByRole('button', { name: 'Add' }).click();

  const total = page.getByRole('status', { name: 'Receipt total' });
  await expect(total).toHaveText('€7.80');
  // The Deposits total, to check against the Deposits printed on the paper Receipt.
  await expect(page.getByRole('main')).toContainText(/Deposits\s*€2\.50/);

  // A −10 % coupon takes 10 % of the 5.30 of water, not of its Deposit.
  await page.getByRole('textbox', { name: 'Receipt discount' }).fill('10');
  await page
    .getByRole('group', { name: 'Receipt discount: amount or percent' })
    .getByRole('button', { name: '%' })
    .click();
  await expect(total).toHaveText('€7.27');

  await page.getByRole('button', { name: 'Add a Deposit refund' }).click();

  const refund = page.getByRole('group', { name: 'Add a Deposit refund' });
  await refund.getByLabel('Deposit refund amount').fill('1');
  await refund.getByRole('button', { name: 'Add' }).click();
  await expect(total).toHaveText('€6.27');
  const lines = page.getByRole('region', { name: 'Line items' }).getByRole('listitem');
  await expect(lines.nth(1)).toContainText('Deposit refund');
  await expect(lines.nth(1)).toContainText('−€1.00');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  const row = page.getByRole('link', { name: /Lidl Rovinj/ });
  await expect(row).not.toContainText('not synced');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(await tripLinkFromInvite(page));
  await otherPage.getByRole('dialog').getByRole('button', { name: 'Ania' }).click();
  const otherRow = otherPage.getByRole('link', { name: /Lidl Rovinj/ });
  // Water, Deposit and the refund are all split Even, so a third of 6.27 each.
  await expect(otherRow).toContainText('your share €2.09');
  await otherRow.click();
  const main = otherPage.getByRole('main');
  await expect(main).toContainText('Deposit €2.50');
  await expect(main).toContainText('Deposit refund');
  await expect(main).toContainText('Deposits');
  await other.close();
});

test('a share on a Receipt and a bar on Balances open where the share comes from', async ({
  page,
}) => {
  await page.goto('/');
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Title').fill('Lidl Rovinj');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  await adding.getByLabel('New Line item unit price').fill('0,53');
  await adding.getByLabel('New Line item quantity').fill('10');
  await adding.getByLabel('New Line item Deposit per unit').fill('0,25');
  await adding.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('textbox', { name: 'Receipt discount' }).fill('10');
  await page
    .getByRole('group', { name: 'Receipt discount: amount or percent' })
    .getByRole('button', { name: '%' })
    .click();
  await page.getByRole('button', { name: 'Add a Deposit refund' }).click();
  const refund = page.getByRole('group', { name: 'Add a Deposit refund' });
  await refund.getByLabel('Deposit refund amount').fill('1');
  await refund.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // 6.27 split Even by three is 2.09 each, exactly; its parts each round to the cent.
  await page.getByRole('link', { name: /Lidl Rovinj/ }).click();
  await page.getByRole('region', { name: 'Shares' }).getByRole('button', { name: /Ania/ }).click();
  const sheet = page.getByRole('dialog', { name: "Ania's share" });
  await expect(sheet).toContainText('Goods at full price€1.77');
  await expect(sheet).toContainText('Deposits€0.83');
  await expect(sheet).toContainText('Deposit refunds−€0.33');
  await expect(sheet).toContainText('Receipt discount−€0.18');
  await expect(sheet).toContainText('Share€2.09');
  await expect(sheet).toContainText('rounded to the cent');

  // System back closes the sheet first, then leaves the Expense.
  await page.goBack();
  await expect(sheet).toBeHidden();
  await page.goBack();
  await page.getByRole('link', { name: 'Balances' }).click();
  await page
    .getByRole('region', { name: 'Everyone' })
    .getByRole('button', { name: /Kasia/ })
    .click();
  const kasia = page.getByRole('dialog', { name: "Kasia's balance" });
  await expect(kasia).toContainText('Paid€6.27');
  await expect(kasia).toContainText('Share€2.09');
  // Kasia is who you are.
  await expect(kasia).toContainText("You're owed€4.18");
});

test('Contributions from others: added, edited and removed, the Main payer covering the rest', async ({
  page,
}) => {
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  // Dinner on Kasia's card, and Ania leaves a cash tip.
  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('60');
  await page.getByLabel('Title').fill('Konoba Batelina');
  await page.getByRole('button', { name: 'Add a Contribution' }).click();
  await page.getByRole('menuitem', { name: 'Ania' }).click();
  const aniasContribution = page.getByRole('textbox', { name: 'Contribution from Ania' });
  await expect(aniasContribution).toBeFocused();
  await aniasContribution.fill('6');
  const form = page.getByRole('main');
  await expect(form).toContainText(/Kasia pays the rest\s*you\s*€54\.00/);
  // Income has no Contributions.
  await expect(page.getByRole('switch', { name: 'Money received' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // Kasia paid 54.00 of her 20.00 share.
  const row = page.getByRole('link', { name: /Konoba Batelina/ });
  await expect(row).toContainText('you lent €34.00');
  await row.click();
  const payers = page.getByRole('region', { name: 'Paid by' }).getByRole('listitem');
  await expect(payers).toHaveCount(2);
  await expect(payers.filter({ hasText: 'Kasia' })).toContainText('€54.00');
  await expect(payers.filter({ hasText: 'Ania' })).toContainText('Contribution');
  await expect(payers.filter({ hasText: 'Ania' })).toContainText('€6.00');

  // The bill was 75.00 after all: only Kasia's part changes.
  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await expect(aniasContribution).toHaveValue('6.00');
  await page.getByLabel('Amount').fill('75');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(payers.filter({ hasText: 'Kasia' })).toContainText('€69.00');
  await expect(payers.filter({ hasText: 'Ania' })).toContainText('€6.00');

  // Without her Contribution, Ania can be the Main payer.
  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await page.getByRole('button', { name: 'Remove the Contribution from Ania' }).click();
  const paidBy = page.getByRole('group', { name: 'Paid by' });
  await paidBy.getByRole('radio', { name: 'Ania' }).click();
  await expect(paidBy.getByRole('radio', { name: 'Ania' })).toBeChecked();
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(payers).toHaveCount(1);
  await expect(payers).toContainText('Ania');
  await expect(payers).toContainText('€75.00');
});

test('a Trip rule the Expense would break shows at its field before saving', async ({ page }) => {
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania']);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Add a Contribution' }).click();
  await page.getByRole('menuitem', { name: 'Ania' }).click();
  const aniasContribution = page.getByRole('textbox', { name: 'Contribution from Ania' });
  await aniasContribution.fill('15');
  await expect(aniasContribution).toHaveAccessibleDescription(
    'The Contributions add up to more than the Expense.',
  );

  // It goes as soon as the Expense no longer breaks it, whichever field changed.
  await page.getByLabel('Amount').fill('20');
  await expect(aniasContribution).not.toHaveAccessibleDescription(/more than the Expense/);
  await expect(page.getByRole('main')).toContainText(/Kasia pays the rest\s*you\s*€5\.00/);
});

test('a Manual rate: the amount the card charged in the Trip currency', async ({ page }) => {
  await createTrip(page, 'Lisbon 2026', 'Kasia', ['Ania']);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('100');
  await page.getByLabel('Title').fill('Dinner in USD');
  await page.getByRole('button', { name: 'Currency' }).click();
  await page.keyboard.type('USD');
  await page.getByRole('option', { name: /^USD/ }).click();
  // The field opens by itself while the device has no automatic rate for USD, and the suite's
  // Frankfurter stand-in has none.
  const manualRate = page.getByRole('textbox', { name: 'Amount charged in EUR' });
  await manualRate.fill('92');
  await expect(page.getByRole('main')).toContainText('Rate: 1 EUR ≈ 1.087 USD');
  await page.getByRole('button', { name: 'Save Expense' }).click();

  const row = page.getByRole('link', { name: /Dinner in USD/ });
  await expect(row).toContainText('$100.00');
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('main')).toContainText('Trip total €92.00');

  await page.getByRole('link', { name: 'Expenses' }).click();
  await row.click();
  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await expect(manualRate).toHaveValue('92.00');
});

test('record a plain Expense, read it, edit it, and see the balances', async ({ page }) => {
  await createTrip(page, 'Istria 2026', 'Kasia', ['Ania', 'Ola']);

  // The Main payer defaults to the Claim, and everyone is ticked.
  await page.getByRole('link', { name: 'Add Expense' }).click();
  await expect(page.getByRole('banner')).toContainText('New Expense');
  await expect(page).toHaveTitle('New Expense | Owe Yeah');
  const paidBy = page.getByRole('group', { name: 'Paid by' });
  const forWhom = page.getByRole('group', { name: 'For whom' });
  await expect(paidBy.getByRole('radio', { name: 'Kasia' })).toBeChecked();
  for (const name of ['Kasia', 'Ania', 'Ola']) {
    await expect(forWhom.getByRole('checkbox', { name })).toBeChecked();
  }
  // "Clear" unticks everyone when everyone is ticked, and "Select all" ticks everyone again.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(forWhom.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(forWhom.getByRole('checkbox', { checked: true })).toHaveCount(3);

  await page.getByLabel('Title').fill('Lidl Rovinj');
  // Time and zone are one line until tapped.
  await page.getByRole('button', { name: /^When/ }).click();
  await page.getByLabel('When').fill('2026-07-14T23:30');
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // Back on the Expenses tab, under the Expense's day with the day's total.
  await expect(page.getByRole('link', { name: 'Expenses' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // The year shows only when it isn't this one.
  await expect(page.getByRole('heading', { name: /^Tuesday, July 14(, 2026)?$/ })).toBeVisible();
  const row = page.getByRole('link', { name: /Lidl Rovinj/ });
  await expect(row).toContainText('Kasia paid · for all 3');
  await expect(row).toContainText('€10.00');
  // 10.00 for three doesn't split into whole cents.
  await expect(row).toContainText('you lent ≈ €6.67');
  await expect(page.getByRole('link', { name: 'Add Expense' })).toBeVisible();

  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByRole('heading', { name: "You're owed" })).toBeVisible();
  const main = page.getByRole('main');
  // Balances are rounded so they add up to zero: the cent left over goes to Ola, the
  // Participant added last, on the tie.
  await expect(main).toContainText('€6.67');
  await expect(main).toContainText('You paid €10.00 · your share ≈ €3.33');
  const bars = page.getByRole('region', { name: 'Everyone' }).getByRole('listitem');
  await expect(bars.filter({ hasText: 'Kasia' })).toContainText('+€6.67');
  await expect(bars.filter({ hasText: 'Ania' })).toContainText('−€3.33');
  await expect(bars.filter({ hasText: 'Ola' })).toContainText('−€3.34');
  await expect(main).toContainText('Trip total €10.00');

  // The detail page shows the Expense in full; edit from there.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Lidl Rovinj' })).toBeVisible();
  await expect(main).toContainText('11:30 PM');
  const shares = page.getByRole('region', { name: 'For whom · Even' }).getByRole('listitem');
  await expect(shares).toHaveCount(3);
  await expect(shares.filter({ hasText: 'Ola' })).toContainText('≈ €3.33');

  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await expect(page).toHaveTitle('Edit Expense | Owe Yeah');
  await expect(page.getByLabel('Amount')).toHaveValue('10.00');
  await page.getByRole('button', { name: /^When/ }).click();
  await expect(page.getByLabel('When')).toHaveValue('2026-07-14T23:30');
  await page.getByLabel('Amount').fill('4,50');
  await forWhom.getByRole('checkbox', { name: 'Ola' }).uncheck();
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // Saving returns to the detail page it was opened from.
  await expect(page.getByRole('heading', { name: 'Lidl Rovinj' })).toBeVisible();
  await expect(main).toContainText('€4.50');
  await expect(shares).toHaveCount(2);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(row).toContainText('€4.50');
  await expect(row).toContainText('you lent €2.25');

  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(bars.filter({ hasText: 'Kasia' })).toContainText('+€2.25');
  await expect(bars.filter({ hasText: 'Ania' })).toContainText('−€2.25');
  await expect(bars.filter({ hasText: 'Ola' })).toContainText('€0.00');
  await expect(main).not.toContainText('≈');
});

test('settle up: Income, then the suggested Repayments, until the Trip is Settled', async ({
  page,
}) => {
  await createTrip(page, 'Alps 2026', 'Kasia', ['Ania', 'Ola']);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('30');
  await page.getByLabel('Title').fill('Hut');
  await page.getByRole('button', { name: 'Save Expense' }).click();

  // Ola got a 6.00 Deposit refund back for everyone: Income, typed without a minus.
  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('6');
  await page.getByRole('switch', { name: 'Money received' }).click();
  await expect(page.getByRole('banner')).toContainText('New Income');
  await expect(page).toHaveTitle('New Income | Owe Yeah');
  await page
    .getByRole('group', { name: 'Received by' })
    .getByRole('radio', { name: 'Ola' })
    .check();
  await page.getByLabel('Title').fill('Bottles');
  await page.getByRole('button', { name: 'Save Income' }).click();
  const income = page.getByRole('link', { name: /Bottles/ });
  await expect(income).toContainText('Ola received · for all 3');
  await expect(income).toContainText('€6.00');
  await expect(income).not.toContainText('−€6.00');
  await expect(income).toContainText('you get back €2.00');
  // Its edit page is titled for Income, on the tab as in the heading.
  await income.click();
  await page.getByRole('link', { name: 'Edit Income' }).click();
  await expect(page.getByRole('banner')).toContainText('Edit Income');
  await expect(page).toHaveTitle('Edit Income | Owe Yeah');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();

  // Kasia is owed 22.00: Ola owes 14.00 and Ania 8.00. The total is net of the Income.
  await page.getByRole('link', { name: 'Balances' }).click();
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { name: "You're owed" })).toBeVisible();
  await expect(main).toContainText('€22.00');
  await expect(main).toContainText('Trip total €24.00');
  const toSettle = page.getByRole('region', { name: 'To settle' }).getByRole('listitem');
  await expect(toSettle).toHaveCount(2);
  await expect(toSettle.nth(0)).toContainText(/Ola → you\s*€14\.00/);
  await expect(toSettle.nth(1)).toContainText(/Ania → you\s*€8\.00/);

  // Recording from a suggestion fills it in; the amount can be lowered for a partial one.
  await toSettle.nth(0).getByRole('link', { name: 'Record Repayment' }).click();
  await expect(page.getByRole('banner')).toContainText('New Repayment');
  await expect(page).toHaveTitle('New Repayment | Owe Yeah');
  await expect(page.getByLabel('Amount')).toHaveValue('14.00');
  await expect(
    page.getByRole('group', { name: 'Paid by' }).getByRole('radio', { name: 'Ola' }),
  ).toBeChecked();
  await expect(
    page.getByRole('group', { name: 'Paid to' }).getByRole('radio', { name: 'Kasia' }),
  ).toBeChecked();
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Save Repayment' }).click();

  // Back on Balances: Ola still owes 4.00, and Repayments are not spending.
  await expect(toSettle).toHaveCount(2);
  await expect(toSettle.nth(0)).toContainText(/Ania → you\s*€8\.00/);
  await expect(toSettle.nth(1)).toContainText(/Ola → you\s*€4\.00/);
  await expect(main).toContainText('Trip total €24.00');

  await toSettle.first().getByRole('link', { name: 'Record Repayment' }).click();
  await page.getByRole('button', { name: 'Save Repayment' }).click();
  await expect(toSettle).toHaveCount(1);
  await toSettle.first().getByRole('link', { name: 'Record Repayment' }).click();
  await page.getByRole('button', { name: 'Save Repayment' }).click();
  await expect(page.getByRole('heading', { name: 'All settled' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'To settle' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Expenses' }).click();
  const repayment = page.getByRole('link', { name: /Repayment/ }).filter({ hasText: '€10.00' });
  await expect(repayment).toContainText('Ola → Kasia');
  await expect(repayment).toContainText('you received €10.00');
  await repayment.click();
  await page.getByRole('link', { name: 'Edit Repayment' }).click();
  await expect(page).toHaveTitle('Edit Repayment | Owe Yeah');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();

  // With Repayments recorded, the Trip currency is locked and says why; the name still changes.
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByRole('link', { name: /Name and Trip currency/ }).click();
  await expect(page.getByRole('button', { name: 'Trip currency' })).toBeDisabled();
  await expect(page.getByRole('main')).toContainText('delete the Repayments first');
  await page.getByLabel('Name').fill('Alps 2026 hut');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: /Name and Trip currency/ })).toContainText(
    'Alps 2026 hut · EUR',
  );

  // My Trips puts it under Settled, below a Trip that isn't, though it was opened last.
  await createTrip(page, 'Lakes 2026', 'Kasia', ['Ania']);
  await page.getByRole('button', { name: 'Back to My Trips' }).click();
  await page.getByRole('link', { name: /Alps 2026/ }).click();
  await page.getByRole('button', { name: 'Back to My Trips' }).click();
  const trips = page.getByRole('main').getByRole('listitem');
  await expect(trips.nth(0)).toContainText('Lakes 2026');
  await expect(trips.nth(1)).toContainText('Alps 2026');
  await expect(page.getByRole('region', { name: 'Settled' })).toContainText('Alps 2026');
});

test('saving a new Expense returns to the Expenses tab where it was scrolled', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const expenses = Array.from({ length: 20 }, (_, index) => ({
    title: `Expense ${index + 1}`,
    amount: 1000,
  }));
  await page.goto(await tripWithExpenses(request, 'Sopot 2026', ['Ola', 'Ania'], expenses));
  await page.getByRole('dialog').getByRole('button', { name: 'Ola' }).click();

  await page.getByRole('link', { name: /Expense 18/ }).scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Amount').fill('5');
  await page.getByLabel('Title').fill('Ice cream');
  await page.getByRole('button', { name: 'Save Expense' }).click();

  await expect(page.getByRole('link', { name: /Ice cream/ })).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test('leaving a half-entered Receipt asks first, and Keep editing returns to it as it was', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await createTrip(page, 'Pula 2026', 'Kasia', ['Ania']);
  const tripUrl = page.url();

  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Title').fill('Konzum Pula');
  const formUrl = page.url();
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  // The add form stays open for the next line, as at a till.
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  for (const [name, price] of [
    ['Bread', '1,50'],
    ['Milk', '1,20'],
    ['Apples', '3,35'],
  ] as const) {
    await adding.getByLabel('New Line item unit price').fill(price);
    await adding.getByLabel('New Line item name').fill(name);
    await adding.getByRole('button', { name: 'Add to Receipt' }).click();
  }
  await page.getByRole('textbox', { name: 'Receipt discount' }).focus();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  // ✕ asks, saying what would be lost; Keep editing is the default.
  const sheet = page.getByRole('dialog', { name: 'Discard this Expense?' });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toContainText('Konzum Pula · €6.05 · 3 Line items');
  await expect(sheet.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await sheet.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect(page.getByRole('region', { name: 'Line items' }).getByRole('listitem')).toHaveCount(
    3,
  );

  // System back asks too; back again only closes the sheet, back where the person was, and a
  // third back asks again.
  const discount = page.getByRole('textbox', { name: 'Receipt discount' });
  await discount.focus();
  await page.goBack();
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(formUrl);
  await expect(discount).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await page.goBack();
  await expect(sheet).toBeVisible();

  // Discard goes back where back was going, and the history is as it was.
  await sheet.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(tripUrl);
  await expect(page.getByRole('main')).not.toContainText('Konzum Pula');
  await page.goForward();
  await expect(page).toHaveURL(formUrl);

  // An untouched form closes at once.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(tripUrl);
  await expect(sheet).toBeHidden();
});

test('an edit changed back closes at once, while a changed edit, a Line item not added yet and a new Repayment ask first', async ({
  page,
}) => {
  await createTrip(page, 'Rovinj 2026', 'Kasia', ['Ania']);
  const tripUrl = page.url();

  // Saving never asks.
  await page.getByRole('link', { name: 'Add Expense' }).click();
  await page.getByLabel('Title').fill('Lidl Rovinj');
  await page.getByRole('button', { name: 'Itemise as a Receipt' }).click();
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  const adding = page.getByRole('group', { name: 'Add a Line item' });
  await adding.getByLabel('New Line item unit price').fill('2');
  await adding.getByLabel('New Line item name').fill('Bread');
  await adding.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(page).toHaveURL(tripUrl);

  await page.getByRole('link', { name: /Lidl Rovinj/ }).click();
  const edit = page.getByRole('link', { name: 'Edit Expense' });
  await expect(edit).toBeVisible();
  const detailUrl = page.url();
  const changes = page.getByRole('dialog', { name: 'Discard your changes?' });

  // Changed back to how it was, nothing would be lost.
  await edit.click();
  await page.getByLabel('Title').fill('Lidl');
  await page.getByLabel('Title').fill('Lidl Rovinj');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(changes).toBeHidden();

  // A changed title: system back asks, and Discard keeps the Expense as it was.
  await edit.click();
  await page.getByLabel('Title').fill('Lidl Pula');
  await page.goBack();
  await expect(changes).toContainText('Lidl Pula · €2.00 · 1 Line item');
  await changes.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole('heading', { name: 'Lidl Rovinj' })).toBeVisible();

  // A Line item typed but not added counts, and so does reloading the page.
  await edit.click();
  await page.getByRole('button', { name: 'Add a Line item' }).click();
  await adding.getByLabel('New Line item name').fill('Milk');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(changes).toBeVisible();
  await changes.getByRole('button', { name: 'Keep editing' }).click();
  await expect(adding.getByLabel('New Line item name')).toHaveValue('Milk');
  const warning = page.waitForEvent('dialog');
  void page.reload().catch(() => null);
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(adding.getByLabel('New Line item name')).toHaveValue('Milk');
  await page.getByRole('button', { name: 'Back' }).click();
  await changes.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(detailUrl);

  // A new Repayment, untouched, closes at once; with an amount, back asks.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Balances' }).click();
  const record = page.getByRole('link', { name: 'Record a Repayment' });
  await expect(record).toBeVisible();
  const balancesUrl = page.url();
  await record.click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(balancesUrl);
  await record.click();
  await page.getByLabel('Amount').fill('20');
  await page.goBack();
  const repayment = page.getByRole('dialog', { name: 'Discard this Repayment?' });
  await expect(repayment).toContainText('€20.00');
  await repayment.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(balancesUrl);
});

test('delete an Expense, bring it back from Recently deleted, and restore an older version from its History', async ({
  page,
  request,
}) => {
  await page.goto(
    await tripWithExpenses(
      request,
      'Krk 2026',
      ['Kasia', 'Ania'],
      [{ title: 'Ferry', amount: 3000 }],
    ),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Kasia' }).click();
  const main = page.getByRole('main');
  const row = page.getByRole('link', { name: /Ferry/ });

  await row.click();
  await page.getByRole('link', { name: 'Edit Expense' }).click();
  await page.getByLabel('Amount').fill('45');
  await page.getByRole('button', { name: 'Save Expense' }).click();
  await expect(main).toContainText('Last edited by you · just now');

  // Deleted, it leaves the Expenses tab for Recently deleted.
  await page.getByRole('button', { name: 'Delete Expense' }).click();
  await expect(page.getByRole('link', { name: 'Add Expense' })).toBeVisible();
  await page.getByRole('link', { name: 'Trip', exact: true }).click();
  await page.getByRole('link', { name: 'Recently deleted' }).click();
  await expect(page.getByRole('heading', { name: 'Recently deleted' })).toBeVisible();
  await expect(main.getByRole('listitem')).toContainText('€45.00');
  await expect(main.getByRole('listitem')).toContainText('Deleted by you · ');
  await page.getByRole('button', { name: 'Restore Ferry' }).click();
  await expect(main).toContainText('Nothing deleted');

  // Every change is a Revision; the first one opens in full and restores.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByRole('button', { name: 'Everything is synced.' })).toBeVisible();
  await row.click();
  await page.getByRole('link', { name: 'History' }).click();
  const revisions = main.getByRole('listitem');
  await expect(revisions).toHaveCount(4);
  await expect(revisions.nth(0)).toContainText('Restored');
  await expect(revisions.nth(1)).toContainText('Deleted');
  await expect(revisions.nth(2)).toContainText(/€45\.00\s*was €30\.00/);
  await expect(revisions.nth(3)).toContainText('Added');
  await revisions.nth(3).click();
  await expect(main.getByText(/^Added /)).toBeVisible();
  await expect(main).toContainText('€30.00');
  await page.getByRole('button', { name: 'Restore this Revision' }).click();

  await expect(page.getByRole('heading', { name: 'Ferry' })).toBeVisible();
  await expect(main).toContainText('€30.00');
});
