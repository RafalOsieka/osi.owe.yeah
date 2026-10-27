# Owe Yeah

Owe Yeah tracks shared expenses within a group of people travelling together and works out who owes whom.

## Language

### Trips and people

**Trip**:
The shared container for all Expenses of one group of people, usually a single journey.
_Avoid_: Group, tab, event, tricount

**Participant**:
A person taking part in a Trip who can pay for Expenses or share their cost, whether or not they use the app.
_Avoid_: Member, user, friend

**Trip link**:
The secret link to a Trip. Whoever has it can see and edit everything in the Trip.
_Avoid_: Invite link, share link, code

**Claim**:
Which Participant a person says they are, on one device and for one Trip. It sets defaults, such as the Main payer of new Expenses, and grants no extra rights.
_Avoid_: Login, identity, profile

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
A refundable charge for returnable packaging, entered as a deposit per unit on the Line item it was charged for and split the same way. Never discounted.
_Avoid_: Kaution, pfand, bottle fee

**Deposit refund**:
Money received back when returnable packaging is returned, recorded as a negative line on a Receipt (often a voucher redeemed at the till) and split on its own, by default evenly between all Participants.
_Avoid_: Bottle return, refund, cashback

**Income**:
Money received by a Participant on behalf of some Participants, e.g. a cash Deposit refund; modelled as an Expense with a negative total.
_Avoid_: Revenue, earnings, refund

### Working offline

**Conflict**:
Two Participants changed or deleted the same Expense independently, without seeing each other's change. Whoever syncs second chooses whose version to keep.
_Avoid_: Merge conflict, clash, collision
