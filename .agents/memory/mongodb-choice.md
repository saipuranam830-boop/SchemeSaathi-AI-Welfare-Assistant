---
name: MongoDB choice
description: The required database choice for SchemeSaathi.
---

SchemeSaathi uses the user's configured MongoDB service through `MONGODB_URI`. Do not replace it with Replit PostgreSQL or introduce a fallback database without explicit approval.

**Why:** The user explicitly selected MongoDB for this application.

**How to apply:** Preserve MongoDB for authentication, scheme records, profiles, saved items, document metadata, deadlines, and administration. If it cannot connect, report the failure and ask the user to fix the connection rather than switching databases.