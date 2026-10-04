import { Router, type IRouter } from "express";
import {
  ListDeadlinesResponse,
  UpdateNotificationPreferenceBody,
  UpdateNotificationPreferenceResponse,
} from "@workspace/api-zod";
import { getSignedInUser } from "../lib/auth";
import { getDatabase } from "../lib/mongo";
import type { SchemeRecord, UserRecord } from "../lib/models";

const router: IRouter = Router();

router.get("/deadlines", async (req, res): Promise<void> => {
  try {
    const db = await getDatabase();
    const schemes = await db.collection<SchemeRecord>("schemes").find().toArray();
    const today = new Date().toISOString().slice(0, 10);
    const deadlines = schemes
      .filter((scheme) => scheme.deadline && scheme.deadline >= today)
      .map((scheme) => {
        const deadline = scheme.deadline as string;
        return {
          id: scheme.id,
          schemeName: scheme.schemeName,
          deadline,
          daysRemaining: Math.ceil(
            (new Date(`${deadline}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
          ),
          status: "Verify on official source",
          dataStatus: scheme.dataStatus,
        };
      });
    res.json(ListDeadlinesResponse.parse(deadlines));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Deadline list failed",
    );
    res.status(503).json({ error: "Deadline information is temporarily unavailable." });
  }
});

router.put("/deadlines/notifications", async (req, res): Promise<void> => {
  const parsed = UpdateNotificationPreferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose whether deadline reminders are enabled." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to update your reminder preference." });
      return;
    }
    const db = await getDatabase();
    await db.collection<UserRecord>("users").updateOne(
      { id: user.id },
      { $set: { notificationsEnabled: parsed.data.enabled } },
    );
    res.json(UpdateNotificationPreferenceResponse.parse({ enabled: parsed.data.enabled }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Reminder preference update failed",
    );
    res.status(503).json({ error: "Reminder preference could not be saved." });
  }
});

export default router;