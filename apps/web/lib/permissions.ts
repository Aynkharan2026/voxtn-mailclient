"use server";

/**
 * lib/permissions.ts — Scope-lock seam for VoxMail RBAC.
 *
 * DESIGN INTENT (Group 6):
 *  - `canMutate()` is SERVER-ONLY. No client code can grant write access.
 *  - MCP tool scopes are enforced server-side: the UI calls server actions,
 *    which hold the voxmail.write token. The client never holds or escalates
 *    a write token.
 *  - Read-only mode is triggered by:
 *      a) VOXMAIL_READONLY=1 env var (deployment-level)
 *      b) voxmail_role=viewer cookie (per-request, set server-side by auth)
 *  - Full multi-user RBAC (roles table, session scoping, per-mailbox ACLs)
 *    is a post-auth-session fast-follow. This file is the designated seam.
 *
 * SECURITY NOTE: canMutate() / assertCanMutate() must ONLY be called from
 * server actions. They import `cookies` from `next/headers` — runtime
 * enforces server context. Client code cannot call this module.
 */

import { cookies } from "next/headers";

export type PermissionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Returns true when the current request is allowed to perform mutations
 * (archive, delete, move, mark-read, flag, label, send, reply-all, forward).
 *
 * Returns false when:
 *  - VOXMAIL_READONLY=1 env var is set, OR
 *  - The request carries a `voxmail_role=viewer` cookie.
 */
export async function canMutate(): Promise<boolean> {
  // Env-level read-only flag (deployment override)
  if (process.env.VOXMAIL_READONLY === "1") {
    return false;
  }

  // Per-request role cookie (set by auth layer; never settable from client JS
  // because HttpOnly cookies cannot be written by JavaScript)
  const cookieStore = await cookies();
  const role = cookieStore.get("voxmail_role")?.value;
  if (role === "viewer") {
    return false;
  }

  return true;
}

/**
 * Assert that the current request can perform mutations.
 * Returns a typed error result if not permitted — call sites return this
 * directly so TypeScript enforces the check.
 *
 * Usage in a server action:
 *   const guard = await assertCanMutate();
 *   if (!guard.ok) return guard;
 *   // ... proceed with mutation
 */
export async function assertCanMutate(): Promise<PermissionResult> {
  const allowed = await canMutate();
  if (!allowed) {
    return { ok: false, error: "read-only mode" };
  }
  return { ok: true };
}
