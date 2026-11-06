# Exploratory test on the test environment (2026-11-06)

A simulated Trip on the deployed test environment, driven through the real UI with Playwright, to check the app end to end beyond the automated suites. Domain terms are from `GLOSSARY.md`. Every finding is a GitHub issue (#161–#174, #176, #177).

## Setup

- **Trip:** "Croatia 2026" in EUR, later renamed "Croatia & Hungary 2026" and switched to PLN and back.
- **People, each on their own device profile:**
  - Ania: Android phone size, en-GB, Zagreb time. Created the Trip.
  - Bartek: desktop, en-US, Warsaw time.
  - Celina: iPhone size, Polish UI.
  - Darek: no app at first, later claimed on a real Chrome profile to test push Notifications.
  - Ewa: joined late with "Add me", was removed, and forgot the Trip.
- **Tools:** Playwright (Chromium) with one persistent profile per person, so local stores, Claims and the outbox behave like separate devices. Push Notifications need a real push service, so those steps ran on installed Chrome in headless mode. `context.setOffline` stood in for losing the connection.
- Every amount on Balances, Shares and the Share breakdown was checked against a hand calculation.

## What was covered

| Area             | Exercised                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trips and people | New Trip (validation, currencies), Invite (QR, Copy, Share), "Who are you?", "Add me", "Just looking", Claim from the header, Add and remove Participant (refused while on Expenses), a removed Claim asked again, Trip name and Trip currency, Forget this Trip (with an unsynced change), My Trips, invalid and tokenless Trip links           |
| Expenses         | Plain Expense with a past date and another time zone, for some Participants, Contribution (and its rules), Income (Money received), Repayments from a Suggested Repayment and free-form, Repayment and Income details and edits, edit, delete with Undo, Recently deleted and Restore, History and restoring a Revision                          |
| Receipts         | Even, Units (with an unassigned unit), Amounts, Line discount, Deposit per unit, Deposit refund, Receipt discount in percent and amount, rule errors at their fields, pending Line item blocking Save, reordering lines, assigning the unassigned unit                                                                                           |
| Currencies       | Automatic rates (HUF, fixed and Provisional), Manual rate as amount charged and as exchange rate (HUF, BAM), Trip currency change EUR → PLN → EUR                                                                                                                                                                                                |
| Settling up      | Balances and bars, Share breakdown sheets, Suggested Repayments, Reminders by shared message, by copied message and by push, Settled on Balances and My Trips                                                                                                                                                                                    |
| Offline          | Saving offline ("Not synced yet"), syncing on reconnect, a Conflict from two offline edits and choosing a side                                                                                                                                                                                                                                   |
| Notifications    | Offer after a Claim, Notifications page (blocked with "Check again", Home Screen hint on iPhone, turning on and off, and revoking the browser permission after turning on), delivery of "added" and Reminder notifications, opening a notification's highlighted row                                                                             |
| Shell            | Light and dark mode, test-environment banner, not-found page, PWA installability (manifest, service worker, icons), the install nudge and its Install and ✕ (with a stand-in for the browser's install event), the "New version" prompt and Reload (with a local proxy changing the service worker between two update checks, as a deploy would) |

Not covered: the privacy notice and terms pages (skipped on purpose).

## Findings

| Issue | Finding                                                                                                                      | Triage          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | --------------- |
| #161  | The web image ships without the app's public files, so every icon answers with the SPA page and Chrome won't install the app | ready-for-agent |
| #162  | Install is offered only on My Trips; the nudge's dismissal removes it for good and misses iPadOS (blocked by #161)           | needs-triage    |
| #163  | A new Expense in a currency the Trip hasn't used says there is no automatic rate, though the provider has one                | needs-triage    |
| #164  | A percent discount keeps fractions of a cent, so a Receipt's total is "≈" instead of what the till charged                   | needs-triage    |
| #165  | A Contributor's list row calls what the Expense costs them on top "your share"                                               | needs-triage    |
| #166  | The Balances card's "your share" includes received Repayments                                                                | needs-triage    |
| #167  | The Revision page ignores the device's 24-hour clock and says "Changed by" for the first Revision                            | ready-for-agent |
| #168  | A Participant's name can't be corrected                                                                                      | needs-triage    |
| #169  | Changing the Trip currency un-settles people who repaid exactly                                                              | needs-triage    |
| #170  | After any Participant is removed, Expense details stop saying "for all N"                                                    | ready-for-agent |
| #171  | Unknown paths show Nuxt's bare default 404                                                                                   | ready-for-agent |
| #172  | The floating New Trip button covers the Terms of service link on My Trips                                                    | ready-for-agent |
| #173  | The test-environment banner's close ✕ has about 1:1 contrast in light mode                                                   | ready-for-agent |
| #174  | Closing or going back from a half-entered Expense discards it without asking                                                 | needs-triage    |
| #176  | Editing an Income titles the browser tab "Edit Expense"                                                                      | ready-for-agent |
| #177  | Notifications keep saying "On" after the browser permission is revoked, and nothing arrives                                  | ready-for-agent |

The two problems reported before the run map to #161 and #162 (installing the app) and #163 (automatic exchange rates).

## Worth knowing

- **Push on a fresh browser profile is slow the first time.** Turning Notifications on right after a Claim took about 26 s on a new Chrome profile (the browser registering with its push service), with a spinner on "Turn on". Later subscriptions are instant.
- **A Conflict is silent for whoever synced first.** Ania's offline edit lost to Celina's choice; Ania's device then shows the Expense with "Last edited by Celina" and no notice. The History keeps both changes, as ADR 0002 intends.
- **Install works once #161 is fixed.** Chrome finds the deployed app not installable because of #161. With the test environment proxied through `http://localhost` (a secure origin) and the repo's icons served, real Chrome reports no installability errors, fires its own install event, My Trips shows "Install Owe Yeah", and Install opens Chrome's install prompt. Accepting it was left out on purpose, as it installs an app on the machine.
- **Headless Chromium can't test push.** It reports notification permission as denied and has no push service; use the Chrome channel.
