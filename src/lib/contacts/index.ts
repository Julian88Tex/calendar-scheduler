// OWNER: contacts. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Contacts contract (ARCHITECTURE section 25): search for pickers and the invitee upsert used by subscribers.
// Foundation stub: no contacts, upsert is a no-op.
import "server-only";

export type ContactSearchResult = {
  id: string;
  name: string;
  email: string | null;
  timezone: string | null;
  company: string | null;
};

/** Contacts of `ownerUserId` matching a name or email prefix, best matches first. */
export async function searchContacts(ownerUserId: string, q: string, limit: number): Promise<ContactSearchResult[]> {
  void ownerUserId;
  void q;
  void limit;
  return [];
}

/** Creates or updates the host's contact for an invitee (by normalized email per host, CT-02). Returns the contact id. */
export async function upsertContactForInvitee(inviteeId: string): Promise<string | null> {
  void inviteeId;
  return null;
}
