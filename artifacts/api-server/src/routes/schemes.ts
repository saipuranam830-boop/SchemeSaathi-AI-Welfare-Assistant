import { Router, type IRouter } from "express";
import {
  GetDashboardResponse,
  GetSchemeParams,
  GetSchemeResponse,
  ListSchemesQueryParams,
  ListSchemesResponse,
} from "@workspace/api-zod";
import { evaluateEligibility } from "../lib/eligibility";
import { getSignedInUser } from "../lib/auth";
import { getDatabase, serializeScheme } from "../lib/mongo";
import type { CitizenProfileRecord, SchemeRecord, UserRecord } from "../lib/models";
import { retrieveSchemes } from "../lib/rag";

const router: IRouter = Router();

function citizenProfile(user: UserRecord): Partial<CitizenProfileRecord> {
  return {
    fullName: user.fullName,
    email: user.email,
    mobile: user.mobile || null,
    ...(user.profile ?? {}),
  } as Partial<CitizenProfileRecord>;
}

router.get("/schemes", async (req, res): Promise<void> => {
  const parsed = ListSchemesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scheme search filters." });
    return;
  }
  try {
    const db = await getDatabase();
    const all = await db.collection<SchemeRecord>("schemes").find().toArray();
    const q = parsed.data.q?.trim().toLowerCase();
    const category = parsed.data.category?.trim().toLowerCase();
    const state = parsed.data.state?.trim().toLowerCase();
    const matches = all.filter((scheme) => {
      const text = [
        scheme.schemeName,
        scheme.description,
        scheme.category,
        scheme.benefit,
        scheme.government,
        ...(scheme.keywords ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!q || text.includes(q)) &&
        (!category || scheme.category.toLowerCase() === category) &&
        (!state || !scheme.state || scheme.state.toLowerCase() === state)
      );
    });
    res.json(ListSchemesResponse.parse(matches.map(serializeScheme)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Scheme search failed",
    );
    res.status(503).json({ error: "Scheme information is temporarily unavailable." });
  }
});

router.get("/schemes/:id", async (req, res): Promise<void> => {
  const parsed = GetSchemeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scheme identifier." });
    return;
  }
  try {
    const db = await getDatabase();
    const scheme = await db
      .collection<SchemeRecord>("schemes")
      .findOne({ id: parsed.data.id });
    if (!scheme) {
      res.status(404).json({ error: "Scheme not found." });
      return;
    }
    res.json(GetSchemeResponse.parse(serializeScheme(scheme)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Scheme detail lookup failed",
    );
    res.status(503).json({ error: "Scheme information is temporarily unavailable." });
  }
});

router.get("/dashboard", async (req, res): Promise<void> => {
  try {
    const db = await getDatabase();
    const schemes = await db.collection<SchemeRecord>("schemes").find().toArray();
    let user: UserRecord | null = null;
    try {
      user = await getSignedInUser(req);
    } catch {
      user = null;
    }
    const profile = user ? citizenProfile(user) : {};
    const context = [
      profile.occupation,
      profile.state,
      profile.category,
      profile.studentStatus ? "student" : "",
      profile.seniorCitizenStatus ? "senior citizen pension" : "",
      profile.disabilityStatus ? "disability" : "",
      profile.widowStatus ? "widow pension" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const recommendations = context
      ? retrieveSchemes(context, schemes, 4)
      : schemes.slice(0, 4);
    const results = recommendations.map((scheme) => evaluateEligibility(profile, scheme));
    const savedCount = user
      ? await db.collection("savedSchemes").countDocuments({ ownerId: user.id })
      : 0;
    const documentCount = user
      ? await db.collection("documents").countDocuments({ ownerId: user.id })
      : 0;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = schemes
      .filter((scheme) => scheme.deadline && scheme.deadline >= today)
      .map((scheme) => {
        const deadline = scheme.deadline as string;
        const daysRemaining = Math.ceil(
          (new Date(`${deadline}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
        );
        return {
          id: scheme.id,
          schemeName: scheme.schemeName,
          deadline,
          daysRemaining,
          status: "Verify on official source",
          dataStatus: scheme.dataStatus,
        };
      });
    res.json(
      GetDashboardResponse.parse({
        eligibleCount: results.filter(
          (result) =>
            result.status === "eligible" || result.status === "potentially_eligible",
        ).length,
        savedCount,
        documentCount,
        upcomingDeadlines: upcoming,
        recommendations: recommendations.map(serializeScheme),
      }),
    );
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Dashboard summary failed",
    );
    res.status(503).json({ error: "Dashboard information is temporarily unavailable." });
  }
});

export default router;