import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../src/dates.js";

describe("utcTimestamp", () => {
  it("marca timestamps DATETIME do MySQL como UTC", () => {
    expect(utcTimestamp("2026-08-27 02:58:00.123")).toBe("2026-08-27T02:58:00.123Z");
  });

  it("preserva instantes ISO válidos", () => {
    expect(utcTimestamp("2026-08-27T02:58:00.000Z")).toBe("2026-08-27T02:58:00.000Z");
  });
});
