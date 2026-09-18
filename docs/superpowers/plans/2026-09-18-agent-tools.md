# Health Agent Tools Implementation Plan

**Goal:** Make the chat box a real tool-using Agent that can answer questions, query health data, and save explicit health records.

**Architecture:** The API will run an Anthropic tool-use loop. Read tools query the existing database and summary functions; write tools call the existing record normalization and persistence path. The client sends recent chat history so the Agent can resolve follow-ups.

**Tech Stack:** Next.js 16 route handlers, Anthropic Messages API tool use, Supabase/local database adapters, Node test runner.

### Tasks

- [ ] Move shared record persistence out of the route handler and expose meal/activity save operations.
- [ ] Add Agent tools for day records, summaries, meal records, weekly snacks, and activities.
- [ ] Replace the route's `agentDecision` branch with a bounded tool-use loop and keep a no-key fallback.
- [ ] Send chat history from the client and render Agent replies plus saved-record confirmations.
- [ ] Add focused tests, then run `npm test`, `npx tsc --noEmit`, and `npm run build`.
