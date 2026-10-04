---
name: Gemini access
description: The approved Gemini integration path for SchemeSaathi.
---

The user declined the Replit-managed Gemini integration upgrade and asked that it not be retried. Use direct Gemini API requests from the server with the `GEMINI_API_KEY` Replit Secret; keep the key out of client code.

**Why:** The managed setup required an account upgrade the user declined.

**How to apply:** Keep the model configurable and use server-side API calls; never request or print the key in chat.