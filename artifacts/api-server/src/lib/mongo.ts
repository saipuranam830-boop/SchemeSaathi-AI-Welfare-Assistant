import { MongoClient, type Db } from "mongodb";
import type { SchemeRecord } from "./models";

let connection: Promise<Db> | undefined;
let seeded: Promise<void> | undefined;

const demoSchemes: Omit<SchemeRecord, "_id" | "createdAt" | "updatedAt">[] = [
  {
    id: "pm-kisan",
    schemeName: "Pradhan Mantri Kisan Samman Nidhi (PM-KISAN)",
    government: "Government of India",
    state: null,
    category: "Agriculture",
    description:
      "Demo catalogue entry for a central farmer-support programme. Verify current conditions on the official portal.",
    benefit: "Farmer support under the current scheme guidelines",
    eligibilitySummary:
      "Current eligibility rules have not been verified in this demo record.",
    ageMin: null,
    ageMax: null,
    gender: null,
    occupation: "farmer",
    incomeLimit: null,
    categoryRequirement: null,
    landRequirement: null,
    documentsRequired: ["Aadhaar or accepted identity proof", "Land or tenancy records"],
    applicationSteps: [
      "Review current eligibility and required documents on the official portal.",
      "Apply through the official portal or an authorized local service centre.",
      "Keep the acknowledgement or reference number for follow-up.",
    ],
    applicationUrl: "https://pmkisan.gov.in/",
    deadline: null,
    status: "Information only",
    sourceUrl: "https://pmkisan.gov.in/",
    sourceName: "PM-KISAN official portal",
    sourceLastUpdated: null,
    dataStatus: "demo_unverified",
    keywords: ["farmer", "agriculture", "land", "income support", "pm kisan"],
  },
  {
    id: "pm-fasal-bima",
    schemeName: "Pradhan Mantri Fasal Bima Yojana",
    government: "Government of India",
    state: null,
    category: "Agriculture",
    description:
      "Demo catalogue entry for crop-insurance information. Availability, crops and cut-off dates vary; verify the current season notice.",
    benefit: "Crop insurance information under current season rules",
    eligibilitySummary:
      "Current crop, season and enrollment rules have not been verified in this demo record.",
    ageMin: null,
    ageMax: null,
    gender: null,
    occupation: "farmer",
    incomeLimit: null,
    categoryRequirement: null,
    landRequirement: null,
    documentsRequired: ["Identity proof", "Cultivation or land records", "Bank account details"],
    applicationSteps: [
      "Check whether your crop and area are notified for the current season.",
      "Confirm the enrollment cut-off date with the official portal or local agriculture office.",
      "Submit the required information and keep the acknowledgement.",
    ],
    applicationUrl: "https://pmfby.gov.in/",
    deadline: null,
    status: "Information only",
    sourceUrl: "https://pmfby.gov.in/",
    sourceName: "Pradhan Mantri Fasal Bima Yojana portal",
    sourceLastUpdated: null,
    dataStatus: "demo_unverified",
    keywords: ["farmer", "crop", "insurance", "agriculture", "fasal bima"],
  },
  {
    id: "telangana-farmer-support",
    schemeName: "Telangana Farmer Support",
    government: "Government of Telangana",
    state: "Telangana",
    category: "Agriculture",
    description:
      "Demo entry for state farmer-support information. Programme names and rules can change; check the latest state government notice.",
    benefit: "State farmer-support information",
    eligibilitySummary:
      "Current Telangana programme criteria have not been verified in this demo record.",
    ageMin: null,
    ageMax: null,
    gender: null,
    occupation: "farmer",
    incomeLimit: null,
    categoryRequirement: null,
    landRequirement: null,
    documentsRequired: ["Identity proof", "Current land or cultivation records"],
    applicationSteps: [
      "Confirm the active programme name and rules on an official Telangana government page.",
      "Ask the local agriculture office which records are currently accepted.",
      "Use only an official application channel and retain the acknowledgement.",
    ],
    applicationUrl: "https://www.telangana.gov.in/",
    deadline: null,
    status: "Information only",
    sourceUrl: "https://www.telangana.gov.in/",
    sourceName: "Government of Telangana",
    sourceLastUpdated: null,
    dataStatus: "demo_unverified",
    keywords: ["telangana", "farmer", "agriculture", "state support"],
  },
  {
    id: "national-scholarship-portal",
    schemeName: "National Scholarship Portal — Scheme Directory",
    government: "Government of India",
    state: null,
    category: "Education",
    description:
      "Demo directory entry pointing students to the national scholarship portal. Individual schemes have separate criteria and deadlines.",
    benefit: "Find scholarship programmes and application notices",
    eligibilitySummary:
      "Eligibility depends on the individual scholarship; no criteria are verified in this demo record.",
    ageMin: null,
    ageMax: null,
    gender: null,
    occupation: "student",
    incomeLimit: null,
    categoryRequirement: null,
    landRequirement: null,
    documentsRequired: ["Enrollment proof", "Identity proof", "Income or category certificate if required by the selected scheme"],
    applicationSteps: [
      "Find the relevant scholarship and read its current notice.",
      "Check the institution, course, income and category requirements for that scholarship.",
      "Apply on the official portal before the published deadline.",
    ],
    applicationUrl: "https://scholarships.gov.in/",
    deadline: null,
    status: "Information only",
    sourceUrl: "https://scholarships.gov.in/",
    sourceName: "National Scholarship Portal",
    sourceLastUpdated: null,
    dataStatus: "demo_unverified",
    keywords: ["student", "education", "scholarship", "school", "college"],
  },
  {
    id: "ayushman-bharat-pmjay",
    schemeName: "Ayushman Bharat PM-JAY",
    government: "Government of India",
    state: null,
    category: "Healthcare",
    description:
      "Demo directory entry for public health coverage information. Beneficiary eligibility and service details must be checked through official channels.",
    benefit: "Public health coverage information",
    eligibilitySummary:
      "Beneficiary eligibility has not been verified in this demo record.",
    ageMin: null,
    ageMax: null,
    gender: null,
    occupation: null,
    incomeLimit: null,
    categoryRequirement: null,
    landRequirement: null,
    documentsRequired: ["Identity proof", "Beneficiary or family eligibility details"],
    applicationSteps: [
      "Check beneficiary status through the official PM-JAY channel.",
      "Contact an authorized health facility or help desk for assistance.",
      "Do not share identity documents with unofficial websites or agents.",
    ],
    applicationUrl: "https://pmjay.gov.in/",
    deadline: null,
    status: "Information only",
    sourceUrl: "https://pmjay.gov.in/",
    sourceName: "Ayushman Bharat PM-JAY",
    sourceLastUpdated: null,
    dataStatus: "demo_unverified",
    keywords: ["healthcare", "health", "hospital", "medical", "pmjay"],
  },
];

async function connect(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  const db = client.db();
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("schemes").createIndex({ id: 1 }, { unique: true }),
    db.collection("documents").createIndex({ id: 1 }, { unique: true }),
    db.collection("documents").createIndex({ ownerId: 1 }),
    db.collection("savedSchemes").createIndex({ ownerId: 1, schemeId: 1 }, { unique: true }),
    db.collection("adminSetup").createIndex({ key: 1 }, { unique: true }),
  ]);
  return db;
}

async function seed(db: Db): Promise<void> {
  const collection = db.collection<SchemeRecord>("schemes");
  for (const scheme of demoSchemes) {
    await collection.updateOne(
      { id: scheme.id },
      { $setOnInsert: { ...scheme, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true },
    );
  }
}

export async function getDatabase(): Promise<Db> {
  connection ??= connect();
  let db: Db;
  try {
    db = await connection;
  } catch (error) {
    connection = undefined;
    throw error;
  }
  seeded ??= seed(db);
  try {
    await seeded;
  } catch (error) {
    seeded = undefined;
    throw error;
  }
  return db;
}

export function serializeScheme(scheme: SchemeRecord): SchemeRecord {
  const { _id: _ignored, ...safe } = scheme;
  return safe as SchemeRecord;
}