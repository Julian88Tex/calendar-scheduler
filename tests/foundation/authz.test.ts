// Authorization: access helpers (role matrix) and every cross-tenant assert helper (ARCHITECTURE 18.7, SPEC GEN-08).
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  availabilitySchedules,
  calendarConnections,
  contacts,
  eventTypePermissions,
  routingFormPermissions,
  teams,
  users,
} from "@/db/schema";
import type { LocationConfig } from "@/db/types";
import {
  assertAccess,
  assertCalendarOwnedBy,
  assertConferencingConnectionOwnedBy,
  assertContactOwnedBy,
  assertCouponOwnedBy,
  assertEventTypesEditable,
  assertGroupInOrg,
  assertLocationConnectionsOwnedBy,
  assertSameOrgUsers,
  assertScheduleUsableBy,
  assertTeamInOrg,
  canSeeAdminCenter,
  eventTypeAccess,
  eventTypeAccessAtLeast,
  isOrgAdmin,
  loadActorCtx,
  meetingAccess,
  pollAccess,
  routingFormAccess,
  teamAccess,
  type ActorCtx,
} from "@/lib/authz";
import { useTestDb } from "../helpers/db";
import {
  createBooking,
  createCalendarConnection,
  createConferencingConnection,
  createContact,
  createCoupon,
  createEventType,
  createGroup,
  createPoll,
  createRoutingForm,
  createSchedule,
  createTeam,
  createUser,
  type TestUser,
} from "../factories";

const env = process.env as Record<string, string | undefined>;
const t = useTestDb();

type World = Awaited<ReturnType<typeof build>>;
let w: World;

async function build() {
  const db = t.db;
  const ownerA = await createUser(db, { name: "Owner A" });
  const org = ownerA.organizationId;
  const join = (name: string, orgRole: "admin" | "user" = "user") => createUser(db, { name, organizationId: org, orgRole });
  const adminA = await join("Admin A", "admin");
  const u1 = await join("User One");
  const u2 = await join("User Two");
  const u3 = await join("User Three");
  const mgr = await join("Team Manager");
  const mem = await join("Team Member");
  const mem2 = await join("Team Member Two");
  const ownerB = await createUser(db, { name: "Owner B" });
  const uB = await createUser(db, { name: "User B", organizationId: ownerB.organizationId, orgRole: "user" });

  const { team } = await createTeam(db, {
    organizationId: org,
    members: [
      { userId: mgr.id, role: "manager" },
      { userId: mem.id, role: "member" },
      { userId: mem2.id, role: "member" },
    ],
  });
  const { team: deletedTeam } = await createTeam(db, { organizationId: org, members: [{ userId: mem.id }] });
  await db.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, deletedTeam.id));
  const { team: teamB } = await createTeam(db, { organizationId: ownerB.organizationId });
  const { group } = await createGroup(db, { organizationId: org, members: [{ userId: u3.id, role: "admin" }] });
  const { group: groupB } = await createGroup(db, { organizationId: ownerB.organizationId });

  const etP = (await createEventType(db, { owner: u1 })).eventType;
  await db.insert(eventTypePermissions).values([
    { eventTypeId: etP.id, userId: u2.id, level: "view" },
    { eventTypeId: etP.id, userId: u3.id, level: "edit" },
  ]);
  const etS = (await createEventType(db, { owner: u1, scope: "shared", poolingType: "collective", hosts: [{ userId: u1.id }, { userId: u2.id }] })).eventType;
  const etT = (await createEventType(db, { team, hosts: [{ userId: mem.id }] })).eventType;
  const etDeleted = (await createEventType(db, { owner: u1, overrides: { deletedAt: new Date() } })).eventType;
  const etB = (await createEventType(db, { owner: uB })).eventType;

  const mP = (await createBooking(db, { eventType: etP, start: "2030-01-10T15:00:00Z" })).scheduledEvent;
  const mS = (await createBooking(db, { eventType: etS, start: "2030-01-11T15:00:00Z" })).scheduledEvent;
  const mT = (await createBooking(db, { eventType: etT, start: "2030-01-12T15:00:00Z" })).scheduledEvent;
  const mB = (await createBooking(db, { eventType: etB, start: "2030-01-13T15:00:00Z" })).scheduledEvent;

  const { form } = await createRoutingForm(db, { owner: u1 });
  await db.insert(routingFormPermissions).values([
    { formId: form.id, userId: u2.id, level: "view" },
    { formId: form.id, userId: u3.id, level: "edit" },
  ]);
  const { form: formB } = await createRoutingForm(db, { owner: uB });

  const { poll } = await createPoll(db, { owner: u1, coHostIds: [u2.id] });
  const { poll: pollB } = await createPoll(db, { owner: uB });

  const s1 = await createSchedule(db, { userId: u1.id });
  const sCustomP = await createSchedule(db, { userId: u1.id, eventTypeId: etP.id, name: "Custom" });
  const sDeleted = await createSchedule(db, { userId: u1.id, isDefault: false, overrides: { deletedAt: new Date() } });
  const sB = await createSchedule(db, { userId: uB.id });

  const cal = await createCalendarConnection(db, {
    userId: u1.id,
    calendars: [{ canWrite: true }, { canWrite: false, name: "Holidays" }],
  });
  const calDisc = await createCalendarConnection(db, { userId: u1.id });
  await db.update(calendarConnections).set({ status: "disconnected" }).where(eq(calendarConnections.id, calDisc.connection.id));
  const calB = await createCalendarConnection(db, { userId: uB.id });

  const zoom1 = await createConferencingConnection(db, { userId: u1.id });
  const zoomB = await createConferencingConnection(db, { userId: uB.id });

  const contact1 = (await createContact(db, { owner: u1 })).contact;
  const contactDeleted = (await createContact(db, { owner: u1 })).contact;
  await db.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, contactDeleted.id));
  const contactB = (await createContact(db, { owner: uB })).contact;

  const coupon1 = await createCoupon(db, { ownerUserId: u1.id });
  const couponB = await createCoupon(db, { ownerUserId: uB.id });

  const deletedUser = await join("Deleted User");
  await db.update(users).set({ deletedAt: new Date(), slug: null }).where(eq(users.id, deletedUser.id));

  return {
    org, ownerA, adminA, u1, u2, u3, mgr, mem, mem2, ownerB, uB, deletedUser,
    team, deletedTeam, teamB, group, groupB,
    etP, etS, etT, etDeleted, etB, mP, mS, mT, mB, form, formB, poll, pollB,
    s1, sCustomP, sDeleted, sB, cal, calDisc, calB, zoom1, zoomB,
    contact1, contactDeleted, contactB, coupon1, couponB,
  };
}

const actors = new Map<string, ActorCtx>();
async function actor(u: TestUser): Promise<ActorCtx> {
  const cached = actors.get(u.id);
  if (cached) return cached;
  const [row] = await t.db.select().from(users).where(eq(users.id, u.id));
  const a = await loadActorCtx(t.db, row!);
  actors.set(u.id, a);
  return a;
}

beforeAll(async () => {
  w = await build();
});
afterEach(() => {
  delete env.ADMIN_EMAILS;
});

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ name: "AppError", code: "forbidden", status: 403 });
}

describe("actor context", () => {
  it("loads org role, team roles and group admin memberships", async () => {
    const mgr = await actor(w.mgr);
    expect(mgr.orgId).toBe(w.org);
    expect(mgr.orgRole).toBe("user");
    expect(mgr.teamRoles.get(w.team.id)).toBe("manager");
    const mem = await actor(w.mem);
    expect(mem.teamRoles.get(w.team.id)).toBe("member");
    expect(mem.teamRoles.has(w.deletedTeam.id)).toBe(false); // deleted teams do not count
    expect((await actor(w.u3)).groupAdminOf.has(w.group.id)).toBe(true);
    expect((await actor(w.ownerA)).orgRole).toBe("owner");
    expect(isOrgAdmin(await actor(w.ownerA))).toBe(true);
    expect(isOrgAdmin(await actor(w.adminA))).toBe(true);
    expect(isOrgAdmin(await actor(w.u1))).toBe(false);
    expect(canSeeAdminCenter(await actor(w.u1))).toBe(false);
  });

  it("instance admins come from users.is_instance_admin or ADMIN_EMAILS", async () => {
    const [row] = await t.db.select().from(users).where(eq(users.id, w.u2.id));
    expect((await loadActorCtx(t.db, row!)).isInstanceAdmin).toBe(false);
    expect((await loadActorCtx(t.db, { ...row!, isInstanceAdmin: true })).isInstanceAdmin).toBe(true);
    env.ADMIN_EMAILS = `someone@else.com, ${row!.email!.toUpperCase()}`;
    const viaEnv = await loadActorCtx(t.db, row!);
    expect(viaEnv.isInstanceAdmin).toBe(true);
    expect(canSeeAdminCenter(viaEnv)).toBe(true);
    // An unverified account with a listed address gets nothing (open signup must not grant instance admin).
    const unverified = await loadActorCtx(t.db, { ...row!, emailVerifiedAt: null });
    expect(unverified.isInstanceAdmin).toBe(false);
  });
});

describe("eventTypeAccess role matrix", () => {
  const cases: [string, keyof World, keyof World, "owner" | "edit" | "view" | null][] = [
    ["personal owner", "u1", "etP", "owner"],
    ["org owner", "ownerA", "etP", "edit"],
    ["org admin", "adminA", "etP", "edit"],
    ["view permission", "u2", "etP", "view"],
    ["edit permission", "u3", "etP", "edit"],
    ["unrelated team manager", "mgr", "etP", null],
    ["unrelated member", "mem", "etP", null],
    ["other org owner", "ownerB", "etP", null],
    ["other org user", "uB", "etP", null],
    ["shared owner", "u1", "etS", "owner"],
    ["shared host", "u2", "etS", "edit"],
    ["shared non-host", "u3", "etS", null],
    ["team manager", "mgr", "etT", "edit"],
    ["team host", "mem", "etT", "edit"],
    ["team member (not host)", "mem2", "etT", "view"],
    ["not in team", "u1", "etT", null],
    ["admin on team type", "adminA", "etT", "edit"],
    ["deleted type, owner", "u1", "etDeleted", null],
    ["deleted type, admin", "adminA", "etDeleted", null],
    ["other org type, its owner", "uB", "etB", "owner"],
    ["other org type, its org owner", "ownerB", "etB", "edit"],
    ["other org type, our admin", "adminA", "etB", null],
  ];
  it.each(cases)("%s", async (_label, who, what, expected) => {
    const a = await actor(w[who] as TestUser);
    const id = (w[what] as { id: string }).id;
    expect(await eventTypeAccess(a, id)).toBe(expected);
  });

  it("rejects invalid and unknown ids, and compares levels", async () => {
    const a = await actor(w.ownerA);
    expect(await eventTypeAccess(a, "not-a-uuid")).toBeNull();
    expect(await eventTypeAccess(a, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(eventTypeAccessAtLeast("owner", "edit")).toBe(true);
    expect(eventTypeAccessAtLeast("view", "edit")).toBe(false);
    expect(eventTypeAccessAtLeast(null, "view")).toBe(false);
  });
});

describe("meetingAccess", () => {
  const cases: [keyof World, keyof World, "manage" | "view" | null][] = [
    ["u1", "mP", "manage"],
    ["adminA", "mP", "manage"],
    ["ownerA", "mP", "manage"],
    ["u3", "mP", "manage"], // edit permission on the event type
    ["u2", "mP", "view"], // view permission on the event type
    ["mgr", "mP", null],
    ["ownerB", "mP", null],
    ["u2", "mS", "manage"], // co-host
    ["u3", "mS", null],
    ["mem", "mT", "manage"],
    ["mgr", "mT", "manage"],
    ["mem2", "mT", "view"],
    ["u1", "mT", null],
    ["uB", "mB", "manage"],
    ["adminA", "mB", null],
  ];
  it.each(cases)("%s on %s", async (who, what, expected) => {
    expect(await meetingAccess(await actor(w[who] as TestUser), (w[what] as { id: string }).id)).toBe(expected);
  });
});

describe("teamAccess, routingFormAccess, pollAccess", () => {
  it("teams: org admins and managers manage, members are members", async () => {
    expect(await teamAccess(await actor(w.ownerA), w.team.id)).toBe("manage");
    expect(await teamAccess(await actor(w.adminA), w.team.id)).toBe("manage");
    expect(await teamAccess(await actor(w.mgr), w.team.id)).toBe("manage");
    expect(await teamAccess(await actor(w.mem), w.team.id)).toBe("member");
    expect(await teamAccess(await actor(w.u1), w.team.id)).toBeNull();
    expect(await teamAccess(await actor(w.ownerB), w.team.id)).toBeNull();
    expect(await teamAccess(await actor(w.adminA), w.deletedTeam.id)).toBeNull();
    expect(await teamAccess(await actor(w.adminA), w.teamB.id)).toBeNull();
  });

  it("routing forms: owner, admins and permissions", async () => {
    expect(await routingFormAccess(await actor(w.u1), w.form.id)).toBe("edit");
    expect(await routingFormAccess(await actor(w.adminA), w.form.id)).toBe("edit");
    expect(await routingFormAccess(await actor(w.u2), w.form.id)).toBe("view");
    expect(await routingFormAccess(await actor(w.u3), w.form.id)).toBe("edit");
    expect(await routingFormAccess(await actor(w.mgr), w.form.id)).toBeNull();
    expect(await routingFormAccess(await actor(w.ownerB), w.form.id)).toBeNull();
    expect(await routingFormAccess(await actor(w.adminA), w.formB.id)).toBeNull();
  });

  it("polls: creator owner, co-hosts and org admins manage (MP-01)", async () => {
    expect(await pollAccess(await actor(w.u1), w.poll.id)).toBe("owner");
    expect(await pollAccess(await actor(w.u2), w.poll.id)).toBe("manage");
    expect(await pollAccess(await actor(w.adminA), w.poll.id)).toBe("manage");
    expect(await pollAccess(await actor(w.ownerA), w.poll.id)).toBe("manage");
    expect(await pollAccess(await actor(w.u3), w.poll.id)).toBeNull();
    expect(await pollAccess(await actor(w.ownerB), w.poll.id)).toBeNull();
    expect(await pollAccess(await actor(w.adminA), w.pollB.id)).toBeNull();
    expect(await pollAccess(await actor(w.uB), w.pollB.id)).toBe("owner");
  });

  it("assertAccess throws forbidden for null", () => {
    expect(() => assertAccess(null)).toThrow();
    expect(() => assertAccess("edit")).not.toThrow();
    try {
      assertAccess(false, "You can't edit this event type.");
    } catch (e) {
      expect(e).toMatchObject({ code: "forbidden", status: 403, message: "You can't edit this event type." });
    }
  });
});

describe("cross-tenant assert helpers (GEN-08)", () => {
  it("assertScheduleUsableBy", async () => {
    await expect(assertScheduleUsableBy(t.db, w.s1.id, [w.u1.id])).resolves.toBeUndefined();
    await expect(assertScheduleUsableBy(t.db, w.s1.id, [w.u2.id, w.u1.id])).resolves.toBeUndefined();
    await expectForbidden(assertScheduleUsableBy(t.db, w.s1.id, [w.u2.id]));
    await expectForbidden(assertScheduleUsableBy(t.db, w.sB.id, [w.u1.id])); // another org's schedule
    await expectForbidden(assertScheduleUsableBy(t.db, w.sDeleted.id, [w.u1.id]));
    await expectForbidden(assertScheduleUsableBy(t.db, "bogus", [w.u1.id]));
    await expectForbidden(assertScheduleUsableBy(t.db, "00000000-0000-4000-8000-000000000000", [w.u1.id]));
    // A custom schedule of this event type is usable by the type (whoever the hosts are), not by another type.
    await expect(assertScheduleUsableBy(t.db, w.sCustomP.id, [w.u2.id], { eventTypeId: w.etP.id })).resolves.toBeUndefined();
    await expectForbidden(assertScheduleUsableBy(t.db, w.sCustomP.id, [w.u1.id], { eventTypeId: w.etS.id }));
    await expectForbidden(assertScheduleUsableBy(t.db, w.sCustomP.id, [w.u1.id]));
  });

  it("assertSameOrgUsers", async () => {
    await expect(assertSameOrgUsers(t.db, w.org, [w.u1.id, w.u2.id, w.u1.id])).resolves.toBeUndefined();
    await expect(assertSameOrgUsers(t.db, w.org, [])).resolves.toBeUndefined();
    await expectForbidden(assertSameOrgUsers(t.db, w.org, [w.u1.id, w.uB.id]));
    await expectForbidden(assertSameOrgUsers(t.db, w.ownerB.organizationId, [w.u1.id]));
    await expectForbidden(assertSameOrgUsers(t.db, w.org, [w.deletedUser.id]));
    await expectForbidden(assertSameOrgUsers(t.db, w.org, ["nope"]));
  });

  it("assertCalendarOwnedBy", async () => {
    const [writable, readOnly] = w.cal.calendars;
    await expect(assertCalendarOwnedBy(t.db, writable!.id, w.u1.id)).resolves.toBeUndefined();
    await expectForbidden(assertCalendarOwnedBy(t.db, readOnly!.id, w.u1.id)); // destination must be writable
    await expect(assertCalendarOwnedBy(t.db, readOnly!.id, w.u1.id, { purpose: "read" })).resolves.toBeUndefined();
    await expectForbidden(assertCalendarOwnedBy(t.db, writable!.id, w.u2.id));
    await expectForbidden(assertCalendarOwnedBy(t.db, w.calDisc.calendars[0]!.id, w.u1.id));
    await expectForbidden(assertCalendarOwnedBy(t.db, w.calB.calendars[0]!.id, w.u1.id));
  });

  it("assertConferencingConnectionOwnedBy and assertLocationConnectionsOwnedBy", async () => {
    await expect(assertConferencingConnectionOwnedBy(t.db, w.zoom1.id, w.u1.id)).resolves.toBeUndefined();
    await expectForbidden(assertConferencingConnectionOwnedBy(t.db, w.zoom1.id, w.u2.id));
    await expectForbidden(assertConferencingConnectionOwnedBy(t.db, w.zoomB.id, w.u1.id));
    const loc = (connectionId: string | null): LocationConfig => ({ id: crypto.randomUUID(), kind: "zoom_conference", position: 0, connectionId });
    await expect(assertLocationConnectionsOwnedBy(t.db, [loc(w.zoom1.id), loc(null)], [w.u1.id, w.u2.id])).resolves.toBeUndefined();
    await expect(assertLocationConnectionsOwnedBy(t.db, [loc(null)], [])).resolves.toBeUndefined();
    await expectForbidden(assertLocationConnectionsOwnedBy(t.db, [loc(w.zoomB.id)], [w.u1.id]));
    await expectForbidden(assertLocationConnectionsOwnedBy(t.db, [loc(w.zoom1.id), loc(w.zoomB.id)], [w.u1.id]));
  });

  it("assertContactOwnedBy", async () => {
    await expect(assertContactOwnedBy(t.db, w.contact1.id, w.u1.id)).resolves.toBeUndefined();
    await expectForbidden(assertContactOwnedBy(t.db, w.contact1.id, w.u2.id));
    await expectForbidden(assertContactOwnedBy(t.db, w.contactDeleted.id, w.u1.id));
    await expectForbidden(assertContactOwnedBy(t.db, w.contactB.id, w.u1.id));
  });

  it("assertCouponOwnedBy", async () => {
    await expect(assertCouponOwnedBy(t.db, w.coupon1.id, w.u1.id)).resolves.toBeUndefined();
    await expectForbidden(assertCouponOwnedBy(t.db, w.coupon1.id, w.u2.id));
    await expectForbidden(assertCouponOwnedBy(t.db, w.couponB.id, w.u1.id));
  });

  it("assertGroupInOrg and assertTeamInOrg", async () => {
    await expect(assertGroupInOrg(t.db, w.group.id, w.org)).resolves.toBeUndefined();
    await expectForbidden(assertGroupInOrg(t.db, w.groupB.id, w.org));
    await expectForbidden(assertGroupInOrg(t.db, w.group.id, w.ownerB.organizationId));
    await expect(assertTeamInOrg(t.db, w.team.id, w.org)).resolves.toBeUndefined();
    await expectForbidden(assertTeamInOrg(t.db, w.teamB.id, w.org));
    await expectForbidden(assertTeamInOrg(t.db, w.deletedTeam.id, w.org));
  });

  it("assertEventTypesEditable per role", async () => {
    await expect(assertEventTypesEditable(t.db, await actor(w.u1), [w.etP.id, w.etS.id])).resolves.toBeUndefined();
    await expect(assertEventTypesEditable(t.db, await actor(w.u2), [w.etS.id])).resolves.toBeUndefined();
    await expectForbidden(assertEventTypesEditable(t.db, await actor(w.u2), [w.etS.id, w.etP.id])); // view only on etP
    await expect(assertEventTypesEditable(t.db, await actor(w.adminA), [w.etP.id, w.etT.id])).resolves.toBeUndefined();
    await expectForbidden(assertEventTypesEditable(t.db, await actor(w.adminA), [w.etB.id])); // other org
    await expect(assertEventTypesEditable(t.db, await actor(w.mgr), [w.etT.id])).resolves.toBeUndefined();
    await expectForbidden(assertEventTypesEditable(t.db, await actor(w.mem2), [w.etT.id]));
    await expectForbidden(assertEventTypesEditable(t.db, await actor(w.u1), [w.etDeleted.id]));
    await expect(assertEventTypesEditable(t.db, await actor(w.u1), [])).resolves.toBeUndefined();
  });

  it("helpers work inside a write transaction", async () => {
    await t.db.transaction(async (tx) => {
      await assertSameOrgUsers(tx, w.org, [w.u1.id]);
      await assertScheduleUsableBy(tx, w.s1.id, [w.u1.id]);
      const rows = await tx.select().from(availabilitySchedules).where(eq(availabilitySchedules.id, w.s1.id));
      expect(rows).toHaveLength(1);
    });
  });
});
