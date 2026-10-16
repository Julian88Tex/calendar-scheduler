import { describe, expect, it } from "vitest";
import { eventPersonasOf, personaFor, personasOf } from "./personas";

describe("personasOf", () => {
  it("gives the built-in business (default) and friends personas before any are saved", () => {
    const list = personasOf({ friends: { greeting: "Yo!" } });
    expect(list.map((p) => [p.id, p.isDefault, p.style])).toEqual([
      ["business", true, "classic"],
      ["friends", false, "warm"],
    ]);
    expect(list[1]!.greeting).toBe("Yo!");
    expect(list[1]!.note).not.toBe("");
  });

  it("cleans the saved list: bad ids and repeats dropped, exactly one default", () => {
    const list = personasOf({
      personas: [
        { id: "Work", name: "Work", isDefault: true },
        { id: "bad id!", name: "Nope" },
        { id: "work", name: "Again", isDefault: true },
        { id: "pals", name: "Pals", style: "warm", isDefault: true },
      ],
    });
    expect(list.map((p) => p.id)).toEqual(["work", "pals"]);
    expect(list.filter((p) => p.isDefault).map((p) => p.id)).toEqual(["work"]);
    expect(list[1]!.style).toBe("warm");
  });
});

describe("personaFor", () => {
  const list = personasOf(undefined);
  it("picks the persona of the link, else the default", () => {
    expect(personaFor(list, "friends")?.id).toBe("friends");
    expect(personaFor(list, "FRIENDS")?.id).toBe("friends");
    expect(personaFor(list, null)?.id).toBe("business");
    expect(personaFor(list, "nobody")?.id).toBe("business");
  });
});

describe("eventPersonasOf", () => {
  it("shows a never-saved type to the default persona and to friends under its legacy friendly name", () => {
    expect(eventPersonasOf({}, "30min", undefined)).toEqual({
      business: { name: "", description: "" },
      friends: { name: "Quick video catch-up", description: "Thirty minutes to hear what's new with you." },
    });
    expect(eventPersonasOf({}, "other", { friends: { events: { other: { name: "Hangout", blurb: "Fun" } } } }).friends).toEqual({ name: "Hangout", description: "Fun" });
  });

  it("uses the saved list as is (an empty one hides the type from everyone)", () => {
    expect(eventPersonasOf({ personas: {} }, "30min", undefined)).toEqual({});
    expect(eventPersonasOf({ personas: { work: { name: " Sync ", description: "" }, "Bad!": {} } }, "30min", undefined)).toEqual({ work: { name: "Sync", description: "" } });
  });
});
