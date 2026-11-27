# Research: is it safe to join sign-ins from different providers into one account by verified email?

Resolves research ticket #316, part of map #305 (Accounts). It answers the facts that [What is an account, and how does sign-in behave?](https://github.com/RafalOsieka/osi.owe.yeah/issues/307) waits on, compares four options and ends with a recommendation. The decision belongs to #307.

Researched on 2026-11-27 from primary sources: Microsoft Learn (Entra ID token and optional claims references, the Graph `authenticationBehaviors` pages), the MSRC blog, Descope's nOAuth disclosure, Semperis's 2025 follow-up, Google Identity docs and Google support, the Google Developers blog, OpenID Connect Core 1.0, NIST SP 800-63C-4, the OWASP Authentication Cheat Sheet, Truffle Security's report, and library docs, source and security advisories (Auth.js, Better Auth, Keycloak, ZITADEL). Provider defaults and claims change, so facts that can change carry the date they were checked.

Terms: "account" is lowercase, as in `GLOSSARY.md`, until #307 settles it. An **identity** here is one provider sign-in, the pair (issuer, subject); Microsoft's subject is `oid` and its issuer the tenant (`tid`), as the [OAuth sign-in research](https://github.com/RafalOsieka/osi.owe.yeah/blob/research/oauth-sign-in/docs/research/oauth-sign-in.md) recommends. **Joining** means attaching a second identity to an existing account.

## Short answer

- Joining automatically by verified email is **not safe in general**, and the conditions that make it safe cover almost no one in a travelling group. Microsoft's nOAuth problem is mostly closed for a new `/common` registration, but every "verified" flag only says the address was controlled **when it was verified**. An address that later changes hands (a reused work address, a bought-up domain, a recycled mailbox) joins the new holder into the old holder's account, and no claim can detect that.
- Every source that gives advice says the same: key on (issuer, subject), never link because emails match, and link only from a signed-in session (OIDC Core 5.7, NIST SP 800-63C-4 3.8.1, OWASP). The libraries agree: Auth.js and Keycloak don't link silently by default, and Better Auth, which does, has published advisories about it in 2026.
- **Recommended for the first phase: one verified email, one account, no linking.** A sign-in whose verified email already belongs to another account is refused, with a screen naming the provider that account uses. A refusal grants nothing, so there's no takeover path. The failure modes are lock-outs the operator can fix, and it leaves a clean path to adding linking by hand later.

## What can go wrong when joining by email

Three families of attack, all documented:

1. **The provider asserts an address the person doesn't control.** Microsoft's "nOAuth": an admin of any Entra tenant sets a user's `mail` to the victim's address, and an app that links by email hands over the victim's account ([Descope, 2023-06-20](https://www.descope.com/blog/post/noauth)). MSRC's 2022 paper calls the general case a "Non-Verifying IdP" attack ([MSRC, 2022-05-23](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks)).
2. **The address changed hands after it was verified.** OIDC defines `email_verified: true` as "the OP took affirmative steps to ensure that this e-mail address was controlled by the End-User at the time the verification was performed" ([OIDC Core 5.1](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims)). Nothing in the token says who controls it now.
3. **Pre-hijacking.** The attacker creates the account first with the victim's address, then the victim's later sign-in is merged into it ("Classic-Federated Merge" in [MSRC's paper](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks)). Owe Yeah has no passwords, so the classic variant needs an attacker identity that asserts the victim's verified email, which is family 1 again.

## Microsoft: one `AzureADandPersonalMicrosoftAccount` registration on `/common`

### The email claim and its default since nOAuth

- **Never for identity or authorization.** `email` "isn't guaranteed to be correct and is mutable over time. Never use it for authorization or to save data for a user" ([ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference), dated 2023-05-30; [optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference), page dated 2026-07-22). The claims-validation page adds that `email`, `preferred_username` and `unique_name` "can be controllable by tenant administrators or sometimes users" ([claims validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation), dated 2025-03-21).
- **nOAuth timeline.** Descope reported it 2023-04-11. Microsoft shipped fixes on 2023-06-20: the `xms_edov` optional claim and the `RemoveUnverifiedEmailClaim` behaviour flag ([Descope](https://www.descope.com/blog/post/noauth)). MSRC: "the risk is mainly with multi-tenant applications", and "Microsoft has deployed mitigations to omit token claims from unverified domain owners for most applications" ([MSRC, 2023-06-20](https://www.microsoft.com/en-us/msrc/blog/2023/06/potential-risk-of-privilege-escalation-in-azure-ad-applications/)).
- **Today's default** (checked 2026-11-27): "the default behavior is to remove email addresses with unverified domain owners in claims, except for single-tenant apps and for multitenant apps with previous sign-in activity with unverified emails" ([Manage application authenticationBehaviors](https://learn.microsoft.com/en-us/graph/applications-authenticationbehaviors), dated 2025-08-29, page updated 2026-10-20). A new multi-tenant registration gets the removal. Setting `removeUnverifiedEmailClaim: true` pins it ("removes the `email` claim from tokens sent to an application when the email address's domain can't be verified"), `false` accepts unverified emails, `null` restores the default. The property is in Graph v1.0 ([authenticationBehaviors resource](https://learn.microsoft.com/en-us/graph/api/resources/authenticationbehaviors), dated 2026-08-20).
- **The migration guide is gone.** Microsoft's 2023 "Migrate away from using email claims" page now redirects to the identity platform hub (checked 2026-11-27); Semperis noticed the same in 2025 and links an [archived copy](https://web.archive.org/web/20230712111221/https:/learn.microsoft.com/en-us/azure/active-directory/develop/migrate-off-email-claim-authorization).
- **Still being exploited.** In 2025 Semperis tested 104 self-sign-up apps in the Entra App Gallery and found 9 vulnerable to nOAuth; MSRC's answer was that vendors who don't follow the guidance "are subject to removal from the Entra App Gallery" ([Semperis, 2025-06-26](https://www.semperis.com/blog/noauth-abuse-alert-full-account-takeover/)).

### What `xms_edov` guarantees

- **Definition** (checked 2026-11-27): "Boolean value indicating whether the user's email domain owner has been verified. An email is considered to be domain verified if it belongs to the tenant where the user account resides and the tenant admin has done verification of the domain. Also, the email must be from a Microsoft account (MSA), a Google account, or used for authentication using the one-time passcode (OTP) flow. Facebook and SAML/WS-Fed accounts do not have verified domains. For this claim to be returned in the token, the presence of the `email` claim is required" ([optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference)).
- **It's a domain check, not a mailbox check.** In a tenant that verified `contoso.com`, its admin can give any user any `@contoso.com` address and `xms_edov` is true. A Keycloak maintainer puts it the same way: `xms_edov` says the email belongs to the user's domain, "not that the user has really proven possession of the email account" ([keycloak#55109](https://github.com/keycloak/keycloak/issues/55109), 2026-11-12). That's the same trust as Google's `hd`: the domain owner controls the addresses.
- **Its status is unclear.** Semperis (2025) found it missing from the portal's optional-claims UI, and Graph called it "not a valid optional claim" when set, yet it still came back in ID tokens ([Semperis](https://www.semperis.com/blog/noauth-abuse-alert-full-account-takeover/)). The reference still lists it as of 2026-07-22. Whether our registration can request it, and what personal and work accounts send, can only be settled with a real sign-in.
- **Libraries don't use it yet.** Better Auth's Microsoft provider types `xms_edov` but reads `email_verified` (not a claim Microsoft documents for these tokens) or the `verified_primary_email`/`verified_secondary_email` arrays, and defaults to unverified (`packages/core/src/social-providers/microsoft-entra-id.ts`, commit `bbddc3c3ef`, 2026-11-11). Keycloak's Microsoft provider ignores it ([keycloak#55109](https://github.com/keycloak/keycloak/issues/55109), open). ZITADEL's issue says the only safe auto-linking setup for Azure today is a single-tenant app ([zitadel#12421](https://github.com/zitadel/zitadel/issues/12421), open).

### Personal Microsoft accounts

- Personal accounts sign in with `tid` `9188040d-6c67-4c5b-b112-36a304b66dad` ([ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)). They have no tenant admin who could edit their `mail` attribute, so the nOAuth path doesn't apply (our reading; Microsoft doesn't say it in these words), and `xms_edov`'s definition counts MSA emails as verified.
- A personal account's address is either Microsoft's own (`outlook.com`, `hotmail.com`, `live.com`) or any address the person proved at sign-up, for example a Gmail address. The second kind has the same staleness as a Google account on a non-Gmail address (below).
- **Recycled Outlook addresses**: a Microsoft UK blog post (archived on Microsoft Learn) says that after an account is closed, "The email address will be released 60 days after you close the account and can then be used by someone else" ([Microsoft UK blog](https://learn.microsoft.com/en-us/archive/blogs/microsoftuk/microsoft-account-how-to-get-the-most-out-of-it-and-how-not-to-get-locked-out)). The current [close-your-account page](https://support.microsoft.com/help/12412) doesn't say either way (checked 2026-11-27). Treat Outlook addresses as reusable.

### Answer for Microsoft

A new `/common` registration doesn't receive emails with unverified domain owners by default, and `removeUnverifiedEmailClaim: true` pins that. An email that arrives is then either a personal account's address or an address in a domain the user's tenant verified. That stops nOAuth. It does not stop a tenant admin from assigning their own domain's addresses, nor an address changing hands later.

## Google

- **Claims** (page updated 2026-11-19): `sub` is "unique among all Google Accounts and never reused". `email` "may not be unique to this account and could change over time, therefore you shouldn't use this value as the primary identifier to link to your user record". `email_verified` is "True if the user's email address has been verified" ([OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)).
- **When Google is authoritative** (page updated 2025-12-22): "`email` has a `@gmail.com` suffix, this is a Gmail account" and "`email_verified` is true and `hd` is set, this is a Google Workspace account". Otherwise: "When `email` does not contain a `@gmail.com` suffix and `hd` is absent, Google is not authoritative and password or other challenge methods are recommended to verify the user. `email_verified` can also be true as Google initially verified the user when the Google account was created, however ownership of the third party email account may have since changed" ([Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)).
- **Gmail addresses aren't reused**: after Gmail is removed from an account, "Your Gmail address can't be used by anyone in the future" ([Gmail help](https://support.google.com/mail/answer/61177?hl=en), checked 2026-11-27).
- **Gmail addresses can change** (since 2026-04-02, US): people can change their username; the old address stays an alias on the same account. For an existing grant "Google will continue to provide the old email address"; after a revoked grant the new one; `sub` doesn't change ([Google Developers blog](https://developers.googleblog.com/en/supporting-google-account-username-change-in-your-app/)). So the same person's `email` can differ between our two providers without anyone changing anything on our side.
- **Workspace addresses can go to someone else.** The domain owner decides who holds an address, and a lapsed domain can be bought. Truffle Security bought defunct startups' domains, re-created former employees' accounts and signed in to services that trusted `email` and `hd`, because "ownership changes to the domain won't look any different". Google first marked it "Won't fix", then paid a bounty and said it was "working on a fix" without details ([Truffle Security, 2025-01-13](https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw)). Since `sub` is never reused, a re-created account gets a new one, so a service keyed on `sub` isn't fooled and one that joins by email is. (Truffle also cites an unnamed engineer's report that `sub` changes in about 0.04% of logins; Google disputes it.)

### Answer for Google

`email_verified` means Google checked the address once. Google stands behind it only for `@gmail.com` (never reused) and Workspace (`hd` set, but the domain owner can hand the address to someone else). A consumer Google account on any other address may belong to someone who no longer controls that mailbox.

## What the standards and guidance say

- **OIDC Core 5.7**: "The sub (subject) and iss (issuer) Claims from the ID Token, used together, are the only Claims that an RP can rely upon as a stable identifier for the End-User ... an Issuer MAY re-use an email Claim Value across different End-Users at different points in time ... other Claims such as email ... MUST NOT be used as unique identifiers" ([OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability)).
- **NIST SP 800-63C-4, 3.8.1 Account linking**: "the RP SHALL require an authenticated session with the subscriber account for all linking functions. This authenticated session SHOULD require authentication using one existing federated identifier before linking the new federated identifier". A removed identifier must lose access, and the RP "SHALL provide a notice to the subscriber when ... A new federated identifier is added". **3.8.2 Account resolution** (matching existing records to a new identity, which is what an Invitation does): the attributes must be "sufficient to uniquely resolve the subscriber", and the RP must not "associate an RP subscriber account's information with a federated identifier that does not belong to the subscriber" ([SP 800-63C-4](https://pages.nist.gov/800-63-4/sp800-63c.html)).
- **OWASP Authentication Cheat Sheet, Secure Federated Account Linking**: identify by `iss` + `sub`; "Do not automatically link accounts solely because their email, preferred_username, or other profile attributes match"; require an authenticated session and re-authentication before changing links; authenticate the identity being added and bind the response to the linking session; notify the user ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), checked 2026-11-27).
- **MSRC pre-hijacking paper**: before merging, "the service must ensure that the user currently controls both accounts" ([MSRC](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks)).
- **Microsoft**: guest users "should treat the user as if they're a brand new user" and the same person in two tenants is two accounts by design ([ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)).

## What the libraries do

| Library     | Default on a sign-in whose email matches another account                                                                                                                                                                                                                                                              | Linking by email                                                                                                                                                                  | Linking from a session                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth.js     | Not linked: "Automatic account linking on sign in is not secure between arbitrary providers and is disabled by default" ([providers reference](https://authjs.dev/reference/core/providers#allowdangerousemailaccountlinking))                                                                                        | Per provider, `allowDangerousEmailAccountLinking: true`, "if you trust that the provider involved has securely verified the email address"                                        | Not checked                                                                                        |
| Better Auth | Linked, when the provider says the email is verified ([users and accounts](https://www.better-auth.com/docs/concepts/users-accounts))                                                                                                                                                                                 | `trustedProviders` link even without a verified flag ("may increase the risk of account takeover"); `disableImplicitLinking` refuses with `account_not_linked`                    | `linkSocial()` with an active session                                                              |
| Keycloak    | "Create User If Unique" finds the existing user, then "Handle Existing Account" asks the person to confirm and prove the existing account, by email or by re-authenticating, including with an identity provider already linked ([Server admin 26.8.2](https://www.keycloak.org/docs/latest/server_admin/index.html)) | AutoLink "is dangerous in a generic environment ... Do not use this authenticator unless you are carefully curating user registration"; "Trust Email" only sets the verified flag | Account management; "Create User If Unique" as REQUIRED shows an error page instead of a duplicate |
| ZITADEL     | Auto-linking requires a verified external email, after CVE-2026-56666 ([zitadel#12421](https://github.com/zitadel/zitadel/issues/12421))                                                                                                                                                                              | For Azure, the verified flag is one static setting for every user, so multi-tenant is either never or always                                                                      | Yes                                                                                                |

Better Auth's 2026 advisories show how fragile implicit linking is even with a "verified" check:

- [GHSA-g38m-r43w-p2q7](https://github.com/better-auth/better-auth/security/advisories/GHSA-g38m-r43w-p2q7) (2026-05-31): an OAuth sign-in linked to an account an attacker had registered in advance with the victim's address; the fix also requires the existing account's email to be verified.
- [GHSA-9hm7-xhfp-cx58](https://github.com/better-auth/better-auth/security/advisories/GHSA-9hm7-xhfp-cx58) (2026-11-03): any non-empty `email_verified`, including the string `"false"`, counted as verified.
- [GHSA-hwq2-v29r-p69r](https://github.com/better-auth/better-auth/security/advisories/GHSA-hwq2-v29r-p69r) (2026-11-03): an email-change link acted on whoever held the old address when it was opened, which is a reassignment bug.

## Email changes and reassignment

What happens to an account that was joined by email:

| Event                                                                        | Effect if the join happened once, keyed on (issuer, subject)                                                                      | Effect if email is re-matched on every sign-in                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The person changes their address at a provider                               | None: both identities still point at the account                                                                                  | The changed identity no longer matches; it splits off or is refused |
| Their old address goes to someone else, who signs in with any provider       | If the old address is still the account's email, the newcomer's first sign-in joins the old holder's account and sees their Trips | Same                                                                |
| A Workspace admin deletes a user and re-creates the address for someone else | New `sub`, verified email, `hd` set: joins the old holder's account                                                               | Same                                                                |
| A domain lapses and is bought (Truffle Security)                             | Same as above for every address in the domain                                                                                     | Same                                                                |

Rules that limit the damage, from the sources above:

- **Join only when a new identity is first seen**, never re-evaluate later sign-ins of a known (issuer, subject).
- **Match only against an account whose own email passed the same strict check** (the pre-hijacking fix in GHSA-g38m).
- **Parse flags strictly**: Google's `email_verified` must be the boolean `true` (accept the string `"true"` only if seen in practice; Apple sends strings, per the earlier research), Microsoft's `xms_edov` likewise.
- **Refresh the account's email from its own identity's latest verified email**, so an address someone has moved away from stops matching once they sign in again.

None of these rules stops reassignment of an address that is still the account's email. Only proof that the person controls the existing identity does, which is linking by hand.

## The options

### A. Separate accounts per identity, emails not unique

Each (issuer, subject) is its own account; nothing is matched across them.

- **Takeover**: none through sign-in.
- **Costs**: one person who uses Google on the phone and Microsoft on the laptop has two accounts with separate My Trips. Two accounts can hold the same verified email, so an Invitation that names it joins whichever signs in first, and the other sees the Trip read-only. Fixing that later means merging two accounts' Trips and Participants, which is much harder than linking identities.

### B. Join automatically by verified email

The second identity with the same verified email joins the existing account.

The exact conditions under which a join is defensible, combining the provider docs:

1. Google: `email_verified === true` **and** (`@gmail.com` **or** `hd` present). Consumer Google accounts on other addresses never join.
2. Microsoft: `removeUnverifiedEmailClaim: true` on the registration, `email` present, **and** either a personal account (`tid` `9188040d-...`) or `xms_edov === true`.
3. Join once, when the new identity is first seen; the target account's email passed the same check; flags parsed strictly; an in-app notice on the account that an identity was added (NIST 3.8.1 says the RP SHALL notify, and the app sends no email).

Even then, the residual risk is reassignment, and the two providers' authoritative sets barely overlap. Google is authoritative for `@gmail.com` and Workspace domains, Microsoft for its own consumer domains and Entra-verified domains. For the same address to arrive verified from both, it has to be one of these:

- A `@gmail.com` address that is also a personal Microsoft account's address: Google never reuses it, and Microsoft verified it at sign-up. This is the one case that is reasonably safe, and probably the common one.
- A domain an organisation runs on both Workspace and Entra: safe only while the organisation doesn't reassign the address.
- An Outlook address that is also a consumer Google account's address: Google isn't authoritative for it (condition 1 excludes it), and Outlook addresses can be released.

So the conditions cover a narrow case. The machinery (two provider-specific predicates, join-once, the notice) is the same size as linking by hand, and a parsing slip turns it into a takeover (GHSA-9hm7).

### C. Link by hand from a signed-in session

Signed in as the account, the person chooses "Add Google" and completes a second sign-in bound to that session (OWASP, NIST 3.8.1, Better Auth's `linkSocial`, Keycloak's account console).

- **Takeover**: none from email; the person proves both identities.
- **Costs**: a settings section listing identities with add and remove; a link start route that ties the provider round trip to the current session (state plus a server-side record of the session and the requested provider); refusing an identity that already belongs to another account; not removing the last identity; an in-app notice. It needs a connection, like other account actions. On the first sign-in with a new provider, the person must know to sign in the old way first; option D's refusal screen tells them.

### D. One verified email, one account, no linking (first phase)

An account is keyed on (issuer, subject) and holds at most one verified email, unique across accounts (case ignored, as #309 decided). A sign-in from a second provider, or from a new subject at the same provider, whose verified email already belongs to an account is refused with a screen: "This email already signs in with Microsoft. Use Microsoft to sign in."

- **Takeover**: none. A refusal grants nothing, and no sign-in is attached to existing data by email except through an Invitation, which every option shares (below).
- **Squatting** (someone takes the victim's email first and locks them out):
  - Through Microsoft, the attacker needs a token whose `email` is the victim's address and passes the rule. With unverified-domain emails removed and `xms_edov` or a personal account required, that means owning the victim's domain or the victim's personal Microsoft account. nOAuth can't do it.
  - Through Google, the attacker needs a Google account showing the victim's address with `email_verified` true: they must have controlled that mailbox at sign-up (a former holder) or hold its domain now.
  - Until prod, only allowlisted, verified emails get in at all, so the attacker also needs an allowlisted address.
  - The harm is a lock-out, not disclosure. The person reports it and the operator frees the email, as an operator request like account deletion. The refusal screen should say so.
- **What counts as verified for this rule**: the same predicates as B, applied to the account's email. Whether to relax Google to plain `email_verified === true` (consumer Google accounts on other addresses) is a trade: with D, a stale address can only squat, not take over, so relaxing is defensible; keeping the strict rule keeps one predicate for D, the allowlist and Invitations. An identity whose email fails the rule gets an account without an email. Until prod, the allowlist refuses it anyway, and afterwards it can't join Invitations by email.
- **Email change and reassignment**:
  - The account's email is refreshed from its identity's latest verified email at each sign-in. Someone who changed address frees the old one the next time they sign in. Google keeps sending the old Gmail address on an existing grant, which is fine: it's still that person's alias.
  - If the new address already belongs to another account, the sign-in still succeeds and the account keeps its old email; the conflict is the operator's to resolve.
  - An old holder who never signs in again keeps the address and blocks a legitimate new holder, who sees the refusal screen. This is the cost of D, and it fails safe: a lock-out the operator can fix, where B would hand the new holder the old holder's Trips.
  - Telling someone "this email signs in with Microsoft" reveals only that, and only to someone who just proved they control that verified email.
- **Invitations**: a verified email names at most one account, so "signing in with the email it names" (#309) resolves to exactly one account, never two as in A. The Invitation's email check uses the same predicate as the account email, so there is one definition of "verified" in the codebase.
- **A path to linking later**: clean. Adding C later adds identities to an account from a session. The account-level unique email stays, and the refusal screen gains "sign in with Microsoft, then add Google". If the table is `accounts(issuer, subject, email unique)` now, linking later moves (issuer, subject) into an `identities` table, a mechanical one-to-one forward migration (ADR 0005). Moving to B later would be possible too, but the reasons above argue against it.
- **Costs**: one refusal screen, one unique index, one predicate per provider, an operator step to free an email. A person who uses two providers must remember which one they used first.

### Comparison

|                            | A. Separate                  | B. Auto-join                                 | C. Link by hand                  | D. One email, one account                |
| -------------------------- | ---------------------------- | -------------------------------------------- | -------------------------------- | ---------------------------------------- |
| Takeover through sign-in   | None                         | Reassigned addresses; parsing slips          | None                             | None                                     |
| Squatting                  | Not applicable               | Becomes takeover (pre-hijacking)             | None                             | Lock-out, fixed by the operator          |
| Same person, two providers | Two accounts, split My Trips | One account, when the narrow conditions hold | One account, after linking       | Refused, told which provider to use      |
| Invitation by email        | Ambiguous (first wins)       | One account                                  | One account                      | One account                              |
| Build cost                 | Lowest                       | Two predicates, join-once, notice            | Link routes, settings UI, notice | Unique index, predicates, refusal screen |
| Later move to linking      | Hard (merging accounts)      | Already joined                               | Done                             | Additive                                 |

## Recommendation

**Option D in the first phase: an account is keyed on (issuer, subject) and holds at most one verified email; a second identity with that email is refused with a screen naming the provider to use. Add linking by hand (C) when someone needs two providers. Don't join automatically (B).**

- **Key on (issuer, subject), never on email**, with Microsoft on `tid` + `oid`. Source: [OIDC Core 5.7](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability), [Microsoft ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
- **Microsoft's email counts as verified only when** the registration has `removeUnverifiedEmailClaim: true`, `email` is present, and the token is from a personal account (`tid` `9188040d-6c67-4c5b-b112-36a304b66dad`) or carries `xms_edov: true`. Source: [authenticationBehaviors](https://learn.microsoft.com/en-us/graph/applications-authenticationbehaviors), [optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference).
- **Google's email counts as verified only when** `email_verified` is `true` and the address is `@gmail.com` or `hd` is set. Relaxing this to any `email_verified: true` is acceptable under D, because a stale address can only squat. Source: [Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
- **No automatic joining**: the "verified" flags can't detect an address that changed hands, and the cross-provider cases they do cover safely are narrow (a Gmail address used for a personal Microsoft account). Source: [OWASP Secure Federated Account Linking](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Truffle Security](https://trufflesecurity.com/blog/millions-at-risk-due-to-google-s-oauth-flaw), [Better Auth GHSA-9hm7](https://github.com/better-auth/better-auth/security/advisories/GHSA-9hm7-xhfp-cx58).
- **Refresh the account's email from its own identity at each sign-in**, keep the old one if the new one belongs to another account, and let the operator free an email that's stuck. Lock-outs fail safe; joins fail open.
- **Invitations use the same predicate** and match the account's unique email, so an Invitation resolves to one account. Source: [NIST SP 800-63C-4 3.8.2](https://pages.nist.gov/800-63-4/sp800-63c.html).
- **When linking comes**, it starts from a signed-in session, re-proves the new identity in a round trip bound to that session, refuses an identity owned by another account, keeps at least one identity, and shows an in-app notice. Source: [NIST SP 800-63C-4 3.8.1](https://pages.nist.gov/800-63-4/sp800-63c.html), [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- **Before building, sign in for real** with a personal Microsoft account and a work account on our `/common` registration, and record whether `email` and `xms_edov` arrive. If `xms_edov` can't be requested, work and school accounts have no verified email under this rule. They can still sign in, but they can't pass the allowlist or join an Invitation by email. Source: [Semperis](https://www.semperis.com/blog/noauth-abuse-alert-full-account-takeover/) on `xms_edov`'s unclear status.

### What this means for Invitations

An Invitation already trusts a verified email: it is what NIST calls account resolution, matching an existing Participant to a new identity. So it carries the same reassignment risk as joining. Someone who now holds an address the admin typed can join the Trip as that Participant. The risk is smaller than joining accounts because the admin chose the address recently, the Invitation is for one Participant, expires and can be revoked, and anyone else gets the read-only view. Two consequences:

- The Invitation's email check must use the same verified-email predicate as the account, not just `email_verified`, or nOAuth comes back through Invitations: an attacker's tenant asserts the invited address and joins the Trip.
- Under D, the invited email maps to at most one account, so an admin's Invitation can't be taken by a second account that holds the same address, which it could under A.

## Open questions for later tickets

- **Real tokens** (#307 or a prototype): what do a personal Microsoft account and a work account send on our registration, can `xms_edov` still be configured, and does a personal account on a Gmail address carry `xms_edov`?
- **Google strictness** (#307, #308): strict (`@gmail.com` or `hd`) or any `email_verified: true`, for the account email, the allowlist and Invitations alike?
- **Freeing a stuck email** (#308, #313): an operator request like account deletion, and does the privacy notice mention it?
- **Normalisation**: lowercase the whole address only (as #309 says), or also Gmail's dots and `+` tags? Lowercase only is simpler and never merges two people.
- **Accounts without a verified email after prod**: allowed, or refused like during the allowlist period?
- **Apple, later**: private relay addresses never match a Gmail or Outlook address, so under D an Apple user gets a separate account until linking exists.
