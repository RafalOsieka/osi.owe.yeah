# What a public Owe Yeah instance and public images owe under EU law

Research for [#93](https://github.com/RafalOsieka/osi.owe.yeah/issues/93), part of the map [#88](https://github.com/RafalOsieka/osi.owe.yeah/issues/88). Written 2026-11-03.

> **Not legal advice.** This is an engineer's reading of primary sources, to decide what to build and what to ask a lawyer. Points marked **Lawyer** are the ones where the reading is uncertain or where a wrong call costs more than an hour of a lawyer's time.

## Short answer

Running the test environment openly on the internet makes an operator based in Poland a **GDPR controller**, a **usługodawca** under the Polish e-services act, and a **hosting provider** under the DSA. "It's only a test" changes none of that once anyone can reach it and type real names in. What it needs is small:

- two pages (a **privacy notice** and **terms / regulamin**, both in English and Polish, reachable from every screen), carrying the operator's identity and an email contact that doubles as the DSA point of contact and the illegal-content notice channel;
- two config changes that remove the only cookie and the only third-party call from the browser, after which **no consent banner is needed**;
- an internal **record of processing** and a manual **erasure runbook**;
- a **licenses file** for the client bundle, which every visitor downloads whatever the GHCR visibility.

**GHCR: make the packages public, but only once the image carries its license notices** (a third-party notices file, the repo's `LICENSE`, and a source offer for the GPL-licensed Alpine packages). Private packages avoid every image-license obligation, but cost a classic personal access token on the host that can read every package the account can see. Details in [Public images and licenses](#5-public-images-and-licenses).

## What the app does today (checked in code)

The ticket's description holds, with a few additions:

| What | Where | Personal data? |
| --- | --- | --- |
| Trip name, currency; Participant names; Expenses (title up to 100 chars, amounts, date, time zone, who paid, line items); every Revision, forever | Postgres (`apps/web/server/db/schema/*`) and IndexedDB via Dexie (`apps/web/app/sync/db.ts`) | Yes: names of people, many of whom never opened the app, and what they spent |
| Opaque device id, Claim (which Participant the device is) | `localStorage` (`useDevice.ts`); sent with every change and stored in `changes` and `revisions` | Yes (pseudonymous) |
| Trip link token | Device; server keeps only its SHA-256 (`trip-token.ts`, ADR 0001) | Credential, not identity |
| Push subscription: endpoint URL, `p256dh`, `auth`, device id, Claim | `notification_subscriptions`; deleted when turned off or when the push service answers 404/410 | Yes (pseudonymous) |
| Push messages: Trip name, Participant names, Expense title, amounts | Sent to the browser's push service, encrypted for the browser by `web-push` (RFC 8291), with a 24 h TTL (`server/notifications/delivery.ts`) | Yes, but the push service cannot read the payload |
| `i18n_locale` cookie, **365 days**, set from browser language detection; the app has **no language switcher** | `@nuxtjs/i18n` `detectBrowserLanguage.useCookie: true` (`nuxt.config.ts`; lifetime in the module's `runtime/context.js`) | Preference only |
| Install-nudge dismissal flag | `localStorage` (`InstallNudge.vue`), set when the user dismisses it | No |
| Service worker precaching the app shell, catalogs and icons; shows push notifications | `app/service-worker/sw.ts`, registered on first visit | No |
| Client IP in the rate limiter | `nuxt-security`, in memory, short-lived; will key on `CF-Connecting-IP` (#89) | Yes, transient |
| Exchange rates from Frankfurter | Server-side fetch of currency pairs and dates (ADR 0003) | No: nothing about users is sent |
| **`api.iconify.design`** fallback | The built client has `fallbackToApi: true`: an icon missing from the bundle is fetched from Iconify by the browser | The visitor's IP goes to a third party |
| Cloudflare proxy + Tunnel | TLS ends at Cloudflare's edge, so Cloudflare sees every request in clear, including Trip tokens in the `x-trip-token` header | Yes, as processor |

There is **no server-side delete** of a Trip (soft deletes only) and no retention job: everything is kept forever.

## 1. GDPR

Regulation (EU) 2016/679, [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

**Controller.** The operator decides why and how Trip data is stored and synced, so it is the controller (Art. 4(7)). Users who log a holiday with friends are themselves in the household exemption (Art. 2(2)(c)), but recital 18 says the Regulation "applies to controllers or processors which provide the means for processing personal data for such personal or household activities". So the exemption covers the users, not the operator. No accounts doesn't change this: names of people and their spending are personal data, and the device id is a pseudonymous identifier (Art. 4(1), 4(5)).

**Two kinds of data subject.** (a) People using the app, from whom data is collected: Art. 13. (b) Participants named by someone else who may never open the app: **Art. 14** (data not obtained from the data subject). The operator has no way to contact them, so Art. 14(5)(b) (impossible or disproportionate effort) applies, on the condition that the information is made **publicly available**. The public privacy notice is that.

**Legal basis.** Two readings work:
- Art. 6(1)(b) (contract) for users, with the terms as the contract, plus Art. 6(1)(f) (legitimate interests) for named non-users, the IP in the rate limiter and Cloudflare's logs (recital 49 names network and information security as a legitimate interest).
- Art. 6(1)(f) for everything: the group's interest in a shared ledger, the operator's in running and securing it.

Without accounts, (f) for all is the simpler story and avoids arguing when a contract was formed. **Lawyer** for the final choice; either way it goes into the notice.

**Art. 13/14 notice: contents.** Identity and contact of the controller; purposes and legal basis; the legitimate interests relied on; recipients (Cloudflare as processor; browser push services); transfers outside the EEA and their safeguard; retention; the rights to access, rectification, erasure, restriction, objection and portability; the right to complain to the President of UODO; that no automated decision-making happens; for Art. 14, the categories of data and their source ("other members of the Trip").

**Where it must be shown.** Art. 12(1): concise, transparent, easily accessible, clear language. The EDPB-endorsed transparency guidelines (WP29, [WP260 rev.01](https://ec.europa.eu/newsroom/article29/items/622227)) read that as a link on every page and, for apps, never more than a couple of taps away, and in the languages of the audience. Practically: a link in the app's settings/about area and on the screens where a Trip is created or joined, in English and Polish.

**Processors and transfers.**
- **Cloudflare** is a processor. Its [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) §6.1 says personal data is handled under the Data Processing Addendum, "hereby incorporated by reference", so there is nothing to sign. The [DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) (version 6.4, effective 3 April 2026) makes Cloudflare a processor (§2.3) for end users' IP addresses in logs and for any personal data in customer content (Annex 1 B), lists sub-processors at [cloudflare.com/gdpr/subprocessors](https://www.cloudflare.com/gdpr/subprocessors/) (§4.4), and covers transfers by the EU–US Data Privacy Framework (§6.4; adequacy decision (EU) 2023/1795), with SCCs Module 2 as fallback (§6.2). Art. 28(3)'s contract requirement is met by that. Note in the record which DPA version applied.
- **Browser push services** (Google, Mozilla, Apple, Microsoft, depending on the browser) are chosen by the user's browser, not by the operator; the operator has no contract with them and can't have one. The payload is end-to-end encrypted for the browser, so the push service sees the endpoint, timing and size, not the content. Treat them as **recipients** named in the notice, not processors. Whether sending to a US endpoint is a "transfer" under Art. 44 is debatable; all four vendors are US companies under the DPF regime. **Lawyer** if push matters in prod.
- **GitHub** builds and stores images; it gets no user data. **Frankfurter** gets currency pairs and dates only.
- Hosting is self-hosted, so there's no hosting processor.

**Art. 30 records.** Art. 30(5) exempts organisations under 250 people, *unless* the processing "is not occasional" (or is risky, or involves special categories). A service that stores data continuously is not occasional; the WP29 [position paper on Art. 30(5)](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/position-paper-derogations-obligation-maintain-records_en) says the three conditions are alternatives and any one removes the exemption, for that processing. **Keep a record.** It's one page: purposes, categories of subjects and data, recipients, transfers, retention, security measures (Art. 30(1)). The pending "Omnibus IV" proposal COM(2025)0501 would raise the threshold to 750 and narrow it to high-risk processing, but it isn't law as of this writing.

**Retention.** Art. 5(1)(e) (storage limitation) and Art. 13(2)(a) require a stated period or criteria. Today it is "forever". For test, "the test database may be wiped at any time" is honest, but pair it with an upper bound (e.g. "and at least every N days"), otherwise it reads as forever. For prod, define deletion of inactive Trips.

**Rights without accounts.** Art. 11 and 12(2): the operator need not collect extra data to identify people, but must act on requests it can match. Whoever holds a Trip's link can prove access to it, so "send us the Trip link and say what to erase" is a workable identification. There is no delete endpoint, so erasure today is manual SQL by Trip id. Write that runbook; answer within a month (Art. 12(3)).

**Other GDPR points.** No DPO needed (Art. 37: no large-scale systematic monitoring). No DPIA trigger on UODO's list for this processing. Breaches go to UODO within 72 h when they're likely to be a risk (Art. 33); a leaked database exposes names and spending, though not Trip links (only hashes are stored).

**"It's only a test environment."** The GDPR's scope (Art. 2(1)) has no test exemption. Once strangers can type real names into a publicly reachable instance, it's real processing. A visible "test environment, data may be wiped, don't enter anything sensitive" banner lowers the risk and sets expectations; it doesn't remove the obligations. Only keeping the instance closed (e.g. Cloudflare Access, out of scope on #88) would make the "test with our own data" argument stronger.

## 2. Device storage and cookies

The ePrivacy rule (Directive 2002/58/EC Art. 5(3), as amended by 2009/136/EC) is implemented in Poland by **art. 399 of the *Prawo komunikacji elektronicznej*** (Act of 12 July 2024, [Dz.U. 2024 poz. 1221](https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001221)), which replaced art. 173 of the old *Prawo telekomunikacyjne*. (ISAP's PDF wasn't reachable from this session; the article's text was checked against the consolidated text on [arslege](https://arslege.pl/prawo-komunikacji-elektronicznej/k2200/a152402/) and [standardyprawa](https://standardyprawa.pl/akt/532/art/63604).) In summary:

- **ust. 1**: storing information on, or reading it from, the end user's terminal equipment needs clear prior information on its purpose and on how to control it, and consent, and must not change the device's or software's configuration;
- **ust. 2**: consent may be given through browser settings or service configuration;
- **ust. 3**: ust. 1 does not apply when storage or access is necessary to transmit a communication, or **to provide an electronic service requested by the user** (the "strictly necessary" exemption);
- **ust. 4**: installing software on the user's device, or using software already there, needs direct, clear information before installation on its purpose and how to remove it, and consent.

What's in scope: the [EDPB Guidelines 2/2023 on the technical scope of Art. 5(3)](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en) (v2, adopted 7 October 2024) treat cookies, local storage and similar browser storage alike (para. 44), and caching in the client as storage too. They deliberately don't analyse the exemptions (para. 4, 40). So IndexedDB, `localStorage` and the service worker's caches are all "storage" — the question is only whether the exemption covers them.

| Storage | Exempt as strictly necessary? |
| --- | --- |
| **IndexedDB** (Trips, outbox, rates) | Yes. Holding the user's Trips locally *is* the service they asked for (offline-first). |
| **Device id, Claim** in `localStorage` | Yes. Needed to sync and attribute changes; not used for anything else. |
| **Install-nudge dismissal** | Yes, in practice: set only when the user clicks to dismiss, which WP29 [Opinion 04/2012 (WP194)](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf) treats as a user-requested UI customisation. |
| **Service worker + caches** | Storage of the app shell: necessary for the offline service the app is (its manifest promises "even offline"). Whether registering a service worker is "installing software" under **art. 399 ust. 4** is untested; if it were, it would need prior consent, which an offline-first PWA can't get before its first load. The better reading is that a service worker is part of the web page the user asked for, not separately installed software. **Lawyer.** Cheap mitigation either way: describe it in the notice and say how to remove it (clear site data, uninstall the app). |
| **`i18n_locale` cookie** | **Weakest item.** WP194 exempts language cookies set when the user *picks* a language (e.g. clicks a flag), and then only for a session or a few hours unless they're told more. This cookie is set from automatic detection, with no switcher, for 365 days. **Fix: `detectBrowserLanguage.useCookie: false`.** With no switcher, the cookie only memoises what the browser sends on every visit anyway. |

With the cookie gone, the iconify fallback off, and no analytics, the app needs **no consent banner**. It still has to *inform*: art. 399 ust. 3 lifts ust. 1's conditions for strictly necessary storage, but *ustawa o świadczeniu usług drogą elektroniczną* art. 6 pkt 2 separately requires telling users the function and purpose of software or data placed on their device that isn't service content, and the GDPR notice has to cover the device id anyway. One section of the privacy notice covers it. Cloudflare cookies: with Bot Fight Mode off (#89) and no challenges, none should be set; if `__cf_bm` or `cf_clearance` appear later, Cloudflare classes them as strictly necessary, and they belong in the same section.

Adding any analytics later (even Cloudflare Web Analytics) reopens this: it needs consent or a careful cookieless analysis.

## 3. *Ustawa o świadczeniu usług drogą elektroniczną* (UŚUDE)

Act of 18 July 2002, consolidated [Dz.U. 2024 poz. 1513](https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001513), text read from the [Kancelaria Sejmu consolidated PDF](https://api.sejm.gov.pl/eli/acts/DU/2024/1513/text/U/D20241513Lj.pdf) (as of 2026-10-16).

**Does it apply?** A *usługodawca* is a person who provides electronic services "prowadząc, chociażby ubocznie, działalność zarobkową lub zawodową" (art. 2 pkt 6) — while carrying on a business, even incidentally. Run by a sole proprietorship on its business domain, as one of its products, that's met even if the app is free. Run purely as a private hobby, it arguably isn't. **Lawyer** if it matters; the duties are cheap, so assume it applies.

**Art. 5: identity.** Shown "w sposób wyraźny, jednoznaczny i bezpośrednio dostępny": electronic addresses (an email), and for a business its name (*firma*), seat and address (art. 5 ust. 2), and the NIP (art. 5 ust. 4 pointing to *Prawo przedsiębiorców* art. 20 ust. 3).

**Art. 6: risks and software.** Access to current information on specific risks of using the service (for this app: anyone holding a Trip link can read and change the Trip; links shouldn't be posted publicly) and on the function and purpose of software or data the service puts on the device (pkt 2: the service worker, IndexedDB, `localStorage`).

**Art. 8: regulamin — yes, required.** The provider defines a regulamin and makes it available free of charge **before** the agreement is concluded, in a form that can be saved and printed (ust. 1); provisions not made available that way don't bind the user (ust. 2). It must cover at least (ust. 3):
1. the kinds and scope of services;
2. conditions of service, including (a) technical requirements (a current browser with IndexedDB and service workers; push needs a browser that supports Web Push) and (b) a ban on users supplying unlawful content;
3. how the agreement starts and ends (starts by creating or opening a Trip; ends when the user stops using it or forgets the Trip on their device; the operator may end the test service at any time and wipe data);
4. the complaints procedure (*tryb postępowania reklamacyjnego*): where to send a complaint, what to include, how long the operator takes to answer.

The provider must then act according to it (ust. 4).

**DSA implementation, in force 6 November 2026.** The *ustawa z 4 września 2026 r. o zmianie ustawy o świadczeniu usług drogą elektroniczną oraz niektórych innych ustaw* ([Dz.U. 2026 poz. 1296](https://api.sejm.gov.pl/eli/acts/DU/2026/1296/text/O/D20261296.pdf), published 6 October 2026, in force 30 days later per its art. 8) repeals UŚUDE's chapter 3 (the old hosting-liability rules, arts. 12–15, now in DSA arts. 4–8), makes the **President of UKE** the Digital Services Coordinator (new art. 15b), and adds procedures and administrative fines for breaches of the DSA. Arts. 5–8 above are unchanged.

**Language.** The app's audience includes Polish consumers, and the *ustawa o języku polskim* requires Polish in consumer-facing terms. The app already ships Polish; provide both pages in both languages. **Lawyer** for whether the English version can be authoritative for non-Polish users.

## 4. Digital Services Act

Regulation (EU) 2022/2065, [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2022/2065/oj).

**Hosting service: yes.** Art. 3(g)(iii): a service "consisting of the storage of information provided by, and at the request of, a recipient of the service". Trips are exactly that.

**Online platform: no, as the app stands.** An online platform also *disseminates to the public* (Art. 3(i)), meaning making information available to "a potentially unlimited number of third parties" (Art. 3(k)); recital 14 excludes content shared within closed groups chosen by the user. A Trip is visible only to people its members hand the secret link to. If Trips ever become publicly listable or shareable by open link pages, redo this analysis. Even then, Art. 19 exempts micro and small enterprises (Commission Recommendation 2003/361/EC: under 10 staff and ≤ €2 m turnover for micro) from the whole online-platform section, so the extra burden would be small.

**Information society service.** The DSA applies to services "normally provided for remuneration" (Directive (EU) 2015/1535 Art. 1(1)(b)); a free service run as part of a business's offering generally counts (CJEU C-484/14 *McFadden*). Same practical answer as UŚUDE: assume it applies.

**Obligations that apply to a micro-enterprise hosting provider:**

| Article | What | For Owe Yeah |
| --- | --- | --- |
| 11 | Single point of contact for Member State authorities, the Commission and the Board; publish it and the languages it accepts | An email address on the terms page; "English, Polish" |
| 12 | Single point of contact for recipients, allowing direct and rapid communication, not only automated | The same email |
| 13 | Legal representative | Not needed: established in the EU |
| 14 | Terms stating any restrictions on use, content moderation policies and procedures, in clear language, publicly available | A short section in the terms: what's not allowed, that the operator may remove a Trip or disable its link on a valid notice, how |
| 15 | Transparency reports | **Exempt** (Art. 15(2): micro and small enterprises that aren't very large platforms) |
| 16 | Notice-and-action: an easy, electronic mechanism for anyone to report illegal content, with the elements of Art. 16(2) (reasons, exact location, notifier's name and email, good-faith statement); acknowledge, decide diligently, inform the notifier | Describe it on the terms page; an email with those four elements listed is the minimum; a simple form is safer (**Lawyer**: whether email alone is "user-friendly" enough). The "exact location" is the Trip link, which is also its credential: say so |
| 17 | Statement of reasons to the affected user when restricting content | No user contact data exists; where none, there's no one to send it to. Note the policy in the terms |
| 18 | Report suspicions of criminal offences threatening life or safety to the authorities | A line in the runbook |
| 6, 8 | Liability exemption when acting expeditiously on actual knowledge; no general monitoring duty | Nothing to build |

The risk surface is small (Trip names, Participant names, 100-char Expense titles), but the obligations are about having the channel, not about volume.

## 5. Public images and licenses

The GPL, MIT, Apache, MPL and BlueOak obligations below attach to **distribution** (GPLv2 §1–3 "distribute", MIT "all copies or substantial portions"). Pulling your own private image to your own host isn't distribution. Publishing it on a public registry is. Serving JavaScript to browsers is too.

**What's in the runtime image** (inspected a local build of the `runtime` stage):

- **Node.js**: its `LICENSE`, which also carries the notices of everything Node bundles (V8, OpenSSL, ICU, libuv, …), survives at `/usr/local/LICENSE` from the `node:24-alpine` base. Nothing to do as long as the `slim-node` stage doesn't delete it. ([Node.js LICENSE](https://github.com/nodejs/node/blob/main/LICENSE))
- **Alpine 3.24 packages**: no license texts at all, only SPDX ids in `/lib/apk/db/installed`. GPL-2.0-only: `busybox`, `busybox-binsh`, `ssl_client`, `apk-tools`, `libapk`, `alpine-baselayout(-data)`, `scanelf`; GPL/LGPL with the GCC runtime exception: `libgcc`, `libstdc++`; MPL-2.0 AND MIT: `ca-certificates-bundle`; Apache-2.0: `libcrypto3`, `libssl3`; MIT: `musl`; Zlib: `zlib`.
- **Nitro `.output`**: `server/node_modules` keeps the traced packages' `package.json` (so their `license` fields) but **no `LICENSE` files** (zero license files in the whole `.output`). The bundled chunks under `server/chunks` and the client JS under `public/_nuxt` have their license comments stripped (no `@license`/`/*!` comments in any client JS file). Server dependencies include MIT (most), Apache-2.0 (`drizzle-orm`, `ecdsa-sig-formatter`), BSD-2/3-Clause, ISC, BlueOak-1.0.0 (`lru-cache`), Unlicense (`postgres`) and **MPL-2.0 (`web-push`, shipped as source)**.
- **The app itself**: MIT (repo `LICENSE`), not copied into the image. As the copyright holder, the operator owes itself nothing, but including it tells recipients what they may do.

**What each license asks of a distributor:**

- **MIT / ISC / BSD**: keep the copyright and permission notice in all copies or substantial portions.
- **Apache-2.0** §4: give recipients a copy of the license; keep any `NOTICE` file's attributions.
- **BlueOak-1.0.0**: give everyone who gets the software a copy of the license or a link to it.
- **MPL-2.0** §3.1 (source form, as `web-push` is shipped): tell recipients the files are under MPL-2.0 and how to get a copy of it.
- **GPL-2.0** §3 (BusyBox and the other Alpine GPL packages): accompany the binaries with the complete corresponding source, or a **written offer valid three years**, or (only for noncommercial distribution of a binary received with an offer) pass on that offer. [BusyBox's own license page](https://www.busybox.net/license.html) stresses that responsibility "can't be delegated" and that pointing at someone else's site isn't one of the options for commercial distributors. For unmodified Alpine packages, the exact source is Alpine's [aports](https://gitlab.alpinelinux.org/alpine/aports) at the release tag plus the upstream tarballs it references; whether a URL to those satisfies §3 or the operator must offer the source itself is the one item here that's genuinely **Lawyer**. The conservative, common practice is the operator's own written offer in the image.

**The client bundle** is distributed to every visitor regardless of GHCR visibility, and it has no notices today. Vite's [`build.license`](https://vite.dev/config/build-options#build-license) emits a markdown or JSON file with the licenses of all bundled dependencies; through Nuxt's `vite` config it should land next to the client assets. Link it from the about/terms page.

**If GHCR packages are public**, before the first public push:
1. a `THIRD-PARTY-NOTICES` file in the image covering the server dependencies (the npm notices plus full texts of Apache-2.0, MPL-2.0 and BlueOak-1.0.0), generated at build time (`pnpm licenses list --prod` or a rollup license plugin in Nitro's `rollupConfig`; neither is set up today);
2. the repo's `LICENSE` copied into the image;
3. a short `SOURCES` note: the Alpine package list with versions and a written offer of the corresponding source for three years, with the aports link;
4. OCI labels: `org.opencontainers.image.source` (the repo), `.revision`, `.licenses` (`MIT`), and the base image name and digest;
5. the same for the migrator image (its bundle, `dist/cli.mjs`, inlines `drizzle-orm` (Apache-2.0) and `postgres` (Unlicense) with no notices).

**If they stay private**: no image obligations, because nothing is distributed. Only the client-bundle licenses file remains. The cost is on the pulling side: GHCR only accepts a **personal access token (classic)**, with `read:packages` to pull ([GitHub docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic)), and a classic token can read every package its account can see, not just this one. That token would live on the host. A dedicated machine-user account narrows it, at the cost of one more account to keep.

**Cost is not a factor**: GitHub states that "Container image storage and bandwidth for the Container registry is currently free" (with a month's notice before that changes), and public packages are free in any case ([GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)). Public images can be pulled anonymously.

**Recommendation: public**, with the notices above done as part of the image-building work, not after. The repo is already public under MIT, the image reveals nothing the source doesn't, it avoids a broad credential on the host (which fits #90's "the host pulls" design), and the compliance work is a one-time build step. Don't flip a package public before the notices ship. Check and set the package visibility explicitly in its settings rather than relying on defaults.

## Checklist

**test-now** = before the test URL is shared. **prod-later** = before prod, mostly tied to accounts.

| # | Item | When | Source |
| --- | --- | --- | --- |
| 1 | **Privacy notice page** (EN + PL): controller identity and email; purposes and basis (6(1)(f), or (b)+(f)); data categories incl. named non-users and their source (Art. 14); recipients (Cloudflare as processor, browser push services); transfers (DPF, SCCs fallback); retention (test: wiped any time, at most every N days); rights and how to use them with a Trip link; complaint to UODO; a **device storage** section (IndexedDB, `localStorage`, service worker and caches, what each is for, how to remove) | test-now | GDPR 12–14; PKE art. 399; UŚUDE art. 6 |
| 2 | **Terms / regulamin page** (EN + PL): operator's business name, address, NIP, email; the service; technical requirements; ban on unlawful content; how use starts and ends; complaints procedure with an answer time; DSA content rules and moderation; DSA point of contact (authorities and users, languages EN/PL); how to report illegal content with the Art. 16(2) elements; "test environment, data may be wiped" | test-now | UŚUDE arts. 5, 6, 8; DSA arts. 11, 12, 14, 16, 17 |
| 3 | Link both pages from every screen (settings/about) and from the create/join-Trip screens; both work offline as in-app routes | test-now | GDPR 12(1); UŚUDE art. 8 ust. 1 pkt 2 |
| 4 | `i18n.detectBrowserLanguage.useCookie: false` (no switcher exists, so the cookie only memoises detection) | test-now | PKE art. 399; WP194 |
| 5 | `icon.fallbackToApi: false` so a missing icon never sends the visitor's IP to `api.iconify.design` | test-now | GDPR 5(1)(c), 13(1)(e) |
| 6 | No analytics, RUM or Bot Fight Mode on the zone (already decided in #89); recheck that the app sets no cookies after deploy | test-now | PKE art. 399 |
| 7 | Visible "test environment" banner: data may be wiped, don't enter anything sensitive | test-now (optional, cheap) | GDPR 5(1)(c) |
| 8 | **Record of processing activities** (internal, one page), incl. the Cloudflare DPA version | test-now | GDPR 30(1), 30(5) |
| 9 | **Erasure / access runbook**: find a Trip by id from its link, export or hard-delete it (with Revisions, changes, subscriptions); answer within a month; DSA notice handling and Art. 18 reporting in the same runbook | test-now | GDPR 12(3), 15, 17; DSA 16–18 |
| 10 | Client-bundle **licenses file** via Vite `build.license`, linked from about/terms | test-now | MIT/BSD/ISC/Apache notice clauses |
| 11 | **Image notices** (third-party notices, repo `LICENSE`, Alpine source offer, OCI labels) for app and migrator images | with the image work, before any package goes public | GPL-2.0 §3, Apache-2.0 §4, MPL-2.0 §3.1, BlueOak, MIT |
| 12 | GHCR packages **public** once item 11 ships; set visibility explicitly | with the image work | — |
| 13 | Retention policy with automated deletion of inactive Trips, and a real Trip delete (server-side) | prod-later | GDPR 5(1)(e), 17 |
| 14 | Accounts: update the notice (emails, account data), legal basis, account deletion, Art. 30 record | prod-later | GDPR 6, 13, 17, 30 |
| 15 | Breach procedure (72 h to UODO) | prod-later (good to have at test) | GDPR 33, 34 |
| 16 | Lawyer review of both pages in Polish, consumer-law check (esp. if anything is ever paid), the open points below | prod-later | — |
| 17 | Redo the DSA analysis if Trips become publicly shareable; redo the cookie analysis if analytics is added | prod-later, on change | DSA 3(i), 19; PKE art. 399 |

## Open points for a lawyer

1. Whether a free instance run under the operator's business is an *usługa świadczona drogą elektroniczną* by a *usługodawca* (UŚUDE art. 2 pkt 6) and an information society service under the DSA. Assumed yes here.
2. Whether a PWA service worker is "installing software" under PKE art. 399 ust. 4, which would require consent before first load.
3. Legal basis without accounts: 6(1)(f) throughout vs 6(1)(b) for users; Art. 14(5)(b) for named non-users.
4. Whether sending encrypted Web Push messages to US push services is a transfer needing a safeguard.
5. GPL-2.0 §3 for unmodified Alpine packages in a public image: is a URL to Alpine's sources enough, or must the operator offer the source itself?
6. Whether an email address alone satisfies DSA Art. 16's notice mechanism.
7. Polish-language requirements for the terms, and which version prevails.

## Sources

- GDPR, Regulation (EU) 2016/679: <https://eur-lex.europa.eu/eli/reg/2016/679/oj>
- DSA, Regulation (EU) 2022/2065: <https://eur-lex.europa.eu/eli/reg/2022/2065/oj>
- ePrivacy Directive 2002/58/EC: <https://eur-lex.europa.eu/eli/dir/2002/58/oj>
- Prawo komunikacji elektronicznej, Dz.U. 2024 poz. 1221: <https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001221> (art. 399 text checked via <https://arslege.pl/prawo-komunikacji-elektronicznej/k2200/a152402/>)
- Ustawa o świadczeniu usług drogą elektroniczną, Dz.U. 2024 poz. 1513, consolidated text 2026-10-16: <https://api.sejm.gov.pl/eli/acts/DU/2024/1513/text/U/D20241513Lj.pdf>
- Polish DSA implementation, Dz.U. 2026 poz. 1296: <https://api.sejm.gov.pl/eli/acts/DU/2026/1296/text/O/D20261296.pdf>
- EDPB Guidelines 2/2023 on the technical scope of Art. 5(3) ePrivacy, v2: <https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en>
- WP29 Opinion 04/2012 on cookie consent exemption (WP194): <https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf>
- WP29 Guidelines on transparency (WP260 rev.01): <https://ec.europa.eu/newsroom/article29/items/622227>
- WP29 position paper on Art. 30(5): <https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/position-paper-derogations-obligation-maintain-records_en>
- Cloudflare Self-Serve Subscription Agreement (§6.1): <https://www.cloudflare.com/terms/>
- Cloudflare Customer DPA v6.4: <https://www.cloudflare.com/cloudflare-customer-dpa/>
- BusyBox license and GPL compliance: <https://www.busybox.net/license.html>
- Node.js license: <https://github.com/nodejs/node/blob/main/LICENSE>
- Vite `build.license`: <https://vite.dev/config/build-options#build-license>
- GitHub Packages billing: <https://docs.github.com/en/billing/concepts/product-billing/github-packages>
- GitHub Container registry authentication: <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>
