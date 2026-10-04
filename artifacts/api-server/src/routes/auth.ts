import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  BootstrapAdminBody,
  BootstrapAdminResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import { MongoServerError } from "mongodb";
import {
  clearSession,
  getSignedInUser,
  hashPassword,
  issueSession,
  toPublicUser,
  verifyPassword,
} from "../lib/auth";
import { getDatabase } from "../lib/mongo";
import type { UserRecord } from "../lib/models";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();

function canAttempt(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!canAttempt(`register:${ip}`)) {
    res.status(429).json({ error: "Too many attempts. Please wait and try again." });
    return;
  }
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the registration details." });
    return;
  }
  const fullName = parsed.data.fullName.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const mobile = parsed.data.mobile.trim();
  if (!/^[+]?[\d\s()-]{10,16}$/.test(mobile)) {
    res.status(400).json({ error: "Enter a valid mobile number." });
    return;
  }

  try {
    const db = await getDatabase();
    const user: UserRecord = {
      id: randomUUID(),
      fullName,
      email,
      mobile,
      passwordHash: await hashPassword(parsed.data.password),
      role: "citizen",
      createdAt: new Date(),
    };
    await db.collection<UserRecord>("users").insertOne(user);
    issueSession(res, user.id);
    res.status(201).json(RegisterResponse.parse({ user: toPublicUser(user) }));
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Account registration failed",
    );
    res.status(503).json({ error: "Account service is temporarily unavailable." });
  }
});

router.post("/auth/admin-setup", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!canAttempt(`admin-setup:${ip}`)) {
    res.status(429).json({ error: "Too many attempts. Please wait and try again." });
    return;
  }
  const parsed = BootstrapAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the administrator setup secret." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in before setting up an administrator account." });
      return;
    }
    if (user.role === "admin") {
      res.json(BootstrapAdminResponse.parse({ user: toPublicUser(user) }));
      return;
    }
    const expectedSecret = process.env.ADMIN_SETUP_SECRET;
    if (!expectedSecret) {
      res.status(503).json({
        error: "Administrator setup is not configured. Ask the workspace owner to add ADMIN_SETUP_SECRET.",
      });
      return;
    }
    const expected = Buffer.from(expectedSecret);
    const supplied = Buffer.from(parsed.data.setupSecret);
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      res.status(403).json({ error: "The administrator setup secret is incorrect." });
      return;
    }

    const db = await getDatabase();
    const admins = await db.collection<UserRecord>("users").countDocuments({ role: "admin" });
    if (admins > 0) {
      res.status(409).json({ error: "An administrator account already exists." });
      return;
    }

    const setupCollection = db.collection("adminSetup");
    try {
      await setupCollection.updateOne(
        { key: "first-admin", ownerId: user.id },
        {
          $setOnInsert: {
            key: "first-admin",
            ownerId: user.id,
            status: "pending",
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        res.status(409).json({ error: "Administrator setup has already been claimed." });
        return;
      }
      throw error;
    }
    const claim = await setupCollection.findOne({ key: "first-admin" });
    if (claim?.ownerId !== user.id) {
      res.status(409).json({ error: "Administrator setup has already been claimed." });
      return;
    }

    await db.collection<UserRecord>("users").updateOne(
      { id: user.id },
      { $set: { role: "admin" } },
    );
    await setupCollection.updateOne(
      { key: "first-admin", ownerId: user.id },
      { $set: { status: "complete", completedAt: new Date() } },
    );
    res.json(
      BootstrapAdminResponse.parse({
        user: { ...toPublicUser(user), role: "admin" },
      }),
    );
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Administrator setup failed",
    );
    res.status(503).json({ error: "Administrator setup is temporarily unavailable." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!canAttempt(`login:${ip}`)) {
    res.status(429).json({ error: "Too many attempts. Please wait and try again." });
    return;
  }
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your email and password." });
    return;
  }

  try {
    const db = await getDatabase();
    const user = await db.collection<UserRecord>("users").findOne({
      email: parsed.data.email.trim().toLowerCase(),
    });
    const valid = user
      ? await verifyPassword(parsed.data.password, user.passwordHash)
      : false;
    if (!user || !valid) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    attempts.delete(`login:${ip}`);
    issueSession(res, user.id);
    res.json(LoginResponse.parse({ user: toPublicUser(user) }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Account sign-in failed",
    );
    res.status(503).json({ error: "Account service is temporarily unavailable." });
  }
});

router.post("/auth/logout", (_req, res): void => {
  clearSession(res);
  res.json(LogoutResponse.parse({ message: "Signed out." }));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    res.json(GetCurrentUserResponse.parse({ user: toPublicUser(user) }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Session lookup failed",
    );
    res.status(503).json({ error: "Account service is temporarily unavailable." });
  }
});

export default router;