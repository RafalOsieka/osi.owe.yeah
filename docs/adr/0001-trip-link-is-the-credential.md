# The Trip link is the credential

Owe Yeah has no accounts in the MVP: whoever holds a Trip's secret Trip link can see and edit the whole Trip, and each device records a Claim of which Participant its user is. We chose this over optional accounts because it matches how our group uses Tricount today, works offline once a device has the link's token, and avoids building auth before we know the public product needs it.

## Consequences

- The link token is a random server-side secret, independent of the Trip id, so "regenerate link" (revocation) can be added later without a migration.
- Claims grant no rights; there are no per-Participant permissions. Trust between Participants is assumed.
- The list of a person's Trips lives on each device. Seeing your Trips across devices waits for accounts, which would hold Trip links and Claims rather than replace them.
