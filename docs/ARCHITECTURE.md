# Resto App Architecture

## Phase 1 Runtime

This repository runs a single Node.js process for the MVP:

- Express serves REST APIs and the static Phase 1 web client.
- Socket.IO provides realtime order and request notifications.
- SQLite via `better-sqlite3` is the local development adapter.
- The `database/schema.sql` file defines the intended PostgreSQL production schema.

## SaaS Boundaries

Every operational table carries `restaurant_id` so future multi-restaurant isolation can be enforced at the API, query, and database policy layers. Phase 1 seeds one restaurant, but endpoints already scope staff access to the authenticated restaurant.

## Roles

- Customer: QR scoped guest ordering and live status tracking.
- Admin: dashboard metrics, menu management, table creation, QR links.
- Kitchen: incoming orders and kitchen status updates.
- Waiter: ready orders, delivery completion, customer requests.

## Security Decisions

- Staff authentication uses signed JWT-compatible tokens.
- Passwords use Node `crypto.scrypt` hashes.
- QR tokens are HMAC signed and cannot be forged without `QR_SECRET`.
- Staff endpoints use role-based middleware.
- Basic security headers and IP rate limiting are enabled.
- Input is normalized and validated before writes.

Production hardening should add HTTPS termination, managed secrets, PostgreSQL row-level security or tenant-aware repositories, Cloudinary signed uploads, OTP provider integration, centralized audit logging, and a battle-tested JWT library.

## Clean Architecture Direction

The MVP keeps files small enough for rapid review, but the boundaries map cleanly to a future split:

- `server.js`: delivery layer, routes, auth middleware, realtime publishers.
- `database.js`: persistence adapter, local schema, seed data, token helpers.
- `public/`: web client for Phase 1 verification.
- `frontend/flutter_app/`: Flutter client source.
- `database/schema.sql`: production PostgreSQL contract.

For Phase 2, move route handlers into `backend/src/modules/*`, extract repository interfaces, and swap SQLite queries for PostgreSQL repositories without changing the external API contract.
