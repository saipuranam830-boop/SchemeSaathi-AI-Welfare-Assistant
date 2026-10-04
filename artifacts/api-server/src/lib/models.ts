import type { Document } from "mongodb";

export type UserRole = "citizen" | "admin";

export interface UserRecord extends Document {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  passwordHash: string;
  role: UserRole;
  profile?: Record<string, unknown>;
  notificationsEnabled?: boolean;
  createdAt: Date;
}

export interface SchemeRecord extends Document {
  id: string;
  schemeName: string;
  government: string;
  state: string | null;
  category: string;
  description: string;
  benefit: string;
  eligibilitySummary: string;
  ageMin: number | null;
  ageMax: number | null;
  gender: string | null;
  occupation: string | null;
  incomeLimit: number | null;
  categoryRequirement: string | null;
  landRequirement: string | null;
  documentsRequired: string[];
  applicationSteps: string[];
  applicationUrl: string | null;
  deadline: string | null;
  status: string;
  sourceUrl: string | null;
  sourceName: string | null;
  sourceLastUpdated: string | null;
  dataStatus: "demo_unverified" | "official_verified";
  keywords: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CitizenProfileRecord {
  fullName: string;
  email: string;
  mobile: string | null;
  age: number | null;
  gender: string | null;
  state: string | null;
  district: string | null;
  mandal: string | null;
  village: string | null;
  annualIncome: number | null;
  occupation: string | null;
  landAcres: number | null;
  category: string | null;
  studentStatus: boolean;
  disabilityStatus: boolean;
  seniorCitizenStatus: boolean;
  widowStatus: boolean;
  completionPercent: number;
}

export interface CitizenDocumentRecord extends Document {
  id: string;
  ownerId: string;
  fileName: string;
  category: string;
  objectPath: string;
  contentType: string;
  size: number;
  status: "uploaded" | "needs_review" | "matches_profile" | "mismatch";
  uploadedAt: Date;
  detectedInformation: string[];
  mismatchWarnings: string[];
}