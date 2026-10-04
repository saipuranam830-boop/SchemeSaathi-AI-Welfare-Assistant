import { Router, type IRouter } from "express";
import {
  ListSavedSchemesResponse,
  RemoveSavedSchemeParams,
  RemoveSavedSchemeResponse,
  SaveSchemeParams,
  SaveSchemeResponse,
} from "@workspace/api-zod";
import { getSignedInUser } from "../lib/auth";
import { getDatabase, serializeScheme } from "../lib/mongo";
import type { SchemeRecord, UserRecord } from "../lib/models";

const router: IRouter = Router();

router.get("/saved", async (req, res): Promise<void> => {
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to view saved schemes." });
      return;
    }
    const db = await getDatabase();
    const saved = await db
      .collection("savedSchemes")
      .find({ ownerId: user.id })
      .toArray();
    const ids = saved.map((record) => record.schemeId as string);
    const schemes =
      ids.length === 0
        ? []
        : await db
            .collection<SchemeRecord>("schemes")
            .find({ id: { $in: ids } })
            .toArray();
    res.json(ListSavedSchemesResponse.parse(schemes.map(serializeScheme)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Saved schemes could not be loaded",
    );
    res.status(503).json({ error: "Saved schemes are temporarily unavailable." });
  }
});

router.post("/saved/:schemeId", async (req, res): Promise<void> => {
  const parsed = SaveSchemeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scheme identifier." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to save schemes." });
      return;
    }
    const db = await getDatabase();
    const scheme = await db
      .collection<SchemeRecord>("schemes")
      .findOne({ id: parsed.data.schemeId });
    if (!scheme) {
      res.status(404).json({ error: "Scheme not found." });
      return;
    }
    await db.collection("savedSchemes").updateOne(
      { ownerId: user.id, schemeId: parsed.data.schemeId },
      { $setOnInsert: { ownerId: user.id, schemeId: parsed.data.schemeId, savedAt: new Date() } },
      { upsert: true },
    );
    res.json(SaveSchemeResponse.parse({ message: "Scheme saved." }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Scheme could not be saved",
    );
    res.status(503).json({ error: "Scheme could not be saved. Please try again." });
  }
});

router.delete("/saved/:schemeId", async (req, res): Promise<void> => {
  const parsed = RemoveSavedSchemeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scheme identifier." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to manage saved schemes." });
      return;
    }
    const db = await getDatabase();
    await db.collection("savedSchemes").deleteOne({
      ownerId: user.id,
      schemeId: parsed.data.schemeId,
    });
    res.json(RemoveSavedSchemeResponse.parse({ message: "Scheme removed." }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Saved scheme could not be removed",
    );
    res.status(503).json({ error: "Saved scheme could not be removed." });
  }
});

export default router;