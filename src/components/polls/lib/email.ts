// The voter page's email check (SPEC MP-09), kept out of polls-core's validation module so the public page does not
// ship zod and the server schemas (GEN-07, ARCHITECTURE 26 rule 13). Same pattern as looksLikeEmail in
// src/lib/polls/validation.ts (tests/polls-ui/edit-save.test.ts keeps them in step); the server validates again.
// Pure and client safe.
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function looksLikeEmail(v: string): boolean {
  return EMAIL.test(v);
}
