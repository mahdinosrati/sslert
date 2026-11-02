import { Client, type Entry } from "ldapts";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { appSettings, users } from "../db/schema.js";
import { openConfig, sealConfig } from "./notification-secrets.js";
import { revokeUserAccess } from "./users.js";
export const ldapSchema = z
  .object({
    enabled: z.boolean(),
    host: z
      .string()
      .trim()
      .max(253)
      .regex(/^[a-zA-Z0-9.-]*$/),
    port: z.number().int().min(1).max(65535),
    security: z.enum(["ldaps", "starttls", "ldap"]),
    adminOnly: z.boolean().default(false),
    baseDn: z.string().trim().max(2048),
    bindDn: z.string().trim().max(2048),
    bindPassword: z.string().max(4096).optional(),
    userAttribute: z.enum(["sAMAccountName", "userPrincipalName"]),
    userGroup: z.string().trim().max(2048),
    adminGroup: z.string().trim().max(2048),
    caPem: z.string().max(100000),
  })
  .strict();
export type LdapSettings = z.infer<typeof ldapSchema>;
export const ldapDefaults: LdapSettings = {
  enabled: false,
  adminOnly: false,
  host: "",
  port: 636,
  security: "ldaps",
  baseDn: "",
  bindDn: "",
  userAttribute: "sAMAccountName",
  userGroup: "",
  adminGroup: "",
  caPem: "",
};
export const ldapRaw = (db: DB) =>
  db.select().from(appSettings).where(eq(appSettings.key, "ldap")).get()?.value;
export function readLdap(db: DB): LdapSettings {
  return { ...ldapDefaults, ...JSON.parse(ldapRaw(db) || "{}") };
}
export function publicLdap(db: DB) {
  const { bindPassword, ...settings } = readLdap(db);
  return { ...settings, bindPasswordSet: !!bindPassword };
}
export function completeLdap(settings: LdapSettings) {
  return !!(
    settings.host &&
    settings.baseDn &&
    settings.bindDn &&
    settings.bindPassword &&
    (settings.adminOnly ? settings.adminGroup : (settings.userGroup || settings.adminGroup))
  );
}
export function escapeLdap(value: string) {
  return value.replace(
    /[\\*()\0]/g,
    (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"),
  );
}
function plain(settings: LdapSettings) {
  return {
    ...settings,
    bindPassword: openConfig({ ldapBindPassword: settings.bindPassword })
      .ldapBindPassword as string | undefined,
  };
}
function scalar(entry: Entry, name: string) {
  const value =
    entry[
      Object.keys(entry).find(
        (key) => key.toLowerCase() === name.toLowerCase(),
      ) || name
    ];
  return Array.isArray(value) ? value[0] : value;
}
function allowedAccount(entry: Entry) {
  const flags = Number(scalar(entry, "userAccountControl"));
  if (!Number.isFinite(flags) || (flags & 2) !== 0) return false;
  const computed = Number(
    scalar(entry, "msDS-User-Account-Control-Computed") || 0,
  );
  if (computed & (16 | 8388608)) return false;
  const expires = String(scalar(entry, "accountExpires") || "0");
  try {
    const n = BigInt(expires);
    if (
      n !== 0n &&
      n !== 9223372036854775807n &&
      n / 10000n - 11644473600000n <= BigInt(Date.now())
    )
      return false;
  } catch {
    return false;
  }
  return true;
}
export async function queryDirectory(
  settings: LdapSettings,
  identity?: { username?: string; guid?: string; password?: string },
) {
  if (!completeLdap(settings))
    throw Error("Incomplete LDAP settings");
  const tls = {
    minVersion: "TLSv1.2" as const,
    rejectUnauthorized: true,
    ...(settings.caPem ? { ca: settings.caPem } : {}),
  };
  const client = new Client({
    url: `${settings.security === "ldaps" ? "ldaps" : "ldap"}://${settings.host}:${settings.port}`,
    timeout: 8000,
    connectTimeout: 8000,
    ...(settings.security === "ldaps" ? { tlsOptions: tls } : {}),
  });
  try {
    if (settings.security === "starttls") await client.startTLS(tls);
    await client.bind(settings.bindDn, settings.bindPassword!);
    if (!identity) {
      await client.search(settings.baseDn, {
        scope: "base",
        filter: "(objectClass=*)",
        attributes: ["dn"],
        sizeLimit: 1,
        timeLimit: 5,
      });
      return null;
    }
    if (identity.password !== undefined && !identity.password.length)
      throw Error("Empty password");
    if (identity.guid && !/^[a-f0-9]{32}$/.test(identity.guid))
      throw Error("Invalid identity");
    const match = identity.guid
      ? "objectGUID=" +
        identity.guid
          .match(/../g)!
          .map((x) => "\\" + x)
          .join("")
      : settings.userAttribute + "=" + escapeLdap(identity.username || "");
    const result = await client.search(settings.baseDn, {
      scope: "sub",
      filter: `(&(objectCategory=person)(objectClass=user)(${match})(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`,
      attributes: [
        "sAMAccountName",
        "objectGUID",
        "userAccountControl",
        "accountExpires",
        "msDS-User-Account-Control-Computed",
      ],
      explicitBufferAttributes: ["objectGUID"],
      sizeLimit: 2,
      timeLimit: 5,
    });
    if (result.searchEntries.length !== 1)
      throw Error("User not found or ambiguous");
    const entry = result.searchEntries[0],
      guid = scalar(entry, "objectGUID"),
      sam = String(scalar(entry, "sAMAccountName") || "");
    if (
      !Buffer.isBuffer(guid) ||
      guid.length !== 16 ||
      !sam ||
      !allowedAccount(entry)
    )
      throw Error("Account unavailable");
    async function member(group: string) {
      if (!group) return false;
      const result = await client.search(entry.dn, {
        scope: "base",
        filter: `(memberOf:1.2.840.113556.1.4.1941:=${escapeLdap(group)})`,
        attributes: ["dn"],
        sizeLimit: 1,
        timeLimit: 5,
      });
      return result.searchEntries.length === 1;
    }
    const admin = await member(settings.adminGroup);
    if (!admin && (settings.adminOnly || !(await member(settings.userGroup))))
      throw Error("Group not allowed");
    if (identity.password !== undefined)
      await client.bind(entry.dn, identity.password);
    return {
      guid: guid.toString("hex"),
      username: "ad:" + sam.toLowerCase(),
      role: admin ? ("admin" as const) : ("user" as const),
    };
  } finally {
    await client.unbind().catch(() => {});
  }
}
export async function authenticateLdap(
  db: DB,
  username: string,
  password: string,
) {
  const revision = ldapRaw(db),
    settings = readLdap(db);
  if (!settings.enabled || !password)
    throw Error("Directory login unavailable");
  const identity = await queryDirectory(plain(settings), {
    username,
    password,
  });
  if (!identity || ldapRaw(db) !== revision)
    throw Error("Directory configuration changed");
  return db.transaction((tx) => {
    const old = tx
      .select()
      .from(users)
      .where(eq(users.ldapId, identity.guid))
      .get();
    if (old && !old.enabled) throw Error("Account disabled");
    const update = {
      username: identity.username,
      role: identity.role,
      ldapCheckedAt: new Date().toISOString(),
    };
    if (old) {
      if (old.authSource !== "ldap") throw Error("Identity conflict");
      if (old.role !== identity.role) revokeUserAccess(tx, old.id);
      return tx
        .update(users)
        .set(update)
        .where(eq(users.id, old.id))
        .returning()
        .get()!;
    }
    return tx
      .insert(users)
      .values({
        ...update,
        authSource: "ldap",
        ldapId: identity.guid,
        passwordHash: "!directory-account",
        mustChangePassword: false,
        canCreate: false,
        canEdit: false,
        canTest: false,
      })
      .returning()
      .get()!;
  });
}
export async function refreshLdapUser(db: DB, user: typeof users.$inferSelect) {
  const revision = ldapRaw(db),
    settings = readLdap(db);
  if (!settings.enabled) {
    revokeUserAccess(db, user.id);
    return null;
  }
  if (
    user.ldapCheckedAt &&
    Date.now() - Date.parse(user.ldapCheckedAt) < 300000
  )
    return user;
  try {
    const identity = await queryDirectory(plain(settings), {
      guid: user.ldapId || "",
    });
    if (!identity || identity.guid !== user.ldapId || ldapRaw(db) !== revision)
      throw Error("Identity unavailable");
    const current = db.select().from(users).where(eq(users.id, user.id)).get();
    if (!current?.enabled) throw Error("Account disabled");
    if (identity.role !== current.role) {
      db.update(users)
        .set({ role: identity.role, ldapCheckedAt: null })
        .where(eq(users.id, user.id))
        .run();
      revokeUserAccess(db, user.id);
      return null;
    }
    return db
      .update(users)
      .set({ ldapCheckedAt: new Date().toISOString() })
      .where(eq(users.id, user.id))
      .returning()
      .get()!;
  } catch {
    revokeUserAccess(db, user.id);
    return null;
  }
}
export function mergeLdap(db: DB, input: LdapSettings) {
  const old = readLdap(db);
  try {
    return {
      ...input,
      bindPassword:
        input.bindPassword === undefined
          ? plain(old).bindPassword
          : input.bindPassword,
    };
  } catch (e) {
    if (!input.enabled) return { ...input, bindPassword: undefined };
    throw e;
  }
}
export function saveLdap(db: DB, settings: LdapSettings) {
  const encrypted = sealConfig({ ldapBindPassword: settings.bindPassword });
  db.transaction((tx) => {
    tx.insert(appSettings)
      .values({
        key: "ldap",
        value: JSON.stringify({
          ...settings,
          bindPassword: encrypted.ldapBindPassword,
        }),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: JSON.stringify({
            ...settings,
            bindPassword: encrypted.ldapBindPassword,
          }),
        },
      })
      .run();
    for (const u of tx
      .select()
      .from(users)
      .where(eq(users.authSource, "ldap"))
      .all())
      revokeUserAccess(tx, u.id);
    tx.update(users)
      .set({ ldapCheckedAt: null })
      .where(eq(users.authSource, "ldap"))
      .run();
  });
}
