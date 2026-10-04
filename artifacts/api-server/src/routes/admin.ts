import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateSchemeBody,
  CreateSchemeResponse,
  DeleteSchemeParams,
  DeleteSchemeResponse,
  GetAdminStatsResponse,
  UpdateSchemeBody,
  UpdateSchemeParams,
  UpdateSchemeResponse,
} from "@workspace/api-zod";
import { getSignedInUser } from "../lib/auth";
import { getDatabase, serializeScheme } from "../lib/mongo";
import type { SchemeRecord } from "../lib/models";

const router: IRouter = Router();

async function requireAdmin(req: Parameters<typeof getSignedInUser>[0]) {
  const user = await getSignedInUser(req);
  return user?.role === "admin" ? user : null;
}

type SchemeInputRecord = Omit<
  Partial<SchemeRecord>,
  "deadline" | "sourceLastUpdated"
> & {
  deadline?: Date | string | null;
  sourceLastUpdated?: Date | string | null;
};

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function schemeRecord(input: SchemeInputRecord, id: string): SchemeRecord {
  return {
    id,
    schemeName: input.schemeName ?? "Untitled scheme",
    government: input.government ?? "Government",
    state: input.state ?? null,
    category: input.category ?? "Other",
    description: input.description ?? "",
    benefit: input.benefit ?? "",
    eligibilitySummary: input.eligibilitySummary ?? "",
    ageMin: input.ageMin ?? null,
    ageMax: input.ageMax ?? null,
    gender: input.gender ?? null,
    occupation: input.occupation ?? null,
    incomeLimit: input.incomeLimit ?? null,
    categoryRequirement: input.categoryRequirement ?? null,
    landRequirement: input.landRequirement ?? null,
    documentsRequired: input.documentsRequired ?? [],
    applicationSteps: input.applicationSteps ?? [],
    applicationUrl: input.applicationUrl ?? null,
    deadline: toIsoDate(input.deadline)?.slice(0, 10) ?? null,
    status: input.status ?? "Information only",
    sourceUrl: input.sourceUrl ?? null,
    sourceName: input.sourceName ?? null,
    sourceLastUpdated: toIsoDate(input.sourceLastUpdated),
    dataStatus: input.dataStatus ?? "demo_unverified",
    keywords: input.keywords ?? [],
  };
}

router.get("/admin/stats", async (req, res): Promise<void> => {
  try {
    const user = await requireAdmin(req);
    if (!user) {
      res.status(403).json({ error: "An administrator account is required." });
      return;
    }
    const db = await getDatabase();
    const today = new Date().toISOString().slice(0, 10);
    const [totalUsers, totalSchemes, totalDocuments, upcomingDeadlines, aiQueries] =
      await Promise.all([
        db.collection("users").countDocuments(),
        db.collection("schemes").countDocuments(),
        db.collection("documents").countDocuments(),
        db.collection<SchemeRecord>("schemes").countDocuments({
          deadline: { $gte: today },
        }),
        db.collection("aiQueries").countDocuments(),
      ]);
    res.json(
      GetAdminStatsResponse.parse({
        totalUsers,
        totalSchemes,
        totalDocuments,
        upcomingDeadlines,
        aiQueries,
      }),
    );
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Admin statistics lookup failed",
    );
    res.status(503).json({ error: "Admin statistics are temporarily unavailable." });
  }
});

router.post("/admin/schemes", async (req, res): Promise<void> => {
  const parsed = CreateSchemeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the scheme details." });
    return;
  }
  try {
    const user = await requireAdmin(req);
    if (!user) {
      res.status(403).json({ error: "An administrator account is required." });
      return;
    }
    const db = await getDatabase();
    const input = schemeRecord(parsed.data, randomUUID());
    const record = { ...input, createdAt: new Date(), updatedAt: new Date() };
    await db.collection<SchemeRecord>("schemes").insertOne(record);
    res.status(201).json(CreateSchemeResponse.parse(serializeScheme(record)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Scheme creation failed",
    );
    res.status(503).json({ error: "Scheme could not be added." });
  }
});

router.put("/admin/schemes/:id", async (req, res): Promise<void> => {
  const params = UpdateSchemeParams.safeParse(req.params);
  const parsed = UpdateSchemeBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Please check the scheme details." });
    return;
  }
  try {
    const user = await requireAdmin(req);
    if (!user) {
      res.status(403).json({ error: "An administrator account is required." });
      return;
    }
    const db = await getDatabase();
    const updated = schemeRecord(parsed.data, params.data.id);
    const result = await db.collection<SchemeRecord>("schemes").findOneAndUpdate(
      { id: params.data.id },
      { $set: { ...updated, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) {
      res.status(404).json({ error: "Scheme not found." });
      return;
    }
    res.json(UpdateSchemeResponse.parse(serializeScheme(result)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Scheme update failed",
    );
    res.status(503).json({ error: "Scheme could not be updated." });
  }
});

router.delete("/admin/schemes/:id", async (req, res): Promise<void> => {
  const parsed = DeleteSchemeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scheme identifier." });
    return;
  }
  try {
    const user = await requireAdmin(req);
    if (!user) {
      res.status(403).json({ error: "An administrator account is required." });
      return;
    }
    const db = await getDatabase();
    const result = await db.collection<SchemeRecord>("schemes").deleteOne({
      id: parsed.data.id,
    });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Scheme not found." });
      return;
    }
    await db.collection("savedSchemes").deleteMany({ schemeId: parsed.data.id });
    res.json(DeleteSchemeResponse.parse({ message: "Scheme deleted." }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Scheme deletion failed",
    );
    res.status(503).json({ error: "Scheme could not be deleted." });
  }
});

export default router;