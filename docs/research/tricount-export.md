# Research: what can be exported from Tricount?

Resolves the research ticket "What can be exported from Tricount?" (#11) on the Owe Yeah wayfinder map.
It records facts only. The import scope is decided in a separate grilling ticket (#12).

Researched on 2026-10-24. Tricount is owned by bunq and changes often, so re-check anything marked _unverified_ before building on it.

## TL;DR

- **There is no official self-service export any more.** CSV and PDF export were Premium features. bunq removed them when it rebuilt the app (v8.0) and dropped Premium. The help center says to email `support@bunq.com` if you want a CSV/ODF export.
- **The share link is the practical way in.** Each Tricount has a share link, `https://tricount.com/<token>`. The token works with Tricount's private (undocumented) HTTP API at `https://api.tricount.bunq.com`. An anonymous device session can read the whole Tricount as JSON: Participants, every Expense with payer and per-Participant allocations, original currency and exchange rate, categories, dates and attachment URLs.
- **Several community tools already rely on this:** a Python CLI, a Go client, a Python package, a browser exporter, and Spliit Cloud's "import via group link". This makes it the de-facto standard, but it is unsupported and may break at any time.
- **Risks:** it is an unofficial API that imitates the Android app's User-Agent. The share token grants **read and write** access and cannot be revoked. Bunq's terms of service probably don't welcome it (_unverified_).

## 1. Official export options

| Channel | Status | Notes |
|---|---|---|
| In-app CSV export | **Removed** (v8.0) | Was a Tricount Premium feature. The help article "What happened to tricount Premium?" lists "Export tricount in CSV and PDF" as deprecated. Only statistics and saved custom splits are "planned for a future update". Export is not. |
| In-app PDF export | **Removed** (v8.0) | Same as above. |
| Excel export | Never native | Old exports were CSV, and spreadsheets opened them. |
| Export on request via support | Available | Help center FAQ: "If you'd like to export your tricount in CSV or ODF, reach out to us at support@bunq.com." The format, columns and turnaround are not documented (_unverified_). It is manual, slow and per request, so it can't be the basis of a product feature. |
| GDPR data access request | Legally available | bunq is an EU (NL) company. A subject access request would cover personal data, but there's no evidence of its format or of whether it contains other Participants' allocations (_unverified_). |
| Share link (`tricount.com/<token>`) | Available | Used to invite others. It opens the Tricount in the app. Through the private API it returns the full ledger (see §2). |
| Official public API | **None** | bunq has a public banking API, but Tricount data isn't part of it. |

Some third-party review sites (e.g. SaaSrat, trip-count.com) still claim Tricount has CSV/PDF/Excel export. That contradicts the official help center and is out of date.

Sources:
- https://help.tricount.com/en/articles/what-happened-with-tricount-premium
- https://help.tricount.com/en/articles/tricount-faqs
- https://goodshare.app/blog/tricount-alternatives (says the help center list was updated in Oct 2026)
- https://gettakecontrol.app/en/blog/splitwise-vs-tricount-limitations
- https://techcrunch.com/2022/05/03/bunq-to-acquire-group-expenses-app-tricount (CSV export used to be Premium)

## 2. Unofficial API (share-link based)

### Access flow

People found this flow by reverse-engineering the Android app. It is documented best in `elrandar/tricount-api`'s `API.md` and used in production by `marcomc/tricount-exporter`.

1. Generate an `app-id` UUID and a **2048-bit** RSA key pair. The server rejects 1024-bit keys and requires each key to be unique.
2. Call `POST https://api.tricount.bunq.com/v1/session-registry-installation` with `{ app_installation_uuid, client_public_key (PEM, PKCS1), device_description: "Android" }`.
   - Send these headers: `User-Agent: com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C`, `app-id: <uuid>`, `X-Bunq-Client-Request-Id: 049bfcdf-6ae4-4cee-af7b-45da31ea85d0` (a hardcoded constant from the app).
   - The response contains `Token.token` and `UserPerson.id`. The user is an anonymous "tricount participant" with status `SIGNUP`.
3. For every later call, send the token as `X-Bunq-Client-Authentication`.
4. Read one Tricount with `GET /v1/user/{userId}/registry?public_identifier_token=<token>`. The result is in `Response[0].Registry`.
   - Alternative: `POST /v1/user/{userId}/registry-synchronization` with `all_registry_active: [{ public_identifier_token }]`. This "joins" the Tricount to the device session and returns the full data. It accepts several tokens in one call.

No email or password login is involved. Tricount has no credential-based login for this API. Listing **all** of a person's Tricounts (account-wide discovery) is **not possible** with the anonymous flow. You get one Tricount per share token.

### Data shape (what you get)

**Registry** (a Tricount, i.e. our **Trip**)

| Field | Notes |
|---|---|
| `id`, `uuid` | Internal identifiers |
| `title`, `description`, `emoji`, `category` | `description` and `currency` are immutable after creation |
| `currency` | ISO 4217 **base currency** of the Tricount. All balances are in this currency. |
| `status` | `READ_WRITE` (active) / `READ_ONLY` (archived) |
| `created` | `YYYY-MM-DD HH:MM:SS.ffffff` (no timezone) |
| `public_identifier_token` | The share token |
| `memberships[]` | Participants (see below) |
| `all_registry_entry[]` | All transactions (see below) |
| `all_registry_gallery_attachment[]` | Tricount-level photo gallery |

**Membership** (`RegistryMembershipNonUser`, i.e. our **Participant**)

| Field | Notes |
|---|---|
| `id`, `uuid` | Stable identifiers. Use these, not names. |
| `alias.display_name` | Free-text name. It is **not unique** (see gotchas). |
| `alias.pointer.type/value` | `UUID` normally, also `EMAIL`, `PHONE_NUMBER`, `IBAN` |
| `status` | `ACTIVE` or `DELETED`. Deleted members stay so their history still resolves. |

There is no link from a member to a bunq user identity. Members are "non-user" name slots.

**RegistryEntry** (a transaction)

| Field | Notes |
|---|---|
| `id`, `uuid` | Identifiers |
| `type_transaction` | `NORMAL` = Expense, `INCOME` = money received on the group's behalf, `BALANCE` = reimbursement or transfer between Participants |
| `type` | e.g. `MANUAL`. Card-imported entries from bunq cards probably differ (_unverified_). |
| `status` | `ACTIVE` (deleted entries are presumably filtered or flagged; _unverified_) |
| `description` | Free text |
| `date` | `YYYY-MM-DD HH:MM:SS.ffffff`, no timezone |
| `created`, `updated` | Audit timestamps |
| `amount` | `{ value, currency }` in the **Tricount base currency**, as a decimal string. **Expenses are negative.** Income and reimbursements are positive. |
| `amount_local` | `{ value, currency }` in the **original currency**, if it differs |
| `exchange_rate` | Historical rate stored on the entry (string) |
| `membership_owned` | Payer (a full membership object) |
| `allocations[]` | The split (see below) |
| `category` | Built-in enum: `TRAVEL`, `ENTERTAINMENT`, `GROCERIES`, `HEALTHCARE`, `INSURANCE`, `RENT_AND_UTILITIES`, `FOOD_AND_DRINK`, `SHOPPING`, `TRANSPORT`, `OTHER`, `UNCATEGORIZED` |
| `category_custom` | Custom label with emoji (e.g. `"Coffee ☕️"`). Used when `category` is `OTHER`. |
| `attachment[]` | Receipts. Each has `urls[0].url`, a downloadable (likely pre-signed, expiring; _unverified_) URL, and a `content_type`. |

**Allocation** (one Participant's share of a transaction)

| Field | Notes |
|---|---|
| `membership` | The Participant |
| `amount` | The share in base currency. These sum exactly to the entry total. |
| `amount_local` | The share in the original currency |
| `type` | `AMOUNT` (exact amount) or `RATIO` |
| `share_ratio` | Integer weight when `type` is `RATIO` (e.g. 1:2:1) |

For a `BALANCE` (reimbursement), the payer is `membership_owned`. The receiver is the allocation with the non-zero amount, and the payer has a zero allocation.

### Coverage against our questions

| We want | Available? |
|---|---|
| Participants | ✅ id, uuid, name, active/deleted |
| Expenses | ✅ description, date, total |
| Payer | ✅ single payer per entry (`membership_owned`). There are **no multi-payer Expenses**. |
| Split amounts | ✅ exact per-Participant amounts, always present |
| Split shares / method | ✅ `AMOUNT` vs `RATIO` + `share_ratio`. An "equal" split is a ratio of 1 for every Participant. |
| Currencies | ✅ base currency per Tricount, plus original currency per entry and allocation |
| Exchange rates | ✅ the historical rate per entry (as stored, possibly user-edited) |
| Repayments / transfers | ✅ `type_transaction = BALANCE` |
| Income / refunds | ✅ `type_transaction = INCOME` |
| Categories | ✅ built-in enum + custom label |
| Dates | ✅ date and time, no timezone |
| Attachments | ✅ receipt image/PDF URLs per entry, plus a Tricount gallery |
| Itemised receipts / line items / deposits | ❌ Tricount has no such concept. Each Expense is one total. |
| Balances / settlement plan | ➖ not stored. Compute them from entries. The server settlement endpoint returns 404. |
| Comments / notes per Expense | ❓ not seen in any client (_unverified_) |

Sources:
- https://github.com/elrandar/tricount-api (`API.md`, reverse-engineered from Android app v13.1.2)
- https://github.com/marcomc/tricount-exporter (`docs/api-research.md`, `src/tricount_exporter/cli.py`)
- https://github.com/federicobond/go-tricount (README "Design notes")
- https://pypi.org/project/tricount-api / https://bourquelot.dev/projects/tricount-api
- https://github.com/DoubleN96/tricount-api-guide

## 3. Existing tools that read Tricount data

| Tool | Approach | Output |
|---|---|---|
| `marcomc/tricount-exporter` (Python CLI, fork of `MrNachoX/tricount-downloader`) | Share token → `GET registry` | Semicolon CSV with `Share/Local Share/Allocation Type/Share Ratio <member>` columns per member, XLSX, raw JSON, attachments, Sesterce CSV |
| `federicobond/go-tricount` (Go library + CLI) | Same API, read **and write** | Typed model, local balance/settlement computation |
| `tricount-api` (PyPI) | Same API | Python client |
| `CY83r5P3C73r/tricount-to-ihatemoney` | Same API (via `tricount-api`) | IHateMoney import CSV (`what,bill_type,amount,currency,date,payer_name,payer_weight,owers`) |
| `wenceslas-sanchez/tricount-extractor` | Same API | Excel |
| tricount-exporter.pages.dev (web app) | Share link, fetched through **its own server** | CSV / JSON in the browser |
| Spliit Cloud | "Tricount import via group link" | Native import into Spliit |
| `fetmo/tricount-flow`, `Javo2804/tricount-mcp` | Same API, read and write | CLI / MCP server |

The browser exporter proxies requests through its server. That suggests (_unverified_) that calling the API directly from a browser runs into CORS or the custom headers, so an importer will likely need a server-side or native fetch.

## 4. Gotchas and limits

1. **The API is unofficial and fragile.** It imitates an old Android User-Agent (`7.0.7`) and uses a hardcoded request id. bunq can break or block it at any time, and the terms of service probably forbid automated clients (_unverified_). The iOS app pins certificates, so traffic can't easily be intercepted when re-researching.
2. **A share token means read and write access, forever.** Anyone holding the token can edit or delete entries. "Deleting" a Tricount only archives it (`READ_ONLY`). The token can't be revoked. An importer must treat tokens as secrets and should never write.
3. **Sign conventions.** Expenses are negative and income and reimbursements are positive. go-tricount notes that the Python reference gets the income sign wrong for balances. Normalise on import.
4. **Rounding.** Allocations are stored exactly and always sum to the total (e.g. 12.76 + 12.75). The leftover cent consistently goes to the same member. The app *displays* floored amounts. Import the stored allocations rather than re-deriving splits.
5. **Two currencies per entry.** `amount` is in the base currency and `amount_local` is the original. When `amount_local` is missing, the entry was in the base currency. The exchange rate is the historical one stored on the entry, so don't re-fetch live rates.
6. **Names are not unique, and members can be deleted.** Two Participants can share a `display_name`, and some exporters abort when that happens. Removed members stay with `DELETED` status and still appear on old entries. Key everything by membership `id`/`uuid`.
7. **No timezone on dates.** Treat them as local wall-clock time of the Trip.
8. **Single payer only.** An Expense always has exactly one payer. Multi-payer situations are modelled as several entries or as `BALANCE` transfers.
9. **There is no account-wide listing.** Each Tricount must be imported from its own share link. Archived Tricounts still open through their link.
10. **Attachment URLs** are separate downloads and probably expire (_unverified_). Download them during the import if they're wanted.
11. **bunq card auto-added entries** exist for bunq customers. They may have a different `type` and carry card metadata (_unverified_; we don't use bunq cards).
12. **Migration guides from competitors** (GoodShare, Spliteo) recommend settling up in Tricount and starting fresh, because "there is no export". The community tools above show that a full history import is technically possible.

## 5. Practical importer options, ranked by reliability

This ranking is about how reliably we can get the data. Which data we import is decided in the scoping ticket (#12).

1. **Share-link fetch through the unofficial API (live).** You paste the `tricount.com/<token>` link, and the importer fetches the Registry JSON and maps it. It gives the richest data (exact allocations, ratios, original currency, rates, transfers, categories, attachments) and needs only one link per Trip. It is the most used approach in the community, with several maintained clients in 2026. The risk is that bunq changes or blocks the API. Mitigate this by storing the raw JSON at import time.
2. **Offline import of raw JSON captured once.** Fetch each existing Tricount once (e.g. with `tricount-exporter --save-response` or our own script) and keep the JSON. The importer then reads files and doesn't depend on the API afterwards. It has the same data richness as option 1, and because we only have a handful of Tricounts to migrate, this is the most robust choice in the long term. It can be combined with option 1.
3. **Import CSV/XLSX produced by a community exporter.** We parse `marcomc/tricount-exporter`'s CSV or a similar file. It contains almost the same fields but keys Participants by display name and is semicolon-delimited, and it depends on a third party's format. It isn't more reliable than option 2.
4. **CSV/ODF obtained from bunq support.** It's official but manual and undocumented. Per-member split columns aren't guaranteed (_unverified_), and you have to request it for each Tricount.
5. **Manual re-entry or a balances-only carry-over.** Settle up or record the final balances and start fresh. It always works and loses all history.
