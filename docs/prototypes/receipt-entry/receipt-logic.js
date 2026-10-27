/* THROWAWAY PROTOTYPE. Lives on the prototype/receipt-entry branch only. Never merge.
   Receipt logic: a pure module. No DOM, no page state. Liftable into the real engine.
   Used by layout.html (layout prototype, issue #15). It is the module from index.html (logic prototype, issue #4,
   left untouched as the record of that ticket) plus editLine, moveLine and a per-Participant `breakdown` in summarize. */
const ReceiptLogic = (() => {
  // Exact fractions on bigint. Nothing is rounded inside the Trip; cents exist only for display and settling.
  const abs = x => (x < 0n ? -x : x);
  const gcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a || 1n; };
  const q = (n, d = 1n) => { n = BigInt(n); d = BigInt(d); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
  const ZERO = q(0), ONE = q(1), HUNDRED = q(100);
  const add = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => q(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => q(a.n * b.n, a.d * b.d);
  const div = (a, b) => q(a.n * b.d, a.d * b.n);
  const neg = a => q(-a.n, a.d);
  const cmp = (a, b) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
  const isZero = a => a.n === 0n;
  const sum = xs => xs.reduce(add, ZERO);
  // Whole cents, rounding half away from zero.
  const toCents = a => { const t = a.n * 100n, c = t / a.d, r = t % a.d; return abs(r) * 2n >= a.d ? c + (t < 0n ? -1n : 1n) : c; };
  const isWholeCents = a => 100n % a.d === 0n;
  const formatMoney = a => { const c = toCents(a), m = abs(c); return (c < 0n ? '−' : '') + (m / 100n) + ',' + String(m % 100n).padStart(2, '0'); };

  // Lenient amount input. The last "," or "." is the decimal separator; earlier ones are thousands grouping.
  // "0,29", ",29", ".29", "0.29", "1 234,50", "1.234,50", "2,5 €" all work. Returns null when it isn't a number.
  function parseAmount(text) {
    let s = String(text ?? '').replace(/[\s\u00a0€]/g, '');
    let sign = 1n;
    if (s.startsWith('-') || s.startsWith('−')) { sign = -1n; s = s.slice(1); }
    const at = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    const whole = at < 0 ? s : s.slice(0, at).replace(/[.,]/g, '');
    const frac = at < 0 ? '' : s.slice(at + 1);
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || !(whole + frac)) return null;
    return q(sign * BigInt(whole + frac), 10n ** BigInt(frac.length));
  }

  const newReceipt = (participants, mainPayer) =>
    ({ participants: [...participants], mainPayer, lines: [], receiptDiscount: null, contributions: [], nextLineId: 1 });

  const everyone = r => ({ mode: 'even', who: [...r.participants] });
  const fullTotal = l => (l.kind === 'item' ? mul(l.unitPrice, q(l.quantity)) : neg(l.amount));
  const splittable = l => (l.kind === 'item' ? fullTotal(l) : l.amount);
  const discountOf = (d, base) => (!d ? ZERO : d.kind === 'percent' ? div(mul(base, d.value), HUNDRED) : d.value);
  const itemsNet = r => sum(r.lines.filter(l => l.kind === 'item').map(l => sub(fullTotal(l), discountOf(l.discount, fullTotal(l)))));

  function checkDiscount(d, base) {
    if (!d.value) return 'The discount is not a number.';
    if (cmp(d.value, ZERO) < 0) return 'A discount is entered as a positive number.';
    if (d.kind === 'percent' && cmp(d.value, HUNDRED) > 0) return 'A discount can never exceed what it applies to, so 100 % at most.';
    if (d.kind === 'amount' && cmp(d.value, base) > 0) return `A discount can never exceed what it applies to (${formatMoney(base)}).`;
    return null;
  }

  // Checks that a line's split still fits after its price or quantity changed. Returns a reason or null.
  function checkSplitFits(l) {
    const s = l.split;
    if (s.mode === 'units') {
      if (l.kind !== 'item' || l.quantity < 2) return 'This line is split by Units, which needs a quantity of 2 or more. Switch it to Even or Amounts first.';
      const assigned = Object.values(s.units).reduce((x, y) => x + y, 0);
      if (assigned > l.quantity) return `${assigned} units are already assigned, more than ${l.quantity}. Lower someone’s units first.`;
    }
    if (s.mode === 'amounts' && cmp(sum(Object.values(s.amounts)), splittable(l)) > 0)
      return `The Amounts already add up to ${formatMoney(sum(Object.values(s.amounts)))}, more than the new Line total of ${formatMoney(splittable(l))}. Lower them first.`;
    if (l.kind === 'item' && l.discount) return checkDiscount(l.discount, fullTotal(l));
    return null;
  }

  // (receipt, action) => { receipt, rejected? }. A rejected action leaves the Receipt unchanged and says why.
  function apply(r, a) {
    const no = rejected => ({ receipt: r, rejected });
    const ok = receipt => ({ receipt });
    const withLine = (id, change) => {
      const l = r.lines.find(x => x.id === id);
      if (!l) return no('There is no such line.');
      const res = change(l);
      return typeof res === 'string' ? no(res) : ok({ ...r, lines: r.lines.map(x => (x.id === id ? res : x)) });
    };
    const append = line => ok({ ...r, lines: [...r.lines, { ...line, id: r.nextLineId }], nextLineId: r.nextLineId + 1 });

    switch (a.type) {
      case 'addLineItem': {
        if (!a.unitPrice) return no('The unit price is not a number.');
        if (cmp(a.unitPrice, ZERO) < 0) return no('A price can’t be negative. Returned bottles go in as a Deposit refund.');
        if (!Number.isInteger(a.quantity) || a.quantity < 1) return no('Quantity is a whole number, at least 1.');
        if (a.depositPerUnit && cmp(a.depositPerUnit, ZERO) < 0) return no('A deposit per unit can’t be negative.');
        const prev = [...r.lines].reverse().find(l => l.kind === 'item');
        const split = prev && prev.split.mode === 'even' ? { mode: 'even', who: [...prev.split.who] } : everyone(r);
        const depositPerUnit = a.depositPerUnit && !isZero(a.depositPerUnit) ? a.depositPerUnit : null;
        return append({ kind: 'item', name: a.name || '', unitPrice: a.unitPrice, quantity: a.quantity, depositPerUnit, discount: null, split });
      }
      case 'addDepositRefund':
        if (!a.amount) return no('The voucher amount is not a number.');
        if (cmp(a.amount, ZERO) <= 0) return no('Enter the voucher amount as a positive number. It is recorded as negative.');
        return append({ kind: 'refund', name: a.name || '', amount: a.amount, split: everyone(r) });
      // Edit an existing line in place. Only the given fields change; the split is kept and must still fit.
      case 'editLine':
        return withLine(a.lineId, l => {
          const next = { ...l };
          if (a.name !== undefined) next.name = a.name;
          if (l.kind === 'item') {
            if (a.unitPrice !== undefined) {
              if (!a.unitPrice) return 'The unit price is not a number.';
              if (cmp(a.unitPrice, ZERO) < 0) return 'A price can’t be negative. Returned bottles go in as a Deposit refund.';
              next.unitPrice = a.unitPrice;
            }
            if (a.quantity !== undefined) {
              if (!Number.isInteger(a.quantity) || a.quantity < 1) return 'Quantity is a whole number, at least 1.';
              next.quantity = a.quantity;
            }
            if (a.depositPerUnit !== undefined) {
              if (a.depositPerUnit && cmp(a.depositPerUnit, ZERO) < 0) return 'A deposit per unit can’t be negative.';
              next.depositPerUnit = a.depositPerUnit && !isZero(a.depositPerUnit) ? a.depositPerUnit : null;
            }
          } else if (a.amount !== undefined) {
            if (!a.amount) return 'The voucher amount is not a number.';
            if (cmp(a.amount, ZERO) <= 0) return 'Enter the voucher amount as a positive number. It is recorded as negative.';
            next.amount = a.amount;
          }
          return checkSplitFits(next) ?? next;
        });
      case 'moveLine': {
        const i = r.lines.findIndex(l => l.id === a.lineId), j = i + a.by;
        if (i < 0) return no('There is no such line.');
        if (j < 0 || j >= r.lines.length) return no(a.by < 0 ? 'This is already the first line.' : 'This is already the last line.');
        const lines = [...r.lines];
        [lines[i], lines[j]] = [lines[j], lines[i]];
        return ok({ ...r, lines });
      }
      case 'removeLine':
        if (!r.lines.some(l => l.id === a.lineId)) return no('There is no such line.');
        return ok({ ...r, lines: r.lines.filter(l => l.id !== a.lineId) });
      case 'setLineDiscount':
        return withLine(a.lineId, l => {
          if (l.kind !== 'item') return 'A Deposit refund is never discounted.';
          if (!a.discount) return { ...l, discount: null };
          return checkDiscount(a.discount, fullTotal(l)) ?? { ...l, discount: a.discount };
        });
      case 'chooseSplitMode':
        return withLine(a.lineId, l => {
          if (a.mode === 'units' && (l.kind !== 'item' || l.quantity < 2)) return 'Units needs a quantity of 2 or more. For a single unit, use Even or Amounts.';
          return { ...l, split: a.mode === 'even' ? everyone(r) : a.mode === 'units' ? { mode: 'units', units: {} } : { mode: 'amounts', amounts: {} } };
        });
      case 'setEven':
        return withLine(a.lineId, l => ({ ...l, split: { mode: 'even', who: r.participants.filter(p => a.who.includes(p)) } }));
      case 'toggleEven':
        return withLine(a.lineId, l => {
          if (l.split.mode !== 'even') return 'This line isn’t split Even.';
          const has = l.split.who.includes(a.participant);
          return { ...l, split: { mode: 'even', who: r.participants.filter(p => (p === a.participant ? !has : l.split.who.includes(p))) } };
        });
      case 'setUnits':
        return withLine(a.lineId, l => {
          if (l.split.mode !== 'units') return 'This line isn’t split by Units.';
          if (!Number.isInteger(a.units) || a.units < 0) return 'Units are whole numbers, 0 or more.';
          const units = { ...l.split.units, [a.participant]: a.units };
          const assigned = Object.values(units).reduce((x, y) => x + y, 0);
          if (assigned > l.quantity) return `That would assign ${assigned} units, but only ${l.quantity} were bought.`;
          return { ...l, split: { mode: 'units', units } };
        });
      case 'setAmount':
        return withLine(a.lineId, l => {
          if (l.split.mode !== 'amounts') return 'This line isn’t split by Amounts.';
          if (!a.amount) return 'That amount is not a number.';
          if (cmp(a.amount, ZERO) < 0) return 'Amounts are entered as positive numbers.';
          const amounts = { ...l.split.amounts, [a.participant]: a.amount };
          const assigned = sum(Object.values(amounts));
          if (cmp(assigned, splittable(l)) > 0) return `Amounts would add up to ${formatMoney(assigned)}, more than the full-price Line total of ${formatMoney(splittable(l))}.`;
          return { ...l, split: { mode: 'amounts', amounts } };
        });
      case 'setReceiptDiscount': {
        if (!a.discount) return ok({ ...r, receiptDiscount: null });
        const err = checkDiscount(a.discount, itemsNet(r));
        return err ? no(err) : ok({ ...r, receiptDiscount: a.discount });
      }
      case 'setMainPayer':
        if (r.contributions.some(c => c.participant === a.participant)) return no(`${a.participant} already has a Contribution. Remove it first: the Main payer covers whatever the others don’t.`);
        return ok({ ...r, mainPayer: a.participant });
      case 'addContribution':
        if (a.participant === r.mainPayer) return no(`${a.participant} is the Main payer and already covers whatever the others don’t.`);
        if (!a.amount) return no('The Contribution is not a number.');
        if (cmp(a.amount, ZERO) <= 0) return no('A Contribution is a positive amount.');
        return ok({ ...r, contributions: [...r.contributions, { participant: a.participant, amount: a.amount }] });
      case 'removeContribution':
        return ok({ ...r, contributions: r.contributions.filter((_, i) => i !== a.index) });
      default:
        return no('Unknown action.');
    }
  }

  // Weights for one line, plus the "rest": the weight nobody has been given yet. The rest belongs to the Main payer until assigned.
  function weightsOf(l) {
    const s = l.split;
    if (s.mode === 'even') return { weights: Object.fromEntries(s.who.map(p => [p, ONE])), rest: s.who.length ? ZERO : ONE };
    if (s.mode === 'units') {
      const assigned = Object.values(s.units).reduce((x, y) => x + y, 0);
      return { weights: Object.fromEntries(Object.entries(s.units).map(([p, u]) => [p, q(u)])), rest: q(l.quantity - assigned) };
    }
    return { weights: { ...s.amounts }, rest: sub(splittable(l), sum(Object.values(s.amounts))) };
  }

  // Everything derived from a Receipt. Exact values; the page decides how to show them.
  // `breakdown[p]` traces each share back to where it comes from:
  // goods (full price) − lineDiscount + deposit + refunds − receiptDiscount + unassigned = share.
  function summarize(r) {
    const P = r.participants;
    const zeros = () => Object.fromEntries(P.map(p => [p, ZERO]));
    const assigned = zeros(), itemGoods = zeros();
    const breakdown = Object.fromEntries(P.map(p => [p, { goods: ZERO, lineDiscount: ZERO, deposit: ZERO, refunds: ZERO, receiptDiscount: ZERO, unassigned: ZERO, lines: [] }]));
    let unassigned = ZERO, itemGoodsUnassigned = ZERO;
    const problems = [];

    const lines = r.lines.map(l => {
      const full = fullTotal(l);
      const discount = l.kind === 'item' ? discountOf(l.discount, full) : ZERO;
      const net = sub(full, discount);
      const deposit = l.kind === 'item' && l.depositPerUnit ? mul(l.depositPerUnit, q(l.quantity)) : ZERO;
      let { weights, rest } = weightsOf(l);
      let W = add(sum(Object.values(weights)), rest);
      if (isZero(W)) { rest = ONE; W = ONE; }
      const perParticipant = {};
      for (const p of P) {
        const f = div(weights[p] ?? ZERO, W);
        const goods = mul(net, f);
        perParticipant[p] = add(goods, mul(deposit, f)); // the Deposit follows the Line item's weights
        assigned[p] = add(assigned[p], perParticipant[p]);
        if (l.kind === 'item') itemGoods[p] = add(itemGoods[p], goods);
        if (isZero(f)) continue;
        const b = breakdown[p];
        if (l.kind === 'item') {
          const t = { line: l, weight: f, goods: mul(full, f), lineDiscount: mul(discount, f), deposit: mul(deposit, f) };
          b.goods = add(b.goods, t.goods); b.lineDiscount = add(b.lineDiscount, t.lineDiscount); b.deposit = add(b.deposit, t.deposit);
          b.lines.push(t);
        } else {
          b.refunds = add(b.refunds, goods);
          b.lines.push({ line: l, weight: f, refund: goods });
        }
      }
      const fRest = div(rest, W);
      const lineUnassigned = mul(add(net, deposit), fRest);
      unassigned = add(unassigned, lineUnassigned);
      if (l.kind === 'item') itemGoodsUnassigned = add(itemGoodsUnassigned, mul(net, fRest));
      return { line: l, full, discount, net, deposit, total: add(net, deposit), perParticipant, unassigned: lineUnassigned };
    });

    // Receipt discount: spread by each Participant's Line item total after Line discounts. Never touches Deposits or Deposit refunds.
    const base = add(sum(Object.values(itemGoods)), itemGoodsUnassigned);
    let receiptDiscount = discountOf(r.receiptDiscount, base);
    if (cmp(receiptDiscount, base) > 0) { problems.push(`The Receipt discount is larger than the Line items it applies to, so it is capped at ${formatMoney(base)}.`); receiptDiscount = base; }
    if (!isZero(base) && !isZero(receiptDiscount)) {
      for (const p of P) {
        const part = mul(receiptDiscount, div(itemGoods[p], base));
        assigned[p] = sub(assigned[p], part);
        breakdown[p].receiptDiscount = part;
      }
      unassigned = sub(unassigned, mul(receiptDiscount, div(itemGoodsUnassigned, base)));
    }

    const items = lines.filter(x => x.line.kind === 'item');
    const total = sub(sum(lines.map(x => x.total)), receiptDiscount);
    const paid = zeros();
    for (const c of r.contributions) paid[c.participant] = add(paid[c.participant], c.amount);
    paid[r.mainPayer] = add(paid[r.mainPayer], sub(total, sum(r.contributions.map(c => c.amount))));
    if (r.contributions.length && cmp(paid[r.mainPayer], ZERO) < 0) problems.push('Contributions are larger than the total, so the Main payer’s part is negative.');

    const share = { ...assigned };
    share[r.mainPayer] = add(share[r.mainPayer], unassigned); // unassigned value counts as the Main payer's own
    breakdown[r.mainPayer].unassigned = unassigned;
    const balance = Object.fromEntries(P.map(p => [p, sub(paid[p], share[p])]));

    return {
      lines, total, share, paid, balance, unassigned, problems, breakdown,
      incomplete: !isZero(unassigned),
      itemsFull: sum(items.map(x => x.full)),
      lineDiscounts: sum(items.map(x => x.discount)),
      receiptDiscount,
      depositsTotal: sum(items.map(x => x.deposit)),
      refundsTotal: sum(lines.filter(x => x.line.kind === 'refund').map(x => x.full)),
    };
  }

  return { newReceipt, apply, summarize, parseAmount, formatMoney, toCents, isWholeCents, cmp, isZero, neg, add, sub, mul, div, q, ZERO };
})();
