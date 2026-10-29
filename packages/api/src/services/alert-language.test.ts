import { afterEach, describe, expect, it, vi } from "vitest";
import { localizeAlert } from "./alert-language.js";
import { getChannelSender, setEmailApiKey, type AlertContent } from "./channels.js";

const sendEmail = vi.hoisted(() => vi.fn(async (_message: unknown) => ({ data: { id: "test-email" }, error: null })));
vi.mock("resend", () => ({ Resend: class { emails = { send: sendEmail }; } }));
const base: AlertContent = {
  subject: "[SSLert] example.com: Expires in 7 days", text: "Original English message",
  level: "urgent", hostname: "example.com:443", daysRemaining: 5, source: "cert",
};
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); setEmailApiKey(process.env.RESEND_API_KEY); });

describe("localized alert messages", () => {
  it.each([undefined, "en", "invalid"])("preserves English for language %s", language => {
    expect(localizeAlert(base, language, 42)).toBe(base);
  });

  it.each(["cert", "domain"] as const)("translates every severity for %s without changing machine values", source => {
    for (const [level, days] of [["warning", 30], ["urgent", 5], ["critical", 1], ["emergency", 0], ["emergency", -2]] as const) {
      const input = { ...base, level, daysRemaining: days, source };
      const result = localizeAlert(input, "fa", 42, new Date("2026-10-28T12:00:00Z"));
      expect(result.subject).toContain(days > 0 ? "منقضی می‌شود" : "به پایان رسیده");
      expect(result.text).toContain(source === "cert" ? "گواهی SSL" : "ثبت دامنه");
      expect(result.text).toContain("شناسهٔ بررسی: ۴۲");
      expect(result.text).toContain("UTC");
      expect(result.text).toContain("۱۴۰۵");
      expect(result).toMatchObject({ level, daysRemaining: days, source, hostname: "example.com:443" });
      if (days < 0) expect(result.text).toContain("روزهای گذشته از انقضا: ۲");
    }
  });

  it("sends the Persian subject and body to Resend", async () => {
    setEmailApiKey("test-only-key");
    const content = localizeAlert(base, "fa", 42);
    const result = await getChannelSender("email").send(content, { to: "test@example.com", from: "sslert@example.com" }, {});
    expect(result.id).toBe("test-email");
    expect(sendEmail).toHaveBeenCalledWith({ to: "test@example.com", from: "sslert@example.com", subject: content.subject, text: content.text });
  });

  it("sends all normalized recipients to Resend",async()=>{
    setEmailApiKey("test-only-key");
    await getChannelSender("email").send(base,{to:"one@example.com, two@example.com",from:"sender@example.com"},{});
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({to:["one@example.com","two@example.com"]}));
  });
  it("preserves Persian text and escapes HTML in Telegram delivery", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { message_id: 1 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const content = localizeAlert({ ...base, hostname: "a<b&c>:443" }, "fa", 42);
    await getChannelSender("telegram").send(content, { botToken: "test-only", chatId: "123" }, {});
    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(request[1].body));
    expect(payload.parse_mode).toBe("HTML");
    expect(payload.text).toContain("گواهی SSL");
    expect(payload.text).toContain("a&lt;b&amp;c&gt;:443");
    expect(payload.text).not.toContain("a<b&c>");
  });
});
