import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "../db/index.js";
import { runSqlMigrations } from "../db/sqlmigrate.js";
import { alertChannels, checks, domains } from "../db/schema.js";
import { processCheckAlert } from "./alerter.js";
import { resetChannelSender, setChannelSender, type AlertContent, type ChannelName } from "./channels.js";
import { createChannelsRouter } from "../routes/channels.js";

describe("saved channel language", () => {
  let memory: ReturnType<typeof createInMemoryDb>;
  let domainId: number;
  beforeEach(() => {
    memory = createInMemoryDb();
    runSqlMigrations(memory.sqlite);
    domainId = memory.db.insert(domains).values({ hostname: "example.com", port: 443 }).returning().all()[0]!.id;
    vi.stubEnv("ALERT_EMAIL_TO", "fallback@example.com");
  });
  afterEach(() => {
    memory.sqlite.close();
    vi.unstubAllEnvs();
    for (const name of ["email", "telegram", "webhook"] as ChannelName[]) resetChannelSender(name);
  });

  it("persists and validates language through POST, GET and PATCH", async () => {
    const app = createChannelsRouter(memory.db);
    for (const channel of ["email", "telegram"]) {
      const path = `/domains/${domainId}/channels`;
      const config = channel === "email" ? { to: "test@example.com" } : { botToken: "test-only", chatId: "123" };
      const created = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, config: { ...config, language: "fa" } }) });
      expect(created.status).toBe(201);
      const saved = await created.json() as { channel: { id: number } };
      const listed = await (await app.request(path)).json() as { channels: { channel: string; config: { language?: string } }[] };
      expect(listed.channels.find(c => c.channel === channel)?.config.language).toBe("fa");
      const patched = await app.request(`${path}/${saved.channel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...config, language: "en" } }) });
      expect(patched.status).toBe(200);
      expect((await patched.json() as { channel: { config: { language: string } } }).channel.config.language).toBe("en");
      for (const language of ["de", "", null, 1]) {
        const invalid = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, config: { ...config, language } }) });
        expect(invalid.status).toBe(400);
      }
    }
  });

  it.each(["en", "fa"])("dispatches each channel independently when email is %s and keeps deduplication", async language => {
    const inbox: Record<string, AlertContent[]> = { email: [], telegram: [], webhook: [] };
    for (const channel of ["email", "telegram", "webhook"] as ChannelName[]) {
      setChannelSender(channel, { channel, async send(content) { inbox[channel]!.push(content); return { id: "test" }; } });
      const config = channel === "email" ? { language }
        : channel === "telegram" ? { language: language === "fa" ? "en" : "fa", chatId: "123" }
        : { language: "fa", url: "https://example.com/hook" };
      memory.db.insert(alertChannels).values({ domainId, channel, enabled: true, config: JSON.stringify(config) }).run();
    }
    const check = memory.db.insert(checks).values({ domainId, valid: true, daysRemaining: 5 }).returning().all()[0]!;
    const input = { checkId: check.id, domainId, certDaysRemaining: 5, domainDaysRemaining: 0, db: memory.db };
    await processCheckAlert(input);
    expect(inbox.email).toHaveLength(2);
    expect(inbox.telegram).toHaveLength(2);
    expect(inbox.email[0]!.subject.includes("منقضی")).toBe(language === "fa");
    expect(inbox.telegram[0]!.subject.includes("منقضی")).toBe(language !== "fa");
    expect(inbox.webhook[0]!.subject).toContain("Expires in 7 days");
    expect(inbox.webhook[1]!.subject).toContain("EXPIRED");
    await processCheckAlert(input);
    expect(inbox.email).toHaveLength(2);
    expect(inbox.telegram).toHaveLength(2);
  });

  it("keeps synthetic global email English when no language is configured", async () => {
    const sent: AlertContent[] = [];
    setChannelSender("email", { channel: "email", async send(content) { sent.push(content); return { id: "test" }; } });
    const check = memory.db.insert(checks).values({ domainId, valid: true, daysRemaining: 5 }).returning().all()[0]!;
    await processCheckAlert({ checkId: check.id, domainId, certDaysRemaining: 5, domainDaysRemaining: null, db: memory.db });
    expect(sent[0]!.subject).toContain("Expires in 7 days");
  });
});
