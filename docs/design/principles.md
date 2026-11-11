# Design principles

The rules the app's look and layout follow. They replace the hand-drawn `layout.html` mockup. The pixels live in the app itself, and `tools/screenshots` (its `capture` script, run against a running app) walks every page and option and captures the screens for review.

Words follow `GLOSSARY.md`. Copy that names a domain concept uses its canonical term, in English and in Polish.

## Shape

- **Phone first.** Every screen is designed at 390 px and works one-handed.
- **Three layouts.** My Trips, the legal pages and the not-found page share a plain header. An open Trip has a header (the Trip, who you are, the sync status) and a bottom tab bar: Expenses, Balances, Trip. Forms and detail pages are full screen, with back or close, and the main action fixed at the bottom.
- **Cards on a canvas.** Each screen is a soft canvas with cards on it (raised in dark mode). Related rows share a card; a section's label sits above its card.
- **What each tab leads with.**
  - Expenses: the Expenses, newest day first, each day with what was spent.
  - Balances: your Balance and the Suggested Repayments that settle it, then everyone's Balance.
  - Trip: its Participants and Invite, then the Trip itself, then what only this device holds (who you are, Notifications, forgetting the Trip).
- **Rare things go last.** A form leads with what is always filled in (the amount, then the title, who paid, for whom). Options such as Money received or Itemise as a Receipt come at the end.

## Colour

- **One primary.** A deep green, used for the main action and for what is in your favour (you are owed, you lent).
- **Red only for what you owe**, and for a destructive confirm. Your Share is neutral, not red. Delete rows are quiet; only the confirm button in their sheet is red.
- **Amber means "needs attention"**, always in the same note style (`AttentionNote`): a Conflict, value not assigned yet, a change that would be lost, a pending Line item.
- **No other hues** except Participants' identity tints, which keep clear of green, red and amber, and differ within a Trip.
- **Both themes pass contrast.** Every text and control colour is checked in light and dark.

## Money

- **Every amount carries its currency**, and negatives use a true minus.
- **Sums add up on screen.** A breakdown that is rounded to the cent says so once, and an amount that is not exact carries "≈".
- **Amounts at a Provisional rate are marked approximate** wherever they are shown.

## You

- **One "you" chip** (`YouBadge`) after the claimed Participant's name, wherever that name appears. Copy says "you" rather than repeating the name.
- **Balances read from your side first.** Arrows show direction ("Kasia → you"), which needs no name declension in Polish.

## Controls

- **Touch-sized.** Controls and fields are at least 44 px, with 3:1 outlines. A switch that is off still reads as a control.
- **Pick-one looks different from pick-several.** Single choices are radio chips or a segmented control; multiple choices are checkbox chips with Select all and Clear.
- **Sheets end explicitly**, with Done or Cancel.
- **Secondary guidance hides behind an "i"** (`HelpTip`) beside a field's label, so the form keeps only what is needed to fill it in.
- **Disabled actions say why.** A greyed-out Save comes with the reason, in the alert above it.
