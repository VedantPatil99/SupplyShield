# Performance probe

Real measurements from `npm run perf` (`backend/scripts/perf.js`). This is a probe on one laptop with the
synthetic dataset, **not** a benchmark and not a scalability test. The 10M-node / 50M-relationship figure in the proposal is a
design target that was **not** tested.

## Environment
- Date: 2026-10-08T17:44:28.714Z
- Machine: AMD Ryzen 9 6900HS with Radeon Graphics (16 logical cores), 15.2 GB RAM, Windows_NT 10.0.26200
- Node.js v24.13.1; MongoDB 7.0.14 (single-node replica set); Neo4j 5.26.0 Community (default memory settings)
- Databases and app on the same machine (localhost), no Docker
- Graph size during the probe: 3243 nodes, 8346 relationships; 500 batches (synthetic dataset)

## Results (milliseconds)

| Operation | Samples | p50 | p95 | max | Notes |
|---|---|---|---|---|---|
| Forward trace (`/trace/forward`), service level | 100 | 2.4 | 3.1 | 3.6 | 100 different batches |
| Backward trace / authenticity, service level | 100 | 2.3 | 3.1 | 4.5 | 100 (batch, pharmacy) pairs |
| Recall impact via Recall node (handoff §8 query) | 50 | 1.7 | 2.6 | 2.9 | 10 seeded recalls, 5 rounds |
| Recall preview: recipients of a batch set | 50 | 1.6 | 2.2 | 3.6 | graph traversal before the Recall node exists |
| 10-relationship variable-length expansion from a batch (undirected, all edge types) | 20 | 3.8 | 4.6 | 4.6 | reaches ~3233 nodes from one batch; 20 batches |
| Full anomaly detection run (5 detectors + Mongo upsert) | 5 | 671 | 688 | 688 | last run per detector (ms): provenance_gap 138.95, multi_manufacturer_batch 3.24, duplicate_batch_fanin 102.23, reentrant_distribution 5.5, abnormal_fanout 413.15 |
| `GET /api/trace/forward/:id` end to end (HTTP) | 100 | 3.5 | 5.1 | 9.9 | includes JWT check + JSON |
| `GET /api/trace/backward/:id` end to end (HTTP) | 100 | 3.2 | 3.7 | 4.9 |  |
| Sync lag: Mongo insert → shipment + edges visible in Neo4j | 25 | 13.9 | 14.8 | 33.3 | polled every 5 ms; includes poll granularity |

## Reading these numbers

- **NFR "trace queries within 2 seconds up to 10 hops":** every trace query above finished well under 2 s on this data.
  The longest manufacturer→recipient chain in the dataset is **3 entity hops** (each hop is a Shipment with FROM and TO
  edges, so 6 relationships), because the network has four tiers. A real 10-hop *supply chain* does not exist in this data. The
  "10-relationship variable-length expansion" row is a synthetic stress probe: an undirected traversal over all edge types out to
  10 relationships, which reaches a large part of the graph. It is reported to show traversal cost at that depth, not as a
  trace a user would run.
- The first query after a restart is slower (plan compilation, cold page cache); the probe warms up with 10 traces first.
- Sync lag includes the polling interval of the probe itself (5 ms). The app also reports per-event lag (Mongo commit wall time →
  Neo4j write complete) live on the admin Sync health page.
- Re-run `npm run perf` to regenerate this file; numbers will vary between machines and runs.
