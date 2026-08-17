# Caps Project Rules

## Before Making Any Changes

**READ [`docs/AGENT_GUIDE.md`](../docs/AGENT_GUIDE.md) FIRST.** It contains:
- Architecture and tech stack (locked — do not substitute)
- Database schema
- API conventions
- Critical business rules
- Design system tokens
- Implementation order (vertical slices)
- Do's and Don'ts
- V2 scope (out of bounds)

## Before Starting a New Slice

Check [`docs/IMPLEMENTATION_PLAN.md`](../docs/IMPLEMENTATION_PLAN.md) for the full specification of each vertical slice, including server endpoints, client features, and test criteria.

## Key Constraints

1. **Slices are sequential.** Do not start Slice N+1 until Slice N is testable and working.
2. **No tech stack changes.** Node.js + Express + SQLite + SvelteKit + WebSocket. Period.
3. **No V2 features.** Memory Spaces, video, voice, Dotbooks, i18n, Tauri — all out of scope.
4. **Photos on filesystem, metadata in SQLite.** Never store images as BLOBs.
5. **Guest experience is frictionless.** No accounts, no passwords, no app downloads. QR → name → done.
