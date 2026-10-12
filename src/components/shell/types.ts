// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Serializable data the dashboard layout passes to the shell components.

export type ShellUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  /** Public handle (null while onboarding has not chosen one). */
  slug: string | null;
  timezone: string;
  emailVerified: boolean;
};
