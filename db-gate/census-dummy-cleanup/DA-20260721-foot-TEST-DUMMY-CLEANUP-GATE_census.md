# Foot TEST-DUMMY-CLEANUP — Phase-1 Census (READ-ONLY)

Ticket: DA-20260721-foot-TEST-DUMMY-CLEANUP-GATE
Reply-to: data-architect (CONSULT 2차)
Author: dev-foot · Date: 2026-07-21 KST
Method: Supabase Management API `/database/query` (SELECT only, prod rxlomoozakkjesdqjtvd). **No DELETE. No write. 원본 원장 무접점.**
Full-fidelity freeze snapshot (incl. phone PII): OFF-GIT at `~/.config/medibuilder-secrets/backfill-snapshots/foot-test-dummy-cleanup-20260721/`

---

## C1 — Freeze PK census (per prefix)

| prefix | customers.name | check_ins.customer_name | reservations (customer_id join) |
|---|---|---|---|
| `cf1-new-%` | 0 | 0 | — |
| `단계이동_%` | **9** | **6** | 0 |
| `칸반테스트_%` | 0 | 0 | — |

- Only `단계이동_%` (="stage-move_{epoch-ms}") survives. `cf1-new-%` / `칸반테스트_%` = 0 (already swept, likely T-20260630).
- reservations via customer_id join to freeze-9 = **0** (name-match NOT used, per §C1).
- notes JSONB: not queried (22P02 avoidance honored).
- All 6 check_ins map 1:1 by `customer_id` to 6 of the freeze-9 (no orphans, no extra check_ins). 3 customers have no check_in.
- **Freeze set = 9 customers + 6 check_ins + 0 reservations.** Fixed PK list below (VALUES freeze, §2-2). Execution keyed on fixed ids.

### Freeze PK list
customers (9), by created_at:
```
d7be9306-524b-4d40-8e25-a455a632bbf8  단계이동_1783967359323  F-4710  2026-07-14 03:29
44f4f14c-be85-4ef3-bc93-56a883447b67  단계이동_1784051960090  F-4765  2026-07-15 02:59
b23a2267-1aff-438a-bf7d-f87838a4e870  단계이동_1784138614576  F-4800  2026-07-16 03:03
7c385221-0a48-41be-bd2e-dadb5eedec54  단계이동_1784224882250  F-4835  2026-07-17 03:01
47be6e07-25fc-476a-a561-acba2ee6e3c1  단계이동_1784311192303  F-4867  2026-07-18 02:59
ac0748ea-8c2f-400f-98cd-9436d3f76e3e  단계이동_1784483430874  F-4890  2026-07-20 02:50
64b2f7f0-0140-4bb8-ba9c-918d87a0f538  단계이동_1784573543898  F-4932  2026-07-21 03:52
a24f706c-c06e-4668-b259-d4d53c56d13f  단계이동_1784573557930  F-4933  2026-07-21 03:52
641637ff-a07e-4001-ae35-a5a3255f7319  단계이동_1784573572353  F-4934  2026-07-21 03:52
```
check_ins (6): cc1842dc / bf2b0e94 / dfae725c / 0bbbd3b3 / 39e297aa / 14c29c0c (all customer_id ∈ freeze-9)

---

## C2 — Non-real confirmation + real-patient exclusion  ⚠️ AMBIGUOUS — NOT CLEANLY CONFIRMED

DA predicate: dummy = prefix AND phone `DUMMY-%` AND (chart_no absent | test pattern) AND 결제0 AND EDI0 AND published0.

| C2 factor | freeze-9 result | verdict |
|---|---|---|
| name prefix | ✅ all 9 = `단계이동_{epoch-ms}` | matches |
| phone `DUMMY-%` | ❌ all 9 = real-format `+8210########`, `phone_dummy=false` | **FAILS dummy predicate** |
| chart_no absent/test | ❌ all 9 have real sequential `F-####` (F-4710…F-4934) | **real-suspect signal** |
| is_simulation | all 9 = `false` | (not flagged as sim) |
| 결제 (payments/service_charges/package_payments) | **0 / 0 / 0** | clean |
| EDI (insurance_claims) | **0** | clean |
| published 의무기록 (form_submissions / medical_charts) | **0 / 0** | clean — no 42501 immutability exposure |

**Behavioral evidence = automated test fixture**: name `단계이동_{ms}`, created ~03:00 KST daily (nightly Daily Build window 22–04시), 1/day cadence 7/14→7/21, ZERO financial/clinical/insurance/published footprint (only kanban status_transitions).

**BUT strict C2 identity confirmation is NOT met**: two real-patient-suspect signals fire per §C2 — (a) phone is NOT `DUMMY-%` (real +8210 format), (b) real `F-####` chart_no. Foot's nightly E2E fixtures do NOT follow the scalp2 `DUMMY-%`+no-chart convention; they register with valid-format phone + auto-assigned chart_number.

**Chart-continuity**: freeze-9 F-#### are interleaved with **196 real patients** in F-4710…F-4934 (real neighbors F-4711/4766/4801/4931/4935 confirmed). chart_number is auto-drawn from the *shared real sequence* → presence ≠ real patient, but interleaving is why identity field-confirm is warranted before delete.

→ **dev does NOT self-clear C2.** Per §C2 real-suspect rule → recommend responder 현장확인 on identity (are `단계이동_*` your nightly E2E fixtures? confirm no manual real registration collided into this name pattern) before scope lock.

---

## C3 — FK child census (machine-enumerated via pg_constraint, contype='f')

Parents: customers, reservations, check_ins. Full FK graph enumerated (NOT hand-listed) — **59 FKs** total, exceeds DA's 6-table hypothesis. Additional children confirmed beyond hypothesis: health_q_results/tokens, consultation_notes, customer_consult/treatment/special_memos, notifications, notification_logs, message_logs, status_transitions, checklists, timer_records, check_in_services, clinical_images, treatment_photos, consent_forms, prescriptions, insurance_documents/receipts, package_credit_ledger, packages, patient_past_history, patient_file_records, etc.

### Child ROW counts for the freeze set (all child tables)
| child (via) | rows | on_delete (confdeltype) |
|---|---|---|
| `status_transitions` (check_in_id) | **7** | `c` CASCADE |
| **all other 56 FK children** | **0** | — |

Zero-row children include every financial/clinical/insurance/published/consent/memo/reservation table. The ONLY existing children are 7 kanban stage-move logs (CASCADE).

### confdeltype risk classification (for freeze set)
- `c` CASCADE with rows: **status_transitions only (7 rows)** → auto-deleted, safe.
- `n` SET NULL (silent 순소실 risk): clinical_images, health_q_results/tokens, medical_charts, notification_logs, notification(ci), payment_items, prescriptions, receipt_ocr_results, treatment_photos — **all 0 rows in freeze set → no silent orphan risk.**
- `r`/`a` RESTRICT/NO ACTION (blockers): payments, service_charges, packages, package_payments, package_credit_ledger, insurance_*, form_submissions, consent_forms, checklists, consultation_notes, customer_*_memos, patient_*, reservations, etc. — **all 0 rows → will not block.**

→ Structurally this is a **pure stub** (only CASCADE kanban logs, no blocker/silent-loss/financial/clinical children). Per §C4 this maps to the §4-B lightweight-eligible shape — **subject to C2 identity confirmation above.** Path (§4-B vs §1) NOT self-selected (dev 자기선택 금지); deferred to DA 2차.

---

## C5 — T-20260630 overlap diff

- Backup dir: `~/foot-purge-backup-2026-06-30T0513/` (delete-target=453, preserve=26; pass2 dir also exists — DA-cited 28 likely union, immaterial here).
- **Freeze-9 ∩ (deleted 453 ∪ preserved 26) = ∅ (zero overlap).** None of the 9 ids appear anywhere in the 6/30 backup JSONs.
- Consistent with created_at 7/14–7/21 (all post-6/30). Confirms DA hypothesis: current residue = post-6/30 new accumulation (kanban-drag cleanup absent). No re-delete / mis-delete risk. 6/30 purge ledger NOT re-opened (별건 종결).

---

## Phase-1 conclusion → DA 2차 회부

1. Freeze set frozen: **9 customers + 6 check_ins + 0 reservations** (fixed PK list above; full-fidelity off-git).
2. C3 structural: pure stub, only 7 CASCADE status_transitions, no financial/clinical/insurance/published/blocker/silent-loss children → §4-B lightweight shape eligible.
3. **C2 identity NOT cleanly confirmed** — real-format phone (not DUMMY-%) + interleaved real F-#### chart_no fire §C2 real-suspect signals → recommend responder 현장확인 on `단계이동_*` fixture identity before scope lock.
4. C5: zero overlap with 6/30 — clean.
5. Awaiting DA 2차: C4 path confirm (§4-B vs §1) + freeze approval. **No DELETE until CONSULT-REPLY(apply-GO).**
