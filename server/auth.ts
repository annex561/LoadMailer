import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, or } from "drizzle-orm";

// ---- Role + allowlist config (env-driven, no secrets in code) -------------
// AUTH_ALLOWED_EMAILS = comma-separated emails permitted to sign in via Google
// AUTH_ROLE_MAP       = comma-separated email:role pairs; default role = dispatcher
//   e.g. "annex561@gmail.com:owner,julio@example.com:dispatcher"
// Role names match existing route guards (requireRole('admin'), etc.).
// "admin" = full access (you), "dispatcher" = ratecon/driver ops (Julio),
// "viewer" = read-only.
export type Role = "admin" | "dispatcher" | "viewer";

function parseAllowedEmails(): Set<string> {
  return new Set(
    (process.env.AUTH_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseRoleMap(): Map<string, Role> {
  const m = new Map<string, Role>();
  for (const pair of (process.env.AUTH_ROLE_MAP ?? "").split(",")) {
    const [email, role] = pair.split(":").map((s) => s?.trim().toLowerCase());
    if (!email || !role) continue;
    if (role === "admin" || role === "dispatcher" || role === "viewer") {
      m.set(email, role as Role);
    }
  }
  return m;
}

function isEmailAllowed(email?: string | null): boolean {
  if (!email) return false;
  const allowed = parseAllowedEmails();
  // Empty allowlist == open in dev only. Production REQUIRES the env var.
  if (allowed.size === 0) return process.env.NODE_ENV !== "production";
  return allowed.has(email.toLowerCase());
}

function roleForEmail(email: string): Role {
  return parseRoleMap().get(email.toLowerCase()) ?? "dispatcher";
}

const scryptAsync = promisify(scrypt);

// Hash a plain-text password
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

// Compare a plain-text password against a stored hash
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hashed, "hex");
  return timingSafeEqual(buf, storedBuf);
}

// Look up a user by username or email
async function findUser(usernameOrEmail: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(
      or(
        eq(users.username, usernameOrEmail),
        eq(users.email, usernameOrEmail)
      )
    );
  return user;
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week

  // Use Postgres session store when DATABASE_URL is available, otherwise fall back to memory
  let store: session.Store | undefined;
  if (process.env.DATABASE_URL) {
    try {
      const pgStore = connectPg(session);
      store = new pgStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
        ttl: sessionTtl,
        tableName: "sessions",
      });
    } catch (err) {
      console.warn("Session DB store failed to init, falling back to memory store:", err);
    }
  } else {
    console.warn("DATABASE_URL not set — using in-memory session store (sessions will not persist across restarts)");
  }

  return session({
    secret: process.env.SESSION_SECRET ?? "traqiq-dev-secret-change-in-production",
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "username", passwordField: "password" },
      async (usernameOrEmail, password, done) => {
        try {
          const user = await findUser(usernameOrEmail);
          if (!user) {
            return done(null, false, { message: "Invalid username or password" });
          }
          if (!user.password) {
            return done(null, false, { message: "Invalid username or password" });
          }
          const valid = await verifyPassword(password, user.password);
          if (!valid) {
            return done(null, false, { message: "Invalid username or password" });
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  // ---- Google OAuth strategy (only registered if creds present) ----
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleCallbackUrl =
    process.env.GOOGLE_CALLBACK_URL ?? "/api/auth/google/callback";

  if (googleClientId && googleClientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: googleCallbackUrl,
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: Profile,
          done: (err: any, user?: any, info?: any) => void,
        ) => {
          try {
            const email = (profile.emails?.[0]?.value ?? "").toLowerCase();
            if (!isEmailAllowed(email)) {
              console.warn(`[google-oauth] blocked sign-in for ${email || "(no email)"} — not in AUTH_ALLOWED_EMAILS`);
              return done(null, false, { message: "Email not authorized" });
            }

            // 1) Match by googleId
            let [user] = await db
              .select()
              .from(users)
              .where(eq(users.googleId, profile.id));

            // 2) Fall back to matching by email (link existing local account)
            if (!user && email) {
              [user] = await db.select().from(users).where(eq(users.email, email));
            }

            const firstName = profile.name?.givenName ?? null;
            const lastName = profile.name?.familyName ?? null;
            const profileImageUrl = profile.photos?.[0]?.value ?? null;

            if (user) {
              // Backfill googleId / profile if linking an existing email user
              const updates: Record<string, unknown> = { updatedAt: new Date() };
              if (!user.googleId) updates.googleId = profile.id;
              if (!user.firstName && firstName) updates.firstName = firstName;
              if (!user.lastName && lastName) updates.lastName = lastName;
              if (!user.profileImageUrl && profileImageUrl) {
                updates.profileImageUrl = profileImageUrl;
              }
              await db.update(users).set(updates).where(eq(users.id, user.id));
              // Re-read so role/google_id are in sync
              [user] = await db.select().from(users).where(eq(users.id, user.id));
            } else {
              // 3) Create new user with role from AUTH_ROLE_MAP
              const role = roleForEmail(email);
              user = await storage.upsertUser({
                email,
                username: email,
                googleId: profile.id,
                firstName,
                lastName,
                profileImageUrl,
                role,
              } as any);
            }

            return done(null, user);
          } catch (err) {
            return done(err);
          }
        },
      ),
    );
    console.log("🔐 Google OAuth strategy registered");
  } else {
    console.warn("⚠️ GOOGLE_CLIENT_ID/SECRET not set — Google sign-in disabled");
  }

  passport.serializeUser((user: any, cb) => cb(null, user.id));
  passport.deserializeUser(async (id: string, cb) => {
    try {
      const user = await storage.getUser(id);
      cb(null, user ?? false);
    } catch (err) {
      cb(err);
    }
  });

  // POST /api/login — accept JSON body { username, password }
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message ?? "Invalid credentials" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        const { password: _pw, ...safeUser } = user;
        return res.json({ ok: true, user: safeUser });
      });
    })(req, res, next);
  });

  // POST /api/register — create a new dispatcher account
  app.post("/api/register", async (req, res, next) => {
    try {
      const { username, email, password, firstName, lastName } = req.body as {
        username?: string;
        email?: string;
        password?: string;
        firstName?: string;
        lastName?: string;
      };

      if (!password || (!username && !email)) {
        return res.status(400).json({ message: "username/email and password are required" });
      }

      // Check for existing user
      const existing = await findUser(username ?? email ?? "");
      if (existing) {
        return res.status(409).json({ message: "User already exists" });
      }

      const hashed = await hashPassword(password);
      const newUser = await storage.upsertUser({
        username: username ?? null,
        email: email ?? null,
        password: hashed,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        role: "dispatcher",
      });

      req.login(newUser, (err) => {
        if (err) return next(err);
        const { password: _pw, ...safeUser } = newUser;
        return res.status(201).json({ ok: true, user: safeUser });
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/bootstrap-admin — one-time admin creation for first-deploy bring-up.
  //
  // Self-disabling: if any user with role="admin" already exists in the DB,
  // this endpoint returns 403 and refuses. There is no way to create a second
  // admin via this path, so leaving it in production is safe (it can't be used
  // to escalate privilege once setup is done).
  app.post("/api/bootstrap-admin", async (req, res, next) => {
    try {
      const { username, email, password, firstName, lastName } = req.body as {
        username?: string;
        email?: string;
        password?: string;
        firstName?: string;
        lastName?: string;
      };

      if (!password || (!username && !email)) {
        return res.status(400).json({ message: "username/email and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "password must be at least 8 characters" });
      }

      const [existingAdmin] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);
      if (existingAdmin) {
        return res.status(403).json({
          message: "An admin already exists. Bootstrap endpoint is disabled. Sign in normally.",
        });
      }

      const collision = await findUser(username ?? email ?? "");
      if (collision) {
        return res.status(409).json({ message: "User with that username or email already exists" });
      }

      const hashed = await hashPassword(password);
      const newAdmin = await storage.upsertUser({
        username: username ?? null,
        email: email ?? null,
        password: hashed,
        firstName: firstName ?? "Admin",
        lastName: lastName ?? "User",
        role: "admin",
      });

      console.log(`🔐 Bootstrap admin created: ${newAdmin.username ?? newAdmin.email} (id=${newAdmin.id})`);

      req.login(newAdmin, (err) => {
        if (err) return next(err);
        const { password: _pw, ...safeUser } = newAdmin;
        return res.status(201).json({ ok: true, user: safeUser });
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/auth/google — kick off OAuth flow
  app.get("/api/auth/google", (req, res, next) => {
    if (!googleClientId) {
      return res.status(503).json({ message: "Google sign-in not configured" });
    }
    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  });

  // GET /api/auth/google/callback — OAuth return URL
  app.get("/api/auth/google/callback", (req, res, next) => {
    if (!googleClientId) {
      return res.redirect("/auth?error=google_not_configured");
    }
    passport.authenticate("google", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        const reason = encodeURIComponent(info?.message ?? "google_failed");
        return res.redirect(`/auth?error=${reason}`);
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.redirect("/");
      });
    })(req, res, next);
  });

  // GET /api/auth/config — frontend uses this to know which buttons to show
  app.get("/api/auth/config", (_req, res) => {
    res.json({
      google: !!googleClientId,
      local: true,
    });
  });

  // GET /api/logout
  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });

  // POST /api/logout (for frontend fetch calls)
  app.post("/api/logout", (req, res) => {
    req.logout(() => {
      res.json({ ok: true });
    });
  });
}

// Middleware: require authenticated session
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};

// Middleware factory: require authenticated session AND a role in the allowed list
export function requireRole(...allowed: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const role = (req.user as any)?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}
