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
A single payment made by a Participant on behalf of some Participants of the Trip.
_Avoid_: Transaction, purchase, cost

**Receipt**:
An Expense recorded item by item, mirroring the paper or digital receipt it came from.
_Avoid_: Bill, invoice, ticket

**Line item**:
One position on a Receipt: a product with its quantity, price, and any discount applied to it.
_Avoid_: Product, position, entry

**Deposit**:
A refundable charge on a Receipt for returnable packaging, tied to the Line items it was charged for.
_Avoid_: Kaution, pfand, bottle fee

**Deposit refund**:
Money received back when returnable packaging is returned, often as a discount on a later Receipt.
_Avoid_: Bottle return, refund, cashback
