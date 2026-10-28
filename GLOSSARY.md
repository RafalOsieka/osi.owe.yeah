# Owe Yeah

Owe Yeah tracks shared expenses within a group of people travelling together and works out who owes whom.

Every term carries its canonical Polish word (`_Polish_`, singular nominative), used in the Polish UI. `_Polish avoid_` lists Polish words that must not stand in for it.

## Language

### Trips and people

**Trip**:
The shared container for all Expenses of one group of people, usually a single journey.
_Polish_: Podróż
_Avoid_: Group, tab, event, tricount
_Polish avoid_: Wyjazd, grupa, wydarzenie

**Participant**:
A person taking part in a Trip who can pay for Expenses or share their cost, whether or not they use the app. Names need not be unique within a Trip.
_Polish_: Uczestnik
_Avoid_: Member, user, friend
_Polish avoid_: Członek, użytkownik, znajomy

**Trip link**:
The secret link to a Trip. Whoever has it can see and edit everything in the Trip.
_Polish_: Link do podróży
_Avoid_: Invite link, share link, code
_Polish avoid_: Zaproszenie, kod

**Claim**:
Which Participant a person says they are, on one device and for one Trip. It sets defaults, such as the Main payer of new Expenses, and grants no extra rights.
_Polish_: Przypisanie (a term for code and docs only; the UI asks "Kim jesteś?" and never shows the word)
_Avoid_: Login, identity, profile
_Polish avoid_: Logowanie, tożsamość, profil, roszczenie

### Spending

**Expense**:
A single payment made by one or more Participants on behalf of some Participants of the Trip. Every Expense has a free-text title (e.g. "Lidl Rovinj", which also names the merchant) and at least one Line item; a plain Expense has exactly one.
_Polish_: Wydatek
_Avoid_: Transaction, purchase, cost
_Polish avoid_: Transakcja, zakup, koszt

**Main payer**:
The Participant who paid an Expense, covering whatever its Contributions don't. Owns any value on the Expense not yet assigned to anyone.
_Polish_: Główny płatnik
_Avoid_: Owner, creditor, payer (when Contributions exist)
_Polish avoid_: Właściciel, wierzyciel, płacący

**Contribution**:
A fixed amount paid towards an Expense by a Participant other than its Main payer, e.g. a cash tip.
_Polish_: Dopłata
_Avoid_: Co-payment, partial payment
_Polish avoid_: Wkład, współpłatność, płatność częściowa

**Receipt**:
An Expense recorded item by item, mirroring the paper or digital receipt it came from, with its Line items in the order they appear there. May carry a discount on the whole Receipt.
_Polish_: Paragon
_Avoid_: Bill, invoice, ticket
_Polish avoid_: Rachunek, faktura

**Line item**:
One position on a Receipt: a product with its unit price, whole-number quantity, any discount applied to it, and how it is split. Weighed goods are one unit at their line price.
_Polish_: Pozycja
_Avoid_: Product, position, entry
_Polish avoid_: Produkt, wpis

**Split mode**:
How a Line item is divided between Participants: Even (equal parts), Units (whole units each), or Amounts (exact amounts each).
_Polish_: Sposób podziału (Po równo, Na sztuki, Kwotowo)
_Avoid_: Split type, split method
_Polish avoid_: Typ podziału, metoda podziału

**Deposit**:
A refundable charge for returnable packaging, entered as a deposit per unit on the Line item it was charged for and split the same way. Never discounted.
_Polish_: Kaucja
_Avoid_: Kaution, pfand, bottle fee
_Polish avoid_: Opłata za butelkę

**Deposit refund**:
Money received back when returnable packaging is returned, recorded as a negative line on a Receipt (often a voucher redeemed at the till) and split on its own, by default evenly between all Participants.
_Polish_: Zwrot kaucji
_Avoid_: Bottle return, refund, cashback
_Polish avoid_: Zwrot (on its own), cashback

**Revision**:
One saved version of an Expense, with who made it and when. Editing, deleting or restoring an Expense adds a Revision; Revisions are never changed or removed.
_Polish_: Wersja
_Avoid_: Version, snapshot, edit
_Polish avoid_: Rewizja, migawka, edycja

**Income**:
Money received by a Participant on behalf of some Participants, e.g. a cash Deposit refund; modelled as an Expense with a negative total.
_Polish_: Wpływ
_Avoid_: Revenue, earnings, refund
_Polish avoid_: Przychód, zarobek, zwrot

### Settling up

**Repayment**:
Money one Participant hands to another to even out their balances; modelled as an Expense with one payer and one recipient. Not counted as spending.
_Polish_: Spłata
_Avoid_: Settlement, transfer, reimbursement, payment
_Polish avoid_: Rozliczenie, przelew, zwrot, płatność

**Reminder**:
A nudge one Participant sends another about a suggested Repayment the other owes them. Sent by hand, never on a schedule.
_Polish_: Przypomnienie
_Avoid_: Nudge, ping, dunning
_Polish avoid_: Ponaglenie, monit

**Settled**:
A Trip in which every Participant's balance, rounded to whole cents, is zero.
_Polish_: Rozliczona (of a Podróż)
_Avoid_: Closed, done, paid off
_Polish avoid_: Zamknięta, zakończona, spłacona

### Currencies

**Trip currency**:
The one currency a Trip's balances are kept and settled in. Every Expense in another currency is converted into it.
_Polish_: Waluta podróży
_Avoid_: Main currency, base currency, home currency
_Polish avoid_: Waluta główna, waluta bazowa

**Manual rate**:
An exchange rate someone typed in for one Expense, either as a rate or as the amount actually charged, e.g. by a card or an exchange office. It replaces the automatic rate for that Expense.
_Polish_: Kurs ręczny
_Avoid_: Custom rate, card rate, override
_Polish avoid_: Kurs własny, kurs karty

**Provisional rate**:
An exchange rate used for now because the final rate for that day is not known yet. Amounts converted with it are marked as approximate and update by themselves once the final rate arrives.
_Polish_: Kurs wstępny
_Avoid_: Estimated rate, temporary rate
_Polish avoid_: Kurs szacunkowy, kurs tymczasowy

### Working offline

**Conflict**:
Two Participants changed or deleted the same Expense independently, without seeing each other's change. Whoever syncs second chooses whose version to keep.
_Polish_: Konflikt
_Avoid_: Merge conflict, clash, collision
_Polish avoid_: Kolizja
