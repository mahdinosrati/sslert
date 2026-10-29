import { describe, it, expect } from "vitest";
import { recipientsSchema } from "./email-recipients.js";
describe("email recipients", () => {
  it("accepts legacy single addresses and normalizes/deduplicates a list", () => {
    expect(recipientsSchema.parse("one@example.com")).toBe("one@example.com");
    expect(
      recipientsSchema.parse(
        "one@example.com, two@example.com\none@example.com",
      ),
    ).toEqual(["one@example.com", "two@example.com"]);
    expect(
      recipientsSchema.parse(["one@example.com", "two@example.com"]),
    ).toHaveLength(2);
  });
  it("rejects malformed, empty, excessive or header-injection recipients", () => {
    for (const input of [
      "",
      [],
      "one@example.com,broken",
      "one@example.com\nBcc: bad@example.com",
      Array.from({ length: 51 }, (_, i) => `a${i}@example.com`),
    ])
      expect(recipientsSchema.safeParse(input).success).toBe(false);
  });
});
