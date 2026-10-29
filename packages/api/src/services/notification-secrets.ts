import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDatabasePath } from "../db/index.js";
const fields = ["smtpPassword", "resendApiKey"];
function key(create = false) {
  const path = join(dirname(getDatabasePath()), "notification.key");
  mkdirSync(dirname(path), { recursive: true });
  if (create)
    try {
      writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  const value = readFileSync(path);
  if (value.length !== 32) throw Error("Invalid notification encryption key");
  return value;
}
export function sealConfig(config: Record<string, unknown>) {
  const result = { ...config };
  for (const field of fields)
    if (typeof result[field] === "string" && result[field]) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key(true), iv);
      const encrypted = Buffer.concat([
        cipher.update(result[field] as string, "utf8"),
        cipher.final(),
      ]);
      result[field] =
        "enc:v1:" +
        Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
    }
  return result;
}
export function openConfig(config: Record<string, any>) {
  const result = { ...config };
  for (const field of fields)
    if (
      typeof result[field] === "string" &&
      result[field].startsWith("enc:v1:")
    ) {
      const bytes = Buffer.from(result[field].slice(7), "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key(),
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      result[field] = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    }
  return result;
}
export function publicConfig(config: Record<string, any>) {
  const result = { ...config };
  for (const field of fields) {
    result[field + "Set"] = !!result[field];
    delete result[field];
  }
  return result;
}
