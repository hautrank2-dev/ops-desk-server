# OpsDesk Server

NestJS 11 + Mongoose + RxJS backend for OpsDesk. Respond in Vietnamese by default.

Product/structure/tech notes: `.kiro/steering/product.md`, `structure.md`, `tech.md`.

## Rules

Path-scoped rules live in `.claude/rules/` and load when matching files are touched:

- `api-conventions.md` — REST naming for list/detail/create/update, query params (`page`, `pageSize`, `populations`, `sortBy`, `order`, `xxxId(s)`, `startXxxAt`/`endXxxAt`), response shapes. Read before adding or changing any endpoint, query DTO or filter.
- `select-async.md` — async select spec (client-side concept, kept for reference).
