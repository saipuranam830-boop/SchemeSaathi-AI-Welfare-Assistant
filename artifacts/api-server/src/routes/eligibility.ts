import { Router, type IRouter } from "express";
import { CheckEligibilityBody, CheckEligibilityResponse } from "@workspace/api-zod";
import { evaluateEligibility } from "../lib/eligibility";
import { getDatabase, serializeScheme } from "../lib/mongo";
import type { SchemeRecord } from "../lib/models";

const router: IRouter = Router();

router.post("/eligibility/check", async (req, res): Promise<void> => {
  const parsed = CheckEligibilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the information and try again." });
    return;
  }
  try {
    const db = await getDatabase();
    const query = parsed.data.schemeId
      ? { id: parsed.data.schemeId }
      : {};
    const schemes = await db.collection<SchemeRecord>("schemes").find(query).toArray();
    const results = schemes.map((scheme) => {
      const evaluated = evaluateEligibility(parsed.data.profile, scheme);
      return { ...evaluated, scheme: serializeScheme(scheme) };
    });
    res.json(CheckEligibilityResponse.parse(results));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Eligibility check failed",
    );
    res.status(503).json({ error: "Eligibility information is temporarily unavailable." });
  }
});

export default router;