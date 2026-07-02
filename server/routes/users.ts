import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireRole, hashPassword } from "../auth";

const ALLOWED_ROLES = ["admin", "dispatcher", "finance"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function isAllowedRole(value: unknown): value is AllowedRole {
  return typeof value === "string" && (ALLOWED_ROLES as readonly string[]).includes(value);
}

function sanitize(u: any) {
  if (!u) return u;
  const { password: _pw, ...rest } = u;
  return rest;
}

async function countAdmins(): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  return rows.length;
}

function requireAdminOrApiKey(req: Request, res: Response, next: NextFunction) {
  if ((req as any).isAuthenticated?.() && (req as any).user?.role === "admin") return next();
  const key = process.env.ADMIN_API_KEY;
  if (key && key !== "replace-with-random-string" && req.headers["x-admin-api-key"] === key) return next();
  res.status(401).json({ message: "Unauthorized" });
}

export function registerUserRoutes(app: Express) {
  // List staff users — admin only
  app.get("/api/users", requireAdminOrApiKey, async (_req, res) => {
    try {
      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users);
      res.json(rows);
    } catch (err: any) {
      console.error("GET /api/users failed:", err);
      res.status(500).json({ message: "Failed to list users" });
    }
  });

  // Create a staff user — admin only
  app.post("/api/users", requireAdminOrApiKey, async (req, res) => {
    try {
      const { username, email, password, firstName, lastName, role } = req.body ?? {};

      if (!password || (!username && !email)) {
        return res.status(400).json({ message: "username/email and password are required" });
      }
      if (!isAllowedRole(role)) {
        return res.status(400).json({ message: `role must be one of ${ALLOWED_ROLES.join(", ")}` });
      }

      // Check for collisions
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(
          username
            ? eq(users.username, username)
            : eq(users.email, email)
        );
      if (existing.length > 0) {
        return res.status(409).json({ message: "User with that username or email already exists" });
      }

      const hashed = await hashPassword(password);
      const [created] = await db
        .insert(users)
        .values({
          username: username ?? null,
          email: email ?? null,
          password: hashed,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          role,
        })
        .returning();

      res.status(201).json(sanitize(created));
    } catch (err: any) {
      console.error("POST /api/users failed:", err);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update an existing user — admin only
  app.patch("/api/users/:id", requireAdminOrApiKey, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { firstName, lastName, email, role, password } = req.body ?? {};

      const [target] = await db.select().from(users).where(eq(users.id, id));
      if (!target) return res.status(404).json({ message: "User not found" });

      const updates: any = { updatedAt: new Date() };
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (email !== undefined) updates.email = email;
      if (password) updates.password = await hashPassword(password);

      if (role !== undefined) {
        if (!isAllowedRole(role)) {
          return res.status(400).json({ message: `role must be one of ${ALLOWED_ROLES.join(", ")}` });
        }
        // Prevent demoting the last remaining admin
        if (target.role === "admin" && role !== "admin") {
          const adminCount = await countAdmins();
          if (adminCount <= 1) {
            return res.status(400).json({ message: "Cannot demote the last remaining admin" });
          }
        }
        updates.role = role;
      }

      const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
      res.json(sanitize(updated));
    } catch (err: any) {
      console.error("PATCH /api/users/:id failed:", err);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Delete a user — admin only
  app.delete("/api/users/:id", requireAdminOrApiKey, async (req: any, res) => {
    try {
      const { id } = req.params;
      const selfId = req.user?.id;
      if (id === selfId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const [target] = await db.select().from(users).where(eq(users.id, id));
      if (!target) return res.status(404).json({ message: "User not found" });

      if (target.role === "admin") {
        const adminCount = await countAdmins();
        if (adminCount <= 1) {
          return res.status(400).json({ message: "Cannot delete the last remaining admin" });
        }
      }

      await db.delete(users).where(eq(users.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("DELETE /api/users/:id failed:", err);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

}
