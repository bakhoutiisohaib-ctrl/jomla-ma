# Session cookie migration (plan only)

Bearer-token storage is unchanged in this fixes branch. Do not partly migrate
one dashboard or leave two independently authoritative sessions.

Before implementation, choose same-origin hosting and HTTPS; specify cookie
name, Path, expiry, HttpOnly, Secure and SameSite policy. Define CSRF token and
Origin validation for every state-changing browser request. Review CORS and
proxy trust together with this contract. Do not widen allowed origins.

Migrate login, logout, refresh/session validation, account recovery and every
API caller together. Keep tokenVersion revocation and live membership checks.
Remove legacy localStorage tokens only when cookie-backed login is working;
never silently import an untrusted stored token into a new cookie session.

Required tests: CSRF rejection, cross-origin requests, expiry, logout, password
reset, revoked/disabled users, staff permissions, two tabs, AR/FR/EN login, and
protected/public media. Test rollback without restoring stale bearer sessions.
Deployment requires an explicitly reviewed environment configuration. This
document does not authorize deployment or claim cookie migration is complete.
