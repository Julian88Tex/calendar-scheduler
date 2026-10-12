// CSV export of a poll's responses (SPEC MP-32; research meeting-polls.md D1): one row per participant, one column per
// option (labelled in the host zone), cells "Yes", "If need be", "No" or blank (no answer), plus email, status and the
// comment count. Host-only (it contains emails). Pure.
//
// RFC 4180 quoting (fields with a comma, quote, CR or LF are quoted, quotes doubled), CRLF line endings, and spreadsheet
// formula injection protection: cells starting with = + - @ (or a tab or CR) get a leading apostrophe.
import type { ParticipantStatus, VoteChoice } from "./types";

export type CsvOption = { id: string; label: string };
export type CsvParticipant = {
  name: string;
  email: string | null;
  status: ParticipantStatus;
  votes: Readonly<Record<string, VoteChoice>>;
  commentCount: number;
};

const CHOICE_LABEL: Record<VoteChoice, string> = { yes: "Yes", if_need_be: "If need be", no: "No" };
const STATUS_LABEL: Record<ParticipantStatus, string> = { invited: "Invited, no response", responded: "Responded", declined: "Declined" };

/** One CSV field, quoted when needed and neutralized against formula injection. */
export function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The export (see the file header). */
export function buildPollCsv(options: readonly CsvOption[], participants: readonly CsvParticipant[]): string {
  const header = ["Name", "Email", "Status", "Comments", ...options.map((o) => o.label)];
  const lines = [header.map(csvField).join(",")];
  for (const p of participants) {
    const cells = [p.name, p.email ?? "", STATUS_LABEL[p.status], p.commentCount, ...options.map((o) => (p.votes[o.id] ? CHOICE_LABEL[p.votes[o.id]!] : ""))];
    lines.push(cells.map(csvField).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** A safe file name for the export ("team-sync-responses.csv"). */
export function csvFileName(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "meeting-poll"}-responses.csv`;
}
