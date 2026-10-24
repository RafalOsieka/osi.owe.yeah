# Research: which exchange-rate source fits Owe Yeah?

Resolves research ticket #8 ("Which exchange-rate source fits Owe Yeah?"). Feeds the grilling ticket #9, which makes the product decision. This document compares options; it does **not** pick one.

Researched on 2026-10-24 from primary docs and live API calls (noted inline). Prices and limits change, so re-check before committing.

## What Owe Yeah needs from a rate source

- **Trip** spends in a foreign currency (EUR, but also "exotic" travel currencies such as THB, VND, GEL, MAD, ISK) and settles in PLN.
- **Historical rate by date**: an **Expense** dated last Tuesday should get Tuesday's rate, not today's.
- **Weekends and holidays**: travel spending happens on Saturdays. The source must give a sensible rate for non-business days.
- **Offline-first PWA**: rates must be fetchable straight from the browser (CORS) or via a thin backend, cacheable, and small enough to keep on the device.
- **Private group first, public later**: free and no-key is fine now; the licence must not block a later public (possibly paid) product.
- **Stability**: once an Expense has a rate, the settlement should not silently change. Whatever the source, the rate is likely snapshotted on the Expense (that is ticket #9's call, but it changes how much "rate revisions" matter).

## Options

### ECB euro foreign exchange reference rates

- **Coverage**: ~29-30 currencies against EUR (USD, GBP, CHF, CZK, HUF, PLN, SEK, NOK, DKK, ISK, TRY, JPY, CNY, THB, IDR, INR, KRW, MXN, BRL, ZAR...). RUB has been suspended since 2022. No GEL, VND, MAD, UAH, RSD, ALL, BAM, EGP, AED.
- **History**: back to 1999 (`eurofxref-hist.zip`, ~640 KB zipped, one file with everything).
- **Update frequency**: once per TARGET working day, around 16:00 CET. Nothing on weekends or TARGET holidays.
- **Weekends/holidays**: no observation. You have to fall back to the previous working day yourself.
- **Rate limits / pricing**: static files, free, no key.
- **Licence**: ECB says the rates are "for information purposes only. Using the rates for transaction purposes is strongly discouraged." Reuse is allowed with the source acknowledged ([ECB copyright/disclaimer](https://www.ecb.europa.eu/services/disclaimer/html/index.en.html)). The ECB accepts no liability.
- **Browser use**: `eurofxref-daily.xml` sends **no `Access-Control-Allow-Origin`** header (checked live), so a PWA can't fetch it directly. It needs a proxy/backend or a mirror (Frankfurter). The data is XML/CSV.
- **Reliability**: institutional. It's the canonical source most free APIs mirror.
- **Offline caching**: excellent. The whole history is one small file, and rates never change after publication.
- **Settling in PLN**: EUR is the base, so foreign→PLN is a cross rate (`PLN/EUR ÷ X/EUR`). It's fine for a split app, but it isn't the "official" PLN rate.
- Source: [ECB reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html).

### NBP Web API (Narodowy Bank Polski)

- **Coverage**: PLN-based, which matches how Owe Yeah settles.
  - **Table A**: 32 main currencies, mid rate, published every Polish business day (checked: 32 rates on 2026-10-23).
  - **Table B**: ~116 less common currencies (VND, GEL, MAD, KES, ALL, BAM, AED, EGP...), mid rate, published **weekly on Wednesdays** (checked: 116 rates on 2026-10-21).
  - **Table C**: bid/ask for a handful of currencies. Not needed here.
- **History**: since 2002-01-02. A single query can't cover more than 93 days (`400 Limit exceeded`).
- **Update frequency**: Table A on Polish business days around midday; Table B weekly.
- **Weekends/holidays**: querying a date with no table returns **404** (checked: `rates/a/eur/2026-10-24` gives 404). The idiom is to ask for a date range ending on the Expense date and take the last entry. That "last published rate before the date" convention matches Polish tax/accounting practice, which uses the NBP rate from the last business day before the transaction.
- **Rate limits / pricing**: free, no key, no documented quota.
- **Licence**: public central-bank data, with no key or signup. The API page states no commercial restriction (verify on nbp.pl before going public).
- **Browser use**: sends `Access-Control-Allow-Origin: *`, so a PWA can call it directly. It also sends `Cache-Control: no-cache` plus an ETag, so the app has to do its own caching.
- **Reliability**: institutional, stable for years. HTTPS-only since 2025-08-01.
- **Offline caching**: good. A whole Table A is ~2 KB of JSON; a year of Table A is a few hundred KB. Published rates don't change.
- **Settling in PLN**: direct, with no cross rate. EUR→PLN on 2026-10-23 was 4.3917 (NBP) vs 4.3945 (ECB cross).
- **Weak spot**: Table B is weekly. An exotic currency spent on a Friday gets the Wednesday rate, which is fine for splitting but coarse.
- Source: [api.nbp.pl](https://api.nbp.pl/en.html).

### Frankfurter

- **What it is**: an open-source (MIT) API that aggregates **105 central banks and official sources** (ECB, NBP, IMF, many national banks). It returns either a "blended" rate or a single provider's rate.
- **Coverage**: 223 currencies including legacy ones (`/v2/currencies` lists 165 current). It covers all the exotic travel currencies tested (GEL, ALL, MAD, VND, ISK, KES, UAH, BAM).
- **History**: back to 1948 depending on currency. Supports a date, a range (`from`/`to`), weekly/monthly `group`, and NDJSON/CSV output.
- **Update frequency**: daily (as providers publish).
- **Weekends/holidays**:
  - v1 and provider endpoints return the **last available date** (checked: `v1/2026-10-24` gives the 2026-10-23 ECB rate; `providers/nbp/...?date=2026-10-24` gives the 2026-10-22 NBP rate).
  - v2 **blended** returns a rate stamped with the requested date even on Saturday (checked: EUR/PLN 4.3862 on 2026-10-24, which differs from both ECB 4.3945 and NBP 4.3917). The docs warn blended "last decimal places may shift as new data comes in", so a blended past rate isn't strictly immutable.
- **Rate limits / pricing**: free, no key, "no quotas", abuse rate limiting only.
- **Licence**: "Is the API free for commercial use? Yes." Blended rates are Frankfurter's own calculation; direct provider endpoints stay subject to each provider's terms. Storing and caching rates locally is explicitly encouraged.
- **Privacy**: no request logging ("Data Not Collected"). That's nice for a PWA calling it from the device.
- **Browser use**: CORS `*`, plus Cloudflare `Cache-Control: public, max-age≈3h, stale-if-error=86400` (checked).
- **Reliability**: a community project run by one maintainer (Line of Flight) since 2018, behind Cloudflare, and actively maintained (last push 2026-10-24). There's no SLA, but the code is **self-hostable via Docker**, which is a strong exit hatch.
- **Offline caching**: good, with small JSON per date and range queries for prefetching a Trip's date window.
- **Caveat**: the NBP mirror lagged the source by a day when checked (Frankfurter NBP showed 2026-10-22 while NBP had published 2026-10-23).
- Source: [frankfurter.dev](https://frankfurter.dev/), [GitHub](https://github.com/lineofflight/frankfurter).

### exchangerate.host (APILayer)

- **Note**: this used to be a free, no-key ECB mirror. It's now an **APILayer commercial product** with keys, so older blog posts recommending it are out of date.
- **Coverage**: ~170 currencies plus crypto.
- **History**: yes, end-of-day (stamped 23:59:59 UTC, available at 00:05 GMT).
- **Pricing / limits**:
  - **Free**: 100 requests/month, daily updates, **non-commercial use only**.
  - **Basic**: $14.99/mo, 10k requests, commercial.
  - **Professional Plus**: $59.99/mo for time-frame queries.
- **Licence**: commercial use requires a paid plan.
- **Browser use**: needs an API key, so it should sit behind a backend so the key isn't shipped in the PWA.
- **Reliability**: claims 99.9% uptime. The sources are "financial data providers and banks including the ECB" and aren't fully disclosed.
- **Offline caching**: allowed in practice, but 100 req/month makes per-Expense lookups impossible on the free plan. It only works with server-side caching.
- Source: [exchangerate.host/product](https://exchangerate.host/product).

### Open Exchange Rates

- **Coverage**: 200+ currencies (incl. BTC, metals).
- **History**: daily EOD historical values on all plans. Time-series ranges are only on Enterprise ($47/mo) and up.
- **Pricing / limits**:
  - **Free**: 1,000 req/month, hourly updates, **USD base only**.
  - **Developer**: $12/mo, 10k requests, any base.
  - **Enterprise**: $47/mo, 100k requests, time series.
  - **Unlimited**: $97/mo.
  - The monthly limit is a soft limit.
- **Licence**: governed by OXR's Terms & Conditions. OXR blends undisclosed sources and offers no warranty. Paid plans are the intended route for products.
- **Browser use**: needs an `app_id` key, so it needs a backend.
- **Reliability**: a long-running commercial service (since 2011), with VIP SLA tiers.
- **Offline caching**: caching responses is normal usage. The free plan's USD base means computing cross rates (fine).
- **Overkill for us**: hourly or intraday updates don't matter for splitting expenses.
- Source: [pricing](https://openexchangerates.org/signup), [FAQ](https://openexchangerates.org/faq).

### Other notable options

- **fawazahmed0/exchange-api** (Currency API on jsDelivr / Cloudflare Pages)
  - Static JSON per date on a CDN: `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{YYYY-MM-DD}/v1/currencies/{base}.json`.
  - 340 codes including crypto and metals (checked), **CC0** licence, no key, no rate limits, a rate for every calendar day including weekends, and a fallback host.
  - Cons: undocumented upstream sources, one maintainer, history only since 2024-03, and non-official rates. EUR/PLN was 4.4031 on 2026-10-24 vs 4.39 at the central banks.
  - Very cache-friendly (immutable files keyed by date).
- **ExchangeRate-API** (exchangerate-api.com)
  - The open no-key endpoint returns **latest only** (no historical), requires attribution, allows caching and commercial use, but forbids redistribution, and updates daily.
  - The keyed Free plan gives 1.5k req/mo; Pro is $10/mo.
  - Historical data needs a paid plan. That's weak for Expense-by-date.
- **Fixer / currencylayer / currencyapi.com / CurrencyFreaks**: commercial keyed APIs in the same shape as Open Exchange Rates (APILayer owns Fixer and currencylayer). Free tiers are small or non-commercial. They add nothing over OXR for our needs.
- **Manual rate entry**: whatever the source, Tricount-style apps let the user override the rate. That matters for "the rate my card was actually charged" and for offline entry when nothing is cached yet. This is noted for ticket #9 rather than being a source.

## Comparison

| | ECB | NBP API | Frankfurter | exchangerate.host | Open Exchange Rates | fawazahmed0 CDN |
|---|---|---|---|---|---|---|
| Base | EUR | PLN | any | any (paid: source switch) | USD (free) / any (paid) | any |
| Currencies | ~30 | 32 daily (A) + ~116 weekly (B) | 165 current / 223 total | ~170 | 200+ | ~340 (incl. crypto) |
| Exotic travel currencies | poor | good (weekly for B) | good | good | good | good |
| History | 1999→ | 2002→ (≤93 days/query) | 1948→ (per currency) | yes | yes (ranges paid) | 2024-03→ |
| Weekend/holiday | no data, DIY fallback | 404, DIY fallback via range | v1/provider: last date; v2 blended: rate per calendar day | EOD daily | EOD daily | every calendar day |
| Update cadence | working days ~16:00 CET | A: business days; B: Wednesdays | daily | daily (free) / faster paid | hourly | daily |
| Key / CORS from PWA | no key / **no CORS** | no key / CORS `*` | no key / CORS `*` | key (backend) | key (backend) | no key / CORS (CDN) |
| Rate limits | none (static files) | undocumented, none in practice | no quotas, abuse limiting | 100 req/mo free | 1,000 req/mo free | none |
| Price | free | free | free | free non-commercial; $14.99+/mo | free (USD base); $12+/mo | free |
| Commercial use | yes, with attribution; "not for transactions" | public data (verify terms) | yes (blended); provider terms for direct | paid plans only | per T&C, paid plans intended | CC0 |
| Official / auditable | yes | yes (PL tax convention) | yes via `providers=ecb/nbp`; blended is derived | no (sources undisclosed) | no (sources undisclosed) | no |
| Rate immutability | immutable | immutable | provider: immutable; blended: may shift | EOD fixed | EOD fixed | immutable files |
| Reliability | institutional | institutional | community, self-hostable | commercial, 99.9% claim | commercial, SLA tiers | community, two CDN hosts |
| Offline caching fit | excellent (single history file) | good (small JSON, range queries) | good (range queries, CSV/NDJSON) | poor on free tier | ok | excellent (static per-date files) |

## Shortlist and trade-offs

Fit for an offline-first, PLN-settling, private-first app, without making the decision:

1. **Frankfurter**: the broadest free option.
   - Pros: no key, CORS, no quotas, explicit commercial and caching permission, and every travel currency. It can serve official ECB or NBP rates through `providers=`, and it's self-hostable if the public instance ever goes away or changes terms.
   - Cons: it depends on one maintainer. We'd have to choose between blended rates (cover every day, but may shift slightly and aren't "official") and provider-scoped rates (official and immutable, but with gaps on weekends and the occasional one-day mirror lag).
2. **NBP API**: the most natural fit for settling in PLN.
   - Pros: direct foreign→PLN rates, institutional reliability, no key, CORS, and the "last business day" rule Polish users and accountants already know.
   - Cons: exotic currencies only update weekly (Table B), weekends and holidays need the range-and-take-last idiom, there are 93-day query windows, and it isn't a good default if Owe Yeah later settles in a non-PLN currency.
3. **ECB reference rates**: the canonical, immutable dataset.
   - Pros: the whole history fits in one tiny file, which is ideal for bundling or caching offline.
   - Cons: only ~30 currencies, cross rates for PLN, no CORS (needs a proxy, or Frankfurter in front), and the ECB discourages "transaction" use. It works best as a fallback or as the data behind Frankfurter's `providers=ecb`.
4. **fawazahmed0 CDN**: the simplest offline story.
   - Pros: immutable static files per calendar day, all currencies, CC0.
   - Cons: unofficial sources, short history, and a single maintainer. It's a reasonable secondary source, not a primary one.

Paid APIs (**Open Exchange Rates**, **exchangerate.host**) aren't needed for a private group. They only become relevant if a public product needs an SLA, intraday rates, or a vendor contract. They also force a backend to hide the API key.

## Open questions handed to ticket #9

- Which rate does a Trip use: official central-bank mid rate (NBP/ECB), blended market rate, or user-entered "actual card rate"?
- What happens on a weekend or holiday: the last published rate before the date (accounting convention), or a per-calendar-day rate?
- Is the rate snapshotted on the Expense at entry time (immune to revisions), or is it looked up at settlement?
- Do we use a direct-from-PWA source or a thin backend cache? Only ECB and the keyed APIs force a backend.
- What's the fallback when offline with no cached rate: manual entry, or pending conversion?
