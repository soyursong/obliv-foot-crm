# dry-run evidence — T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI

- **owner**: dev-foot · **date**: 2026-08-10 · **change_class**: DATA_CORRECTION_BACKFILL · **artifact_class**: db_only
- **canonical_repo**: obliv-foot-crm · **project ref**: rxlomoozakkjesdqjtvd
- **DA GO**: da_decision_foot_f4741_cis_reinsert_kimgyuri_20260809.md (HEAD e16841f2f36) — 조건부 GO
- **§7 ADDENDUM census**: 전건 PASS (commit e4cd16bd, vg-census-evidence.md §7)
- **seller attestation**: 김주연 총괄 직접 확정 2026-08-10 08:07 (reply_ts 1786316619.427329, thread 1785492540.190029) → **seller_staff_id = `3a0c6774` (치료사 김규리)**. 동명이인 admin `d26717cb` = NON-target.
- **probe (No-Persistence)**: `scripts/T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI_dryrun.mjs` (persist 0)
- **oracle SQL (standalone)**: `db-gate/T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI_vg4_acceptance_oracle_dryrun.sql`
- **up / rollback**: `supabase/migrations/20260810120000_foot_f4741_b7ab6496_cosmetic_cis_reinsert.sql` (+ `.rollback.sql`)

---

## freeze-set (명시 VALUES — 임의 값 창작 0, Tier2 지문)

| # | new cis PK (고정) | service_id | service_name | price | seller_staff_id |
|---|---|---|---|---|---|
| 1 | `ab3c1841-3557-419c-9d0d-1acbfa961c1d` | `89095450-223f-4863-89a9-c7f32f62809d` | 풋샴푸 (200ml) | 42,000 | `3a0c6774` (김규리 therapist) |
| 2 | `47eb9b88-b595-46af-a183-c32c720b6845` | `e17ba3a3-4842-4097-87bc-0778a64d2755` | Care Toe Band (CTB) | 15,000 | `3a0c6774` |
| 3 | `515a6214-b038-4f45-8869-5dfd1db151da` | `cb6443a3-fe53-40e7-bd51-a4444d8a8966` | 리페어 핸드크림 (30ml) | 16,000 | `3a0c6774` |

- **parent check_in**: `dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf` (therapist_id=3a0c6774, status=done, visit_type=returning, checked_in_at 2026-08-01 10:02 KST, customer 김병완 F-4741 259abd32, clinic 74967aea)
- **payment**: `b7ab6496-9efc-429c-9d5c-60a248eabc15` = 73,000 (active, payment_type=payment, accounting_date 2026-08-01, parent_payment_id=null)
- **Σ 라인 = 42,000+15,000+16,000 = 73,000 == b7ab6496.amount** ✓ (산술폐합)
- **provenance (per-row)**: 품목/단가 = Tier2 (cis archive/audit 부재 → payment-line 지문 + KIMBB-REMOVE closed SSOT '73,000=8/1 유지단건' + 활성 풋화장품 카탈로그 정확가 매칭 = fabrication-proof). seller = 현장 attestation(김주연 총괄, therapist 3a0c6774).

## freeze re-assert (drift 0)
- payment amount=73,000 · status=active ✓
- check_in checked_in_at=2026-08-01… · therapist_id=3a0c6774 (=seller) ✓
- 3 services 전건 active=true · is_insurance_covered=false ✓
- seller staff `3a0c6774` role=therapist · active=true (attestation 정합) ✓

## No-Persistence dry-run 결과 — **PASS**

```
✅ VG2 freeze re-assert PASS (drift 0)
📊 DRYRUN DELTAS: rev=0 pay=0 sc=0 cos=73000
✅ 4-delta oracle ALL PASS (rev=0 · pay=0 · sc=0 · cos=+73000)
✅ post-probe 무영속 재확인: 3 고정 PK count=0 · check_in 화장품 cis=0 (persist 0)
✅ ledger: schema_migrations 20260810120000 applied=0 (un-applied 확인)
raw: "ERROR: P0001: VG4_DRYRUN_DELTAS rev=0 pay=0 sc=0 cos=73000" → RAISE EXCEPTION 전체 ROLLBACK
```

**baseline**: rev[2026-08-01]=1,922,700 · payments(dec7e6c4)=2 · service_charges(dec7e6c4)=6 · 김규리 화장품 sum=364,000 · 화장품 cis on check_in=0.

### 4-delta oracle 해석 (AC4 zero-sum · 매출총액 무영향)
- **rev delta = 0** — `v_daily_revenue`(payments 수납 grain) 무변동 → cis⊥payments 축직교 실증. 매출총액 이중계상 없음.
- **pay delta = 0** — 2번째 payment 자동생성 0 → 결제행 재유입 없음 (b7ab6496 73,000 1회 계상 유지).
- **sc delta = 0** — service_charges 명세 자동파생 0 (화장품 is_insurance_covered=false → snapshotCoveredServiceCharges 구조적 제외 · 직접 cis INSERT PMW 미경유). insurance-split 축(급여/비급여/공단) 이동 0.
- **cos delta = +73,000** — 김규리(3a0c6774) 화장품 breakdown 정확히 3라인분 반영 → SalesStaffTab 8월 매출 착지처(AC3, apply 후 화면 확인). (364,000 → 437,000)

## 멱등 / 순소실 0 / 롤백
- **멱등**: 고정 PK + (check_in_id, service_id, price, voided_at IS NULL) NOT EXISTS 가드 + ON CONFLICT (id) DO NOTHING. 재실행 rows=0.
- **archive-first**: apply.mjs 가 INSERT 직전 dec7e6c4 현 cis 5행 before-image 스냅샷 (rollback 원본). INSERT 이므로 소실 원천 無 → 순소실 0.
- **rollback**: `20260810120000_..._reinsert.rollback.sql` — 고정 PK 3건 DELETE (business-key 보조 술어 check_in_id·seller·service_id 동봉 = 오삭제 방어). 재실행 멱등(rows=0).
- **outbox/도파민 무접촉**: check_in_services 결속 트리거 0건 (VG-add-2) → cis INSERT 하류 emit/push 불발생. apply POSTCHECK 에서 outbox 신규0·도파민 push0 확인차 유지.

## apply 순서 (dev 미착수 — supervisor lane)
1. dev-foot: freeze-set + No-Persistence dry-run PASS → **deploy-ready** (본 문서 시점). ← **HERE**
2. planner: 박민지 per-row comp-gate 트리아지 (seller 귀속=인센티브 영향 여부, 총괄 waive 여부). deploy-ready 후 병행, apply 前 settled.
3. supervisor: DB-GATE **GO-token** 발행 → prod apply (`apply.mjs` 또는 up.sql, guard chokepoint) → evidence-based probe (rev=0/pay=0/sc=0/cos=+73000, new_pk=3) → applied_at 기입 → deployed.
4. AC3 확인: SalesStaffTab 김규리 8월 매출 73,000 표시.

> **apply_before_go 금지**: GO-token 前 prod DDL/DML 선-apply 없음. 본 dry-run 은 persist 0 (post-probe/ledger 무영속 실증). deploy-ready ≠ apply 착수.
