import type { CitizenProfileRecord, SchemeRecord } from "./models";

type EligibilityStatus =
  | "eligible"
  | "potentially_eligible"
  | "not_eligible"
  | "more_information_required";

export interface EligibilityResult {
  scheme: SchemeRecord;
  status: EligibilityStatus;
  matchedCriteria: string[];
  unmatchedCriteria: string[];
  missingInformation: string[];
  requiredDocuments: string[];
  nextSteps: string[];
  verified: boolean;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function evaluateEligibility(
  profile: Partial<CitizenProfileRecord>,
  scheme: SchemeRecord,
): EligibilityResult {
  const matchedCriteria: string[] = [];
  const unmatchedCriteria: string[] = [];
  const missingInformation: string[] = [];
  const verified = scheme.dataStatus === "official_verified";

  if (scheme.occupation) {
    if (!profile.occupation) {
      missingInformation.push("Occupation");
    } else if (clean(profile.occupation).includes(clean(scheme.occupation))) {
      matchedCriteria.push(`Occupation matches: ${scheme.occupation}`);
    } else {
      unmatchedCriteria.push(`Occupation does not match: ${scheme.occupation}`);
    }
  }

  if (scheme.state) {
    if (!profile.state) {
      missingInformation.push("State");
    } else if (clean(profile.state) === clean(scheme.state)) {
      matchedCriteria.push(`State matches: ${scheme.state}`);
    } else {
      unmatchedCriteria.push(`State does not match: ${scheme.state}`);
    }
  }

  if (scheme.ageMin !== null || scheme.ageMax !== null) {
    if (profile.age == null) {
      missingInformation.push("Age");
    } else if (
      (scheme.ageMin === null || profile.age >= scheme.ageMin) &&
      (scheme.ageMax === null || profile.age <= scheme.ageMax)
    ) {
      matchedCriteria.push("Age is within the stated range");
    } else {
      unmatchedCriteria.push("Age is outside the stated range");
    }
  }

  if (scheme.incomeLimit !== null) {
    if (profile.annualIncome == null) {
      missingInformation.push("Annual household income");
    } else if (profile.annualIncome <= scheme.incomeLimit) {
      matchedCriteria.push("Income is within the listed limit");
    } else {
      unmatchedCriteria.push("Income is above the listed limit");
    }
  }

  if (!verified) {
    missingInformation.push("Current official eligibility criteria are not verified for this demo record");
  }

  let status: EligibilityStatus;
  if (unmatchedCriteria.length > 0 && verified) {
    status = "not_eligible";
  } else if (missingInformation.length > 0) {
    status = "more_information_required";
  } else if (verified) {
    status = "eligible";
  } else {
    status = "potentially_eligible";
  }

  const nextSteps = [
    "Confirm the latest eligibility rules with the official source before applying.",
    ...scheme.applicationSteps,
  ];

  return {
    scheme,
    status,
    matchedCriteria,
    unmatchedCriteria,
    missingInformation,
    requiredDocuments: scheme.documentsRequired,
    nextSteps: [...new Set(nextSteps)],
    verified,
  };
}