import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateDocumentBody,
  CreateDocumentResponse,
  ListDocumentsResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  VerifyDocumentParams,
  VerifyDocumentResponse,
} from "@workspace/api-zod";
import { ObjectPermission } from "../lib/objectAcl";
import { getSignedInUser } from "../lib/auth";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { getDatabase } from "../lib/mongo";
import type { CitizenDocumentRecord } from "../lib/models";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const allowedCategories = new Set([
  "Aadhaar",
  "Income Certificate",
  "Land Record",
  "Caste Certificate",
  "Residence Certificate",
  "Disability Certificate",
  "Education Certificate",
  "Other",
]);

function publicDocument(document: CitizenDocumentRecord) {
  return {
    id: document.id,
    fileName: document.fileName,
    category: document.category,
    status: document.status,
    uploadedAt: document.uploadedAt.toISOString(),
    detectedInformation: document.detectedInformation,
    mismatchWarnings: document.mismatchWarnings,
  };
}

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Unsupported file or invalid file details." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in before uploading a document." });
      return;
    }
    const db = await getDatabase();
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    await db.collection("pendingUploads").insertOne({
      ownerId: user.id,
      objectPath,
      name: parsed.data.name,
      size: parsed.data.size,
      contentType: parsed.data.contentType,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      createdAt: new Date(),
    });
    res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath }));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Private upload URL could not be created",
    );
    res.status(503).json({ error: "Secure upload is temporarily unavailable." });
  }
});

router.get("/documents", async (req, res): Promise<void> => {
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to view your documents." });
      return;
    }
    const db = await getDatabase();
    const documents = await db
      .collection<CitizenDocumentRecord>("documents")
      .find({ ownerId: user.id })
      .sort({ uploadedAt: -1 })
      .toArray();
    res.json(ListDocumentsResponse.parse(documents.map(publicDocument)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Private documents could not be listed",
    );
    res.status(503).json({ error: "Document list is temporarily unavailable." });
  }
});

router.post("/documents", async (req, res): Promise<void> => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success || !allowedCategories.has(parsed.data.category)) {
    res.status(400).json({ error: "Check the document category and file details." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to save uploaded documents." });
      return;
    }
    if (!parsed.data.objectPath.startsWith("/objects/uploads/")) {
      res.status(400).json({ error: "Invalid private object path." });
      return;
    }
    const db = await getDatabase();
    const pending = await db.collection("pendingUploads").findOne({
      ownerId: user.id,
      objectPath: parsed.data.objectPath,
      expiresAt: { $gt: new Date() },
    });
    if (!pending) {
      res.status(400).json({ error: "Upload authorization has expired. Please upload again." });
      return;
    }
    const objectFile = await storage.getObjectEntityFile(parsed.data.objectPath);
    const [metadata] = await objectFile.getMetadata();
    const storedSize = Number(metadata.size ?? 0);
    if (
      storedSize <= 0 ||
      storedSize > 10 * 1024 * 1024 ||
      storedSize !== parsed.data.size ||
      metadata.contentType !== parsed.data.contentType
    ) {
      res.status(400).json({ error: "Uploaded file details do not match the authorized upload." });
      return;
    }
    await storage.trySetObjectEntityAclPolicy(parsed.data.objectPath, {
      owner: user.id,
      visibility: "private",
    });
    const record: CitizenDocumentRecord = {
      id: randomUUID(),
      ownerId: user.id,
      fileName: parsed.data.fileName,
      category: parsed.data.category,
      objectPath: parsed.data.objectPath,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
      status: "uploaded",
      uploadedAt: new Date(),
      detectedInformation: [],
      mismatchWarnings: [],
    };
    await db.collection<CitizenDocumentRecord>("documents").insertOne(record);
    await db.collection("pendingUploads").deleteOne({ _id: pending._id });
    res.status(201).json(CreateDocumentResponse.parse(publicDocument(record)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Document metadata could not be saved",
    );
    res.status(503).json({ error: "Document could not be saved. Please try again." });
  }
});

router.post("/documents/:id/verify", async (req, res): Promise<void> => {
  const parsed = VerifyDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document identifier." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to review documents." });
      return;
    }
    const db = await getDatabase();
    const document = await db.collection<CitizenDocumentRecord>("documents").findOne({
      id: parsed.data.id,
      ownerId: user.id,
    });
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const next = {
      ...document,
      status: "needs_review" as const,
      detectedInformation: [],
      mismatchWarnings: [
        "Document contents are not automatically read. A qualified person must review the file.",
      ],
    };
    await db.collection<CitizenDocumentRecord>("documents").updateOne(
      { id: document.id, ownerId: user.id },
      {
        $set: {
          status: next.status,
          detectedInformation: next.detectedInformation,
          mismatchWarnings: next.mismatchWarnings,
        },
      },
    );
    res.json(VerifyDocumentResponse.parse(publicDocument(next)));
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Document review could not be prepared",
    );
    res.status(503).json({ error: "Document review is temporarily unavailable." });
  }
});

router.get("/documents/:id/file", async (req, res): Promise<void> => {
  const parsed = VerifyDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid document identifier." });
    return;
  }
  try {
    const user = await getSignedInUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to access this document." });
      return;
    }
    const db = await getDatabase();
    const document = await db.collection<CitizenDocumentRecord>("documents").findOne({
      id: parsed.data.id,
      ownerId: user.id,
    });
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const objectFile = await storage.getObjectEntityFile(document.objectPath);
    const canRead = await storage.canAccessObjectEntity({
      userId: user.id,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canRead) {
      res.status(403).json({ error: "You cannot access this document." });
      return;
    }
    const response = await storage.downloadObject(objectFile, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${document.fileName.replace(/["\\\r\n]/g, "_")}"`,
    );
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Private document download failed",
    );
    res.status(503).json({ error: "Document could not be opened." });
  }
});

export default router;