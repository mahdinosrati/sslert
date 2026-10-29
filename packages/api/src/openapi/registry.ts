/**
 * OpenAPI registry + shared security scheme.
 *
 * Routes register their `describeRoute(...)` config against the shared
 * `openApiRegistry`; `index.ts` mounts `/api/openapi.json` and
 * `/api/docs` before auth middleware, so a caller does NOT need a
 * Bearer token to inspect the spec.
 */
import { extendZodWithOpenApi } from "@hono/zod-openapi";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Lets us tag Zod schemas with metadata (`.openapi(...)`).
extendZodWithOpenApi(z);

export const openApiRegistry = new OpenAPIRegistry();

// Security scheme: Bearer token. Documented in `components.securitySchemes`.
// Routes that require it list `security: [{ bearerAuth: [] }]`.
openApiRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description:
    "API token issued by `npm run token:create` (or " +
    "`tsx src/cli/tokens.ts create`). Pass as " +
    "`Authorization: Bearer ***`. Set AUTH_DISABLED=1 to disable auth " +
    "in dev (NOT for production).",
});

/**
 * Build the OpenAPI 3.1 document for the SSLert HTTP API.
 * Pulls everything registered against `openApiRegistry` and adds the
 * `info` and `servers` blocks.
 */
openApiRegistry.registerComponent("securitySchemes", "sessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "sslert_session",
  description: "Login session. Mutations require X-SSLert-Request: 1.",
});

for (const [method, path, summary] of [
  ["post", "/api/auth/login", "Login; requires X-SSLert-Request: 1"],
  ["get", "/api/auth/me", "Current user"],
  ["post", "/api/auth/password", "Change password"],
  ["post", "/api/auth/logout", "Sign out"],
  ["get", "/api/users", "List users (admin)"],
  ["post", "/api/users", "Create user (admin)"],
  ["patch", "/api/users/{id}", "Update user (admin)"],
  ["get", "/api/resources", "List assigned licenses/API expiry records"],
  ["post", "/api/resources", "Create license/API expiry record"],
  ["put", "/api/resources/{id}", "Edit assigned record"],
  ["delete", "/api/resources/{id}", "Delete record (admin)"],
  ["get", "/api/notifications/connections", "List permitted connections"],
  ["post", "/api/notifications/connections", "Create connection (admin)"],
  ["put", "/api/notifications/connections/{id}", "Update connection (admin)"],
  [
    "delete",
    "/api/notifications/connections/{id}",
    "Delete connection (admin)",
  ],
  [
    "post",
    "/api/notifications/connections/{id}/test",
    "Send test; 30 second cooldown",
  ],
  ["get", "/api/notifications/policies/{key}", "Read notification policy"],
  ["put", "/api/notifications/policies/{key}", "Save notification policy"],
  ["get", "/api/notifications/history", "Scoped delivery history"],
  ["get", "/api/settings", "Requested port and manual command"],
  ["put", "/api/settings/port", "Save requested port (admin)"],
] as const)
  openApiRegistry.registerPath({
    method,
    path,
    summary,
    tags: ["Bamdad 1.0.1"],
    description:
      "See docs/API-1.0.1.md for payloads and permissions. Session mutations require X-SSLert-Request: 1.",
    security: path.endsWith("/login")
      ? []
      : [{ sessionCookie: [] }, { bearerAuth: [] }],
    responses: {
      200: { description: "Success" },
      400: { description: "Validation failed" },
      401: { description: "Authentication required" },
      403: {
        description: "Insufficient permissions or password change required",
      },
    },
  });

export function buildOpenApiDocument(baseUrl: string) {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Bamdad Alert API",
      version: "1.0.2",
      description:
        "Self-hosted SSL/TLS certificate and domain expiry monitor. " +
        "All `/api/*` routes EXCEPT `/api/openapi.json`, `/api/docs`, " +
        "`/health/*`, and `/metrics` require a Bearer token (see " +
        "`securitySchemes.bearerAuth`).",
    },
    servers: [{ url: baseUrl, description: "This instance" }],
  });
}

// Re-export `z` so route files only need one import.
export { z };
