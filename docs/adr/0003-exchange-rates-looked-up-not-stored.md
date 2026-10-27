# Exchange rates are looked up from a fixed table, not stored on Expenses

An Expense stores only its currency and its time (UTC instant plus zone), never the automatic exchange rate. Its conversion into the Trip currency is looked up by (local date of the Expense, Expense currency → Trip currency) in a rate table our backend fills from Frankfurter. A rate becomes fixed once its date is over and is never changed afterwards. The table travels with the whole-Trip pull, so every device computes the same balances from the same inputs, offline too. Only a Manual rate, when someone types one, is stored on the Expense, together with the currency it targets.

We chose this over copying the rate onto each Expense. A stored rate would make changing the Trip currency rewrite every foreign Expense, and under ADR 0002 each rewrite is a whole-Expense change that can collide with someone's offline edit as a Conflict. A provisional rate recorded offline would need another Expense change once the real rate is known, with the same risk.

## Consequences

- Changing the Trip currency is a plain Trip-details edit. Nothing on the Expenses changes, and every automatic rate is simply looked up for the new pair.
- A Manual rate targets the currency it was entered in. When that is no longer the Trip currency, it is chained through the automatic rate for the Expense's date.
- Rates for today and future dates are provisional and are marked as such. They become fixed once the date is over, and balances update with no Expense changes. Offline devices use their latest cached rate as a Provisional rate in the meantime.
- The backend must keep the rate table forever and never change a fixed rate, or old balances would shift. Swapping the rate provider later affects only rates that are not fixed yet.
- The Trip currency must be one the provider covers. Expense currencies it doesn't cover need a Manual rate.
