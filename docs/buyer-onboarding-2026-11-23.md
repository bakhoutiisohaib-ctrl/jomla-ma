# Buyer onboarding — 23 November 2026

The owner clarified that "code" means password, not an email OTP. This branch
implements the email/password part of the requested onboarding change.

## Behavior

Buyer registration asks for email, password and confirmation; gender is optional
with "prefer not to say" selected. The account-type selector remains available.
Name, phone and city are deferred. After creation, a large browse button and an
optional details button are shown. Browsing returns to the requested destination
or the marketplace. Supplier/staff registration requirements are preserved.

New buyers without complete contact details receive a server-owned
`profilePending` flag. They can browse and collect products. Both RFQ and sourcing
creation reject incomplete accounts with `BUYER_CONTACT_REQUIRED`. Their forms
first offer contact completion (name, city, phone), retaining the selected
product/cart. Failure to save does not release the gate. Saved completion is
read by live authentication, independent of old JWT claims. Clients cannot set
the flag through profile updates. Existing accounts keep their previous behavior;
no migration of historical accounts or data was performed.

Gender is excluded from normal model selection and is not added to the public
or account response DTO. No gender condition gates browsing or requests.
Password confirmation is checked by the new UI and, when supplied, the API;
older API callers remain compatible. No email-ownership verification or new
CAPTCHA is claimed by password confirmation.

## Verification

74 targeted backend cases and 48 distinct frontend cases passed; the contact
test rerun is counted once. The private-pilot production build compiled
successfully. [Machine-readable evidence](evidence/buyer-onboarding-20261123/summary.json)
records the individual runs and hashes. Tests ran sequentially on Windows with
synthetic data, a bounded Node heap and disposable MongoDB 5.0.19. No dependency
upgrade or original-data operation was needed. This was not a full regression.

The fresh private preview listens only on `127.0.0.1:3001`; registration is at
`http://localhost:3001/register`. Its readiness endpoint returned ready. The
previous preview on port 3000 was retained. After access was restored, physical
Redmi/Chrome verification passed in Arabic over USB forwarding: minimal buyer
registration, continue browsing without contact details, product RFQ contact
gate, contact save with phone/city carried forward, and submission of quantity
10. The buyer dashboard displayed the request as awaiting the supplier.
Screenshots below contain only synthetic test details. The welcome screenshot
was excluded because Chrome displayed an unrelated personal account popup.

- [Contact gate](evidence/buyer-onboarding-20261123/android-contact-gate.png)
- [RFQ after contact completion](evidence/buyer-onboarding-20261123/android-rfq-form.png)
- [Created request](evidence/buyer-onboarding-20261123/android-rfq-record.png)

This verifies the direct-product RFQ path on Android, not a new cart-path,
iPhone, cross-language or full responsive regression. The dashboard header
still showed the session's initial buyer display name after contact completion;
that cosmetic refresh issue remains open and did not block request creation.
The preview scripts/build/raw logs are outside Git under
`C:\JomlaLocal\onboarding-20261123`.

## Still outstanding: identity providers

Google, Apple and Microsoft sign-in are NOT implemented or enabled by this
branch. No placeholder button claims to authenticate a user. Ordinary email
registration supports addresses from any provider. Real provider integration
needs provider application registrations and approved callback configuration;
credentials must stay outside Git and chat. The owner has not yet supplied the
provider setup status requested in this conversation.

The next provider phase must cover server-side code exchange, signed identity
validation, issuer/audience/nonce/state checks, one-time callback handling,
explicit account linking (never merge existing accounts from an untrusted email
claim), role selection and contact completion, and recovery for passwordless
accounts. Test real configured flows before claiming success.

Official setup references:
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)
- [Microsoft OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)

No deployment or final hosting acceptance was performed. iPhone testing and the
provider phase remain open; this report does not close the owner's full request.
