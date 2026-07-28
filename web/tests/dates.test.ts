import { describe, it, expect } from "vitest";
import { addDays, timeAgo, monthYear } from "../src/dates";

const ep = (iso: string) => Date.parse(iso) / 1000;
const TODAY = "2026-07-28";

describe("addDays", () => {
  it("adds across a month boundary", () => expect(addDays("2026-07-30", 3)).toBe("2026-08-02"));
});

describe("timeAgo", () => {
  it("same day -> today", () => expect(timeAgo(ep("2026-07-28T12:00:00Z"), TODAY)).toBe("today"));
  it("future / clock skew clamps to today", () => expect(timeAgo(ep("2026-07-30T00:00:00Z"), TODAY)).toBe("today"));
  it("1 day -> yesterday", () => expect(timeAgo(ep("2026-07-27T23:00:00Z"), TODAY)).toBe("yesterday"));
  it("2 days", () => expect(timeAgo(ep("2026-07-26T00:00:00Z"), TODAY)).toBe("2 days ago"));
  it("6 days", () => expect(timeAgo(ep("2026-07-22T00:00:00Z"), TODAY)).toBe("6 days ago"));
  it("7 days -> singular week", () => expect(timeAgo(ep("2026-07-21T00:00:00Z"), TODAY)).toBe("1 week ago"));
  it("13 days -> still 1 week", () => expect(timeAgo(ep("2026-07-15T00:00:00Z"), TODAY)).toBe("1 week ago"));
  it("14 days -> 2 weeks", () => expect(timeAgo(ep("2026-07-14T00:00:00Z"), TODAY)).toBe("2 weeks ago"));
  it("29 days -> 4 weeks", () => expect(timeAgo(ep("2026-06-29T00:00:00Z"), TODAY)).toBe("4 weeks ago"));
  it("30 days -> singular month", () => expect(timeAgo(ep("2026-06-28T00:00:00Z"), TODAY)).toBe("1 month ago"));
  it("60 days -> 2 months", () => expect(timeAgo(ep("2026-05-29T00:00:00Z"), TODAY)).toBe("2 months ago"));
  it("364 days stays in months", () => expect(timeAgo(ep("2025-07-29T00:00:00Z"), TODAY)).toBe("12 months ago"));
  it("365 days -> singular year", () => expect(timeAgo(ep("2025-07-28T00:00:00Z"), TODAY)).toBe("1 year ago"));
  it("2+ years", () => expect(timeAgo(ep("2024-07-01T00:00:00Z"), TODAY)).toBe("2 years ago"));
});

describe("monthYear", () => {
  it("formats month + year in UTC", () => expect(monthYear(ep("2026-03-12T00:00:00Z"))).toBe("Mar 2026"));
  it("stays in the UTC month at the boundary", () => expect(monthYear(ep("2026-03-31T23:59:59Z"))).toBe("Mar 2026"));
  it("December edge", () => expect(monthYear(ep("2025-12-31T23:00:00Z"))).toBe("Dec 2025"));
});
