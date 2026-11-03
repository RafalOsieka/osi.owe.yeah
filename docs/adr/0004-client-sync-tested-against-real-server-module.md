# Client sync is tested against the real server module, not a fake server

The device's sync (outbox, pull, Conflicts, retries) is tested through an in-process `Transport` over the server's own Trip sync module, running on real Postgres. It is not tested against a hand-written fake server. A fake states the protocol of ADR 0002 a second time, and nothing keeps that copy true. The bugs that matter live where both halves meet: a retry after a lost response, Keep mine after a pull, a Participant restored by an Expense. We accept that these tests need Docker and run slower than plain unit tests.

## Consequences

- The only stand-ins allowed are a network decorator (offline, lost responses) and stubs for calls outside the sync protocol (subscriptions, Reminders).
- A server answer a test needs, such as a Conflict, is produced by a real scenario, e.g. two devices editing the same Expense. It is never scripted.
- The sync schema version check stays in the HTTP adapter. An in-process client is always built from the same code as the server.
