import { Router, type IRouter } from "express";
import { GetProfileResponse, UpdateProfileBody, UpdateProfileResponse } from "@workspace/api-zod";
import { getSignedInUser } from "../lib/auth";
import { getDatabase } from "../lib/mongo";
import type { CitizenProfileRecord, UserRecord } from "../lib/models";

const router: IRouter = Router();
const profileFields = [
  "age",
  "gender",
  "state",
  "district",
  "mandal",
  "village",
  "annualIncome",
  "occupation",
  "landAcres",
  "category",
] as const;

function buildProfile(user: UserRecord): CitizenProfileRecord {
  const saved = user.profile ?? {};
  const completed = profileFields.filter((key) => {
    const value = saved[key];
    return value !== null && value !== undefined && value !== "";
  }).length;
  return {
    fullName: user.fullName,
    email: user.email,
    mobile:
      typeof saved.mobile === "string"
        ? saved.mobile
        : user.mobile || null,
    age: typeof saved.age === "number" ? saved.age : null,
    gender: typeof saved.gender === "string" ? saved.gender : null,
    state: typeof saved.state === "string" ? saved.state : null,
    district: typeof saved.district === "string" ? saved.district : null,
    mandal: typeof saved.mandal === "string" ? saved.mandal : null,
    village: typeof saved.village === "string" ? saved.village : null,
    annualIncome:
      typeof saved.annualIncome === "number" ? saved.annualIncome : null,
    occupation: typeof saved.occupation === "string" ? saved.occupation : null,
    landAcres: typeof saved.landAcres === "number" ? saved.landAcres : null,
    category: typeof saved.category === "string" ? saved.category : null,
    studentStatus: saved.studentStatus === true,
    disabilityStatus: saved.disabilityStatus === true,
    seniorCitizenStatus: saved.seniorCitizenStatus === true,
    widowStatus: saved.widowStatus === true,
    completionPercent: Math.round((completed / profileFields.length) * 100),
  };
}

router.get("/profile", async (req, res): Promise<void> => {
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to view your profile." });
      return;
    }
    res.json(GetProfileResponse.parse(buildProfile(user)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Profile lookup failed",
    );
    res.status(503).json({ error: "Profile information is temporarily unavailable." });
  }
});

router.put("/profile", async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the profile fields." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to update your profile." });
      return;
    }
    const db = await getDatabase();
    const existing = buildProfile(user);
    const next = {
      ...existing,
      ...parsed.data,
      fullName: parsed.data.fullName?.trim() || user.fullName,
      email: user.email,
    };
    await db.collection<UserRecord>("users").updateOne(
      { id: user.id },
      {
        $set: {
          fullName: next.fullName,
          mobile: next.mobile ?? "",
          profile: next,
          updatedAt: new Date(),
        },
      },
    );
    const updated = { ...user, fullName: next.fullName, profile: next };
    res.json(UpdateProfileResponse.parse(buildProfile(updated)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Profile update failed",
    );
    res.status(503).json({ error: "Profile could not be saved. Please try again." });
  }
});

export default router;