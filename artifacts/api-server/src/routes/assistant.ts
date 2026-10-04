import { Router, type IRouter } from "express";
import { ChatWithAssistantBody, ChatWithAssistantResponse } from "@workspace/api-zod";
import { getSignedInUser } from "../lib/auth";
import { getDatabase, serializeScheme } from "../lib/mongo";
import type { SchemeRecord } from "../lib/models";
import { generateGroundedAnswer, retrieveSchemes } from "../lib/rag";

const router: IRouter = Router();

const unableToVerify: Record<string, string> = {
  en: "I could not verify this requirement from the available official information. Try a more specific question or open the official source links in the scheme catalogue.",
  te: "అందుబాటులో ఉన్న అధికారిక సమాచారంతో ఈ అవసరాన్ని నిర్ధారించలేకపోయాను. మరింత స్పష్టమైన ప్రశ్న అడగండి లేదా పథకం వివరాల్లోని అధికారిక లింక్‌ను చూడండి.",
  hi: "उपलब्ध आधिकारिक जानकारी से इस शर्त की पुष्टि नहीं हो सकी। अधिक स्पष्ट प्रश्न पूछें या योजना सूची में दिया आधिकारिक लिंक देखें।",
};

router.post("/ai/chat", async (req, res): Promise<void> => {
  const parsed = ChatWithAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a question to continue." });
    return;
  }
  try {
    const db = await getDatabase();
    const allSchemes = await db.collection<SchemeRecord>("schemes").find().toArray();
    const retrieved = retrieveSchemes(parsed.data.question, allSchemes, 5);
    if (retrieved.length === 0) {
      res.json(
        ChatWithAssistantResponse.parse({
          answer: unableToVerify[parsed.data.language] ?? unableToVerify.en,
          sources: [],
          grounded: false,
        }),
      );
      return;
    }
    const answer = await generateGroundedAnswer(
      parsed.data.question,
      parsed.data.language,
      retrieved,
    );
    let userId: string | null = null;
    try {
      userId = (await getSignedInUser(req))?.id ?? null;
    } catch {
      userId = null;
    }
    await db.collection("aiQueries").insertOne({
      userId,
      language: parsed.data.language,
      retrievedSchemeIds: retrieved.map((scheme) => scheme.id),
      createdAt: new Date(),
    });
    res.json(
      ChatWithAssistantResponse.parse({
        answer,
        sources: retrieved.map((scheme) => ({
          title: scheme.sourceName ?? scheme.schemeName,
          url: scheme.sourceUrl,
          lastUpdated: scheme.sourceLastUpdated,
          dataStatus: scheme.dataStatus,
        })),
        grounded: true,
      }),
    );
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Assistant response failed",
    );
    res.status(503).json({
      error: "The assistant is temporarily unavailable. Please try again in a moment.",
    });
  }
});

export default router;