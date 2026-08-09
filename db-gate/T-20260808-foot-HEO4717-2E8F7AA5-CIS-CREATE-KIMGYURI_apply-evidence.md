# T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI — PROD APPLY EVIDENCE

- **applied_at**: 2026-08-09T13:05:40+09:00
- **적용 주체**: dev-foot 직접 적용 (supervisor FIX-REQUEST MSG-20260809-130132-b7po `db_only_needs_apply` authorize: "적용 주체(supervisor prod-apply 또는 dev 직접 적용)가 PROD 적용 + 증거기반 probe 후 applied_at/mig_applied evidence 기록 → 자동 전이")
- **runner**: `scripts/T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI_apply.mjs` (Supabase Management API, project rxlomoozakkjesdqjtvd, **persist**)
- **mig_file**: `supabase/migrations/20260809100000_foot_heo4717_2e8f7aa5_ctb_cis_create.sql`
- **승인 체인**: DA CONSULT-REPLY MSG-20260809-100435-eiay (Q1 GO 조건부·verify-gated) → dev No-Persistence dry-run PASS (commit c5724133) → supervisor FIX-REQUEST authorize apply

## VG2 freeze re-assert (apply 직전 DRIFT 0)
- payment 2e8f7aa5 = 15,000 / active / payment ✔
- check_in c33dfc76 = 2026-07-28 / therapist 3a0c6774(김규리) / returning / done ✔
- service CTB e17ba3a3 = Care Toe Band (CTB) / 15,000 / active ✔

## VG1 archive-first (rollback 원본 = c33dfc76 기존 cis 6행)
재진-물리치료(4,690) · 비가열레이저(240,000) · 손발톱백선(0) · 발백선(0) · 바르토벤(0) · 터미졸크림(0). CTB 없음(무→유 CREATE 대상 확인).

## APPLY 결과 — evidence-based probe (실 persist 후)
| 축 | before | after | delta | 기대 | 판정 |
|----|--------|-------|-------|------|------|
| v_daily_revenue[2026-07-28] single_revenue | 8,441,360 | 8,441,360 | **0** | 0 | ✅ 축직교(cis⊥payments) |
| payments count (c33dfc76) | 5 | 5 | **0** | 0 | ✅ 진짜 이중계상 없음 |
| service_charges count (c33dfc76) | 1 | 1 | **0** | 0 | ✅ 명세 자동파생 0 |
| 김규리(3a0c6774) 화장품 breakdown sum | 349,000 | 364,000 | **+15,000** | +15,000 | ✅ 정확히 1라인 |
| 신규 cis PK 070652f3 count | 0 | **1** | +1 | 1 | ✅ 라인 생성 확인 |

**신규 행**: `{price:15000, check_in_id:c33dfc76, service_name:'Care Toe Band (CTB)', seller_staff_id:3a0c6774(김규리)}`

## ledger
- `supabase_migrations.schema_migrations` version `20260809100000` applied=**1** (기록 완료)

## DA re-CONSULT 트리거 미발동
rev delta 0(≠0 아님) / pay delta 0(+1 아님) / service_charges 자동파생 0 / cosmetic +15,000 정확 1라인 → 전 트리거 미발동, apply 안전 확정.

## rollback
`supabase/migrations/20260809100000_..._ctb_cis_create.rollback.sql` — 신규 PK 070652f3 DELETE (순소실 0·멱등).
