import type { SchemeRecord } from "./models";

const stopWords = new Set([
  "the", "and", "for", "you", "are", "what", "which", "with", "from", "have",
  "that", "this", "your", "about", "scheme", "schemes", "eligible", "government",
]);

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

export function retrieveSchemes(
  query: string,
  schemes: SchemeRecord[],
  limit = 5,
): SchemeRecord[] {
  const queryTerms = [...new Set(terms(query))];
  if (queryTerms.length === 0) return [];
  return schemes
    .map((scheme) => {
      const name = terms(scheme.schemeName);
      const keywords = terms(scheme.keywords.join(" "));
      const context = terms(
        [
          scheme.category,
          scheme.state ?? "",
          scheme.description,
          scheme.benefit,
          scheme.eligibilitySummary,
          scheme.occupation ?? "",
          scheme.government,
        ].join(" "),
      );
      const score = queryTerms.reduce(
        (total, term) =>
          total +
          (name.includes(term) ? 5 : 0) +
          (keywords.includes(term) ? 3 : 0) +
          (context.includes(term) ? 1 : 0),
        0,
      );
      return { scheme, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.scheme.schemeName.localeCompare(b.scheme.schemeName))
    .slice(0, limit)
    .map((entry) => entry.scheme);
}

export function schemeContext(schemes: SchemeRecord[]): string {
  return schemes
    .map((scheme) =>
      [
        `Scheme: ${scheme.schemeName}`,
        `Government: ${scheme.government}`,
        `Category: ${scheme.category}`,
        `State: ${scheme.state ?? "Central / all states"}`,
        `Description: ${scheme.description}`,
        `Benefit: ${scheme.benefit}`,
        `Eligibility: ${scheme.eligibilitySummary}`,
        `Required documents (demo list): ${scheme.documentsRequired.join(", ")}`,
        `Application steps (general): ${scheme.applicationSteps.join(" ")}`,
        `Deadline: ${scheme.deadline ?? "No verified deadline listed"}`,
        `Source: ${scheme.sourceName ?? "Not provided"}${scheme.sourceUrl ? ` (${scheme.sourceUrl})` : ""}`,
        `Source last updated: ${scheme.sourceLastUpdated ?? "Unknown"}`,
        `Data status: ${scheme.dataStatus}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

const languageNames: Record<string, string> = {
  en: "English",
  te: "Telugu",
  hi: "Hindi",
};

export async function generateGroundedAnswer(
  question: string,
  language: string,
  schemes: SchemeRecord[],
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const model = process.env.LLM_MODEL || "gemini-2.5-flash";
  const sources = schemeContext(schemes);
  const system = [
    "You are SchemeSaathi, a careful public-service information assistant for Indian welfare schemes.",
    `Answer in ${languageNames[language] ?? "English"}. Keep the language simple and respectful.`,
    "Use only the supplied scheme context for scheme-specific facts. Do not invent amounts, eligibility rules, deadlines, required documents, or approval status.",
    "Explicitly label every record marked demo_unverified as demo information that has not been checked against the latest official notification.",
    "If the context does not verify a requested fact, say: I could not verify this requirement from the available official information.",
    "Separate user-provided facts, retrieved scheme facts, and your explanation. Never say a person is officially approved. Final approval belongs to the relevant government department.",
    "Include the scheme source and last-updated status when relevant. Do not ask for Aadhaar numbers or other identity numbers.",
    "Retrieved scheme context:\n" + (sources || "No relevant scheme records were retrieved."),
  ].join("\n\n");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: question }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}.`);
  }
  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const answer = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!answer) throw new Error("Gemini returned an empty answer.");
  return answer;
}