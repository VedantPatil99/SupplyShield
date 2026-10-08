# SupplyShield REST API

All endpoints are JSON under `/api`. Except `POST /api/auth/login` and `GET /api/health`, every request needs
`Authorization: Bearer <jwt>`. The JWT carries `sub` (user id), `role` and `entity_id`.

**Errors** are `{ "error": "message" }` with consistent status codes:
`401` missing/invalid/expired token or bad credentials · `403` role not allowed or resource outside your scope ·
`404` not found · `409` state conflict (already delivered, open recall exists, status can only move forward, batch recalled) ·
`422` validation error (missing field, bad enum, bad id format, non-positive quantity, insufficient stock).

**Scoping.** Route-level role checks (`requireRole`) are combined with row-level scoping in the handlers:
regulator and admin see everything; a manufacturer sees its own batches (and their shipments, anomalies and recalls);
distributors, wholesalers and pharmacies see only batches/shipments/inventory/recalls that involve their own entity.

**Every mutating request** (POST/PATCH/PUT/DELETE), including rejected ones, is written to the append-only audit log.

List endpoints accept `limit` (default 50) and `skip`, and return `{ items, total, limit, skip }`.

---

## Health & auth

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/health` | public | `{status, app_now, mongo:{ok,ping_ms}, neo4j:{ok,ping_ms}, sync}`; 503 if a store is down |
| POST | `/auth/login` | public | Body `{username, password}` → `{token, user}` (bcrypt compare) |
| GET | `/auth/me` | any | Current user with their entity |

```bash
curl -s -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"regulator1","password":"Regulator@123"}'
```

## Entities

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/entities?type=&q=` | any | Directory of the 135 supply-chain entities (`type` ∈ manufacturer, distributor, wholesaler, pharmacy) |
| GET | `/entities/:id` | any | One entity |

## Batches (FR-1)

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/batches` | manufacturer, admin | Register a batch. `manufacturer_id` is forced from the JWT (admin must pass it). Generates `BATCH-<year>-<6 hex>`, creates the manufacturer's opening inventory and a `quality_check` transaction in one MongoDB transaction |
| GET | `/batches?q=&status=&manufacturer_id=` | any (scoped) | Adds `is_expired` (expiry < `APP_NOW`) and `manufacturer_name` |
| GET | `/batches/:id` | any (scoped) | Batch + recalls; owner/oversight also get `anomalies` and current `holders` |

Body for `POST /batches`:
```json
{ "product_name": "Paracetamol 500mg Tablets", "product_code": "PARA500-TAB",
  "manufacture_date": "2026-08-20", "expiry_date": "2028-08-20", "quantity_produced": 10000,
  "storage_conditions": { "temperature_range_c": [15, 25], "requires_cold_chain": false },
  "regulatory": { "approval_number": "CDSCO-2026-PARA-0001" } }
```

## Shipments (FR-2, FR-3)

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/shipments` | manufacturer, distributor, wholesaler, admin | Body `{batch_id, to_entity_id, quantity, transport_mode?}` (admin also `from_entity_id`). Sender = JWT entity. Receiver must be a later tier. Batch must be `active` and unexpired. Sender inventory is decremented atomically (conditional update; 422 if insufficient). Status starts `dispatched` |
| PATCH | `/shipments/:id/receive` | receiving distributor/wholesaler/pharmacy, admin | Marks `delivered` with `actual_arrival`, upserts receiver inventory, writes an `ownership_transfer` transaction (one MongoDB transaction). 409 if already delivered |
| GET | `/shipments?direction=inbound\|outbound\|all&status=&batch_id=&entity_id=` | any (scoped) | `entity_id` only for regulator/admin |
| GET | `/shipments/:id` | sender, receiver, batch owner, oversight | |

## Inventory & transactions

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/inventory?entity_id=&batch_id=&in_stock=true` | own entity; regulator/admin any `entity_id` | Each line includes `recall_status`, `is_expired`, `batch_status` and `active_recall` (an open recall that notified this holder, with `my_status`) |
| GET | `/transactions?batch_id=&type=` | scoped | Read-only ledger (`ownership_transfer`, `quality_check`, `recall_action`). No mutation routes exist |

## Traceability (FR-4, Neo4j)

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/trace/forward/:batchId` | manufacturer (own batch), regulator, admin | `{batch, producers[], edges[], recipients[], hops, query_ms}`; each edge is a shipment with `from`/`to` entity |
| GET | `/trace/map/:batchId` | anyone who can see the batch | Data for the visual Network map: `{batch, view, producers[], edges[], recall:{recall_id, statuses{entity_id: status}, returned, total}, holdings{entity_id: units}, anomalies[]}`. Regulator, admin and the batch's manufacturer get `view:"full"`; other companies get `view:"neighbourhood"`, which is only the deliveries upstream of them (where their stock came from) and downstream (where they sent it). They see only their own holdings and no anomaly list |
| GET | `/trace/backward/:batchId?entity_id=` | pharmacy (own entity, `entity_id` ignored), regulator, admin | Authenticity check. `{verified, reasons[], producers[], chains[]}`. Each inbound shipment to the entity must chain back hop by hop, in time order, to a producing manufacturer (≤ 10 hops). `verified` requires every inbound chain complete and exactly one producer. Unknown batch → **404** with `verified:false` |

## Anomalies (FR-5)

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/anomalies/run` | regulator, admin | Runs the five detectors, upserts results, returns `{findings, new_findings, by_type, detector_ms, fanout:{baseline_per_sender_day, threshold, next_highest_sender_fanout}, provenance_gap_shipments, duration_ms}` |
| GET | `/anomalies?status=&type=&severity=&batch_id=` | regulator, admin (all); manufacturer (own batches) | |
| PATCH | `/anomalies/:id` | regulator, admin | Body `{status: open\|reviewed\|dismissed, note?}`. Ids look like `ANOM\|provenance_gap\|BATCH-2025-A7B41D\|DIST-IN-00002` (URL-encode them) |

Detection is idempotent (deterministic ids; re-runs update evidence but never reset a reviewed/dismissed status).
The server also re-runs detection automatically a few seconds after the sync projects a new batch or shipment
(`ANOMALY_AUTO_RUN_DEBOUNCE_MS`).

## Recalls (FR-6, FR-7)

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/recalls/preview` | manufacturer (own batches), regulator, admin | Body `{batch_ids[]}` → affected entities from graph traversal + their current stock. Read-only |
| POST | `/recalls` | manufacturer (own batches), regulator, admin. **Distributor/wholesaler/pharmacy → 403** | Body `{batch_ids[], reason, recall_class: "Class I"\|"Class II"\|"Class III"}`. Affected entities = every downstream recipient (graph), all `notified`; batches set `recalled`; `recall_action` transactions. 409 if a batch already has an open recall |
| GET | `/recalls?status=` | scoped (entities: recalls that notified them) | Each item has `progress {total, by_status, returned_pct, actioned_pct}` and `my_status` |
| GET | `/recalls/:id` | scoped | Full affected list with names (a distributor/wholesaler/pharmacy sees only its own row) |
| PATCH | `/recalls/:id/entities/:entityId` | that entity, admin | Body `{status: acknowledged\|quarantined\|returned}`; forward-only. Quarantined/returned also set `inventory.recall_status`. The recall auto-completes when every affected entity has `returned` |

## Alerts

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/alerts` | any | Derived (not stored): open recalls notifying me, open anomalies on my batches (manufacturer), inbound shipments awaiting receipt, expired stock; oversight roles get network-wide counts |

## Admin

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/admin/users` | admin | |
| POST | `/admin/users` | admin | Body `{username, password (≥8), role, entity_id (required for entity roles, must match the role), display_name?}`; bcrypt cost 10 |
| PATCH | `/admin/users/:id` | admin | Any of `role, entity_id, display_name, password` |
| DELETE | `/admin/users/:id` | admin | Cannot delete yourself |
| GET | `/admin/sync-health` | admin | Sync service stats (status, mode, events processed, last/avg/max lag, errors) + MongoDB vs Neo4j counts + PRODUCED edge count (incl. the 1 planted edge) |
| GET | `/admin/audit?username=&resource=` | admin, regulator | Read-only audit log, newest first |
