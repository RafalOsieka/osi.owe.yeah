# Owe Yeah

Owe Yeah tracks shared expenses within a group of people travelling together and works out who owes whom.

## Language

### Trips and people

**Trip**:
The shared container for all Expenses of one group of people, usually a single journey.
_Avoid_: Group, tab, event, tricount

**Participant**:
A person taking part in a Trip who can pay for Expenses or share their cost.
_Avoid_: Member, user, friend

### Spending

**Expense**:
A single payment made by one or more Participants on behalf of some Participants of the Trip. Every Expense has at least one Line item; a plain Expense has exactly one.
_Avoid_: Transaction, purchase, cost

**Main payer**:
The Participant who paid an Expense, covering whatever its Contributions don't. Owns any value on the Expense not yet assigned to anyone.
_Avoid_: Owner, creditor, payer (when Contributions exist)

**Contribution**:
A fixed amount paid towards an Expense by a Participant other than its Main payer, e.g. a cash tip.
_Avoid_: Co-payment, partial payment

**Receipt**:
An Expense recorded item by item, mirroring the paper or digital receipt it came from. May carry a discount on the whole Receipt.
_Avoid_: Bill, invoice, ticket

**Line item**:
One position on a Receipt: a product with its unit price, quantity, any discount applied to it, and how it is split.
_Avoid_: Product, position, entry

**Split mode**:
How a Line item is divided between Participants: Even (equal parts), Units (whole units each), or Amounts (exact amounts each).
_Avoid_: Split type, split method

**Deposit**:
A refundable charge on a Receipt for returnable packaging, tied to the Line items it was charged for.
_Avoid_: Kaution, pfand, bottle fee

**Deposit refund**:
Money received back when returnable packaging is returned, often as a discount on a later Receipt.
_Avoid_: Bottle return, refund, cashback
