# MIG-GATE Evidence — T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE

**repo**: obliv-foot-crm · **prod ref**: rxlomoozakkjesdqjtvd · **적용일**: 2026-07-14
**게이트**: ADDITIVE + DA GO(Q2 승인, 본 요청 발신) → autonomy §3.1 대표 게이트 면제. supervisor DDL-diff 게이트만.
**risk_verdict**: GO_WARN

## 스코프
closing_manual_payments 에 soft-void 메타 3컬럼 ADDITIVE 신설 + 전 합산경로(foot) `WHERE voided_at IS NULL` 필터 원자배포.
- DDL: `voided_at timestamptz NULL` / `voided_reason text NULL` / `voided_by text NULL`
- 합산경로 (a): 일마감(Closing.tsx L584) grossTotal — 수기결제 로드 쿼리 `.is('voided_at', null)`
- 합산경로 (b): 매출집계(SalesDailyTab.tsx L162) 비급여버킷(revenue_insurance_split §2-1 산식 소스) — 수기결제 로드 쿼리 `.is('voided_at', null)`
- 합산경로 (c): 상담의사별 매출(SalesDoctorTab.tsx L151) 비급여 UNION(AC-3 수기수납 보강경로) — 수기결제 로드 쿼리 `.is('voided_at', null)` ★QA NO-GO(phase1) 보강 2026-07-17: 최초 제출 시 (c) 누락 → soft-void 실사용 시 grossTotal/(b)와 상담의사별 매출 정합 파탄 위험. 본 수정으로 "전 합산경로" 완결.

### 합산 read 경로 전수 스캔 자가검증 (`grep -rn closing_manual_payments src/`)
| # | 경로 | 종류 | 필터 |
|---|------|------|------|
| a | src/pages/Closing.tsx L584 | 합산 read (grossTotal) | `.is('voided_at', null)` ✓ |
| b | src/components/sales/SalesDailyTab.tsx L162 | 합산 read (비급여버킷) | `.is('voided_at', null)` ✓ |
| c | src/components/sales/SalesDoctorTab.tsx L151 | 합산 read (상담의사별 비급여 UNION) | `.is('voided_at', null)` ✓ |
| — | src/pages/Closing.tsx L654 | Realtime 구독(postgres_changes) | 합산 아님, 제외 |
| — | src/pages/Closing.tsx L1346 | `.delete()` 뮤테이션 | 합산 아님, 제외 |
| — | src/pages/Closing.tsx L2365/2369 | `.insert()` 뮤테이션 | 합산 아님, 제외 |

→ 합산 read 3경로(a/b/c) 전부 `WHERE voided_at IS NULL` 적용. 구독/뮤테이션 경로는 합산 대상 아님(정당 제외). "전 합산경로(foot)" 완결.

## MIG-GATE 4필드

### mig_files
- up:       `supabase/migrations/20260714190000_closing_manual_payments_softvoid.sql`
- rollback: `supabase/migrations/20260714190000_closing_manual_payments_softvoid.rollback.sql` (DROP COLUMN IF EXISTS ×3)
- runner:   `scripts/apply_20260714190000_closing_manual_payments_softvoid.mjs`

### mig_dryrun — PASS (No-Persistence Protocol)
`DRYRUN=1 node scripts/apply_20260714190000_*.mjs`
- txn-control strip: up.sql 내장 BEGIN/COMMIT 제거 후 `BEGIN..ROLLBACK` 재래핑 실행 (sentinel 신뢰 금지)
- exec: `201 []`
- post-probe(별 커넥션 introspection): dry-run 전후 대상 컬럼 수 불변(0건) → **DDL 미영속 실증**
- 결과: `✅ 무영속 확인(post-probe)`

### mig_ledger_check — 3자 대사 (원장 ↔ 파일 ↔ prod)
`LEDGER=1 node scripts/apply_20260714190000_*.mjs`
- file 선언:  `[voided_at, voided_reason, voided_by]`
- prod 실재:  3컬럼 전부 존재, 전부 `is_nullable=YES` (timestamptz / text / text)
- 원장(schema_migrations 20260714190000): `[]` (미기재)
- **판정**: prod ↔ file **2자 일치(정본 확립, GO)**. 원장 미기재는 **drift 아님** — foot 는 manual-apply 스크립트가 schema_migrations 를 갱신하지 않는 systemic 관례(직전 sibling `20260714180000_clinics_hira_*` 도 동일하게 원장 미기재). ledger_reconciliation 단일표준 §"정본=prod실재" → forward-doc 처리, unilateral 삽입 지양(sibling 관례 정합 유지).

### mig_rollback — 준비 완료
- rollback.sql: `DROP COLUMN IF EXISTS` ×3 (멱등)
- ⚠ 롤백 순서: 코드(WHERE voided_at IS NULL) 롤백 → DDL 롤백 (컬럼 선제거 시 PostgREST "column does not exist")
- forward-only 컬럼(전건 NULL) → 롤백 시 데이터 손실 0

## 원자배포 검증지문 (net-zero)
APPLY 직후:
- 컬럼 3건 신설 확인
- `SELECT count(*), count(voided_at) FROM closing_manual_payments` → `{total:8, voided:0}`
  = 기존 8행 전부 voided_at=NULL → 유효행=전건 → **3버킷(급여본인/비급여/공단부담) 합계 불변**

## 배포 순서 (Vercel auto-deploy 정합)
1. dry-run (No-Persistence) → PASS
2. **DDL apply to prod** (ADDITIVE, old code 무영향) ✅
3. code push → main → Vercel deploy (new 필터가 존재하는 컬럼 조회, 전건 NULL → net-zero)
4. deploy-ready 마킹 → supervisor DDL-diff 게이트 + QA

## 스코프 밖 (미접촉)
- datalake/Silver 매출 팩트뷰 voided_at 필터 = DA가 agent-silver 에 별도 VIEW-SPEC 로 조율. **본 repo 미접촉.**
