// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Microsoft identity platform OAuth (SPEC AU-03): scopes. Refresh requires the scopes and rotates refresh tokens
// (always persist the newest); the templated `common` issuer is not validated against a fixed string.

export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "OnlineMeetings.ReadWrite",
] as const;

/** Tenant id of personal Microsoft accounts (consumers). */
export const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
