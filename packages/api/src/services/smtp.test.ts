import { createServer } from "node:net";
import { describe, it, expect } from "vitest";
import { getChannelSender } from "./channels.js";
describe("SMTP delivery", () => {
  it("delivers to an internal relay and refuses missing STARTTLS", async () => {
    const messages: string[] = [];
    const server = createServer((socket) => {
      socket.write("220 local test SMTP\r\n");
      let buffer = "",
        data = false,
        message = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        let end: number;
        while ((end = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data) {
            if (line === ".") {
              messages.push(message);
              data = false;
              socket.write("250 queued\r\n");
            } else message += line + "\n";
          } else if (line.startsWith("EHLO"))
            socket.write("250-local\r\n250 OK\r\n");
          else if (line === "DATA") {
            data = true;
            socket.write("354 go\r\n");
          } else if (line === "QUIT") {
            socket.end("221 bye\r\n");
          } else socket.write("250 OK\r\n");
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const config = {
      emailProvider: "smtp",
      smtpHost: "127.0.0.1",
      smtpPort: port,
      smtpSecurity: "none",
      smtpAuth: false,
      from: "sender@example.com",
      to: "recipient@example.com",
    };
    const content = {
      subject: "Local SMTP test",
      text: "Test body",
      hostname: "example.com",
      daysRemaining: 1,
      level: "test",
      source: "cert" as const,
    };
    try {
      const result = await getChannelSender("email").send(content, config, {});
      expect(result.error).toBeUndefined();
      expect(result.id).toBeTruthy();
      expect(messages[0]).toContain("Test body");
      const secured = await getChannelSender("email").send(
        content,
        { ...config, smtpSecurity: "starttls" },
        {},
      );
      expect(secured.error).toBeTruthy();
      expect(messages).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
