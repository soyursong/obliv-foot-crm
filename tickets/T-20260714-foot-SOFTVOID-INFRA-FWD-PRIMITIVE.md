---
ticket_id: T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE
id: T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-07-14
owner: agent-fdd-dev-foot
requester: agent-data-architect Q2 승인 (MSG-20260714-182105-296w)
approved_by: planner NEW-TASK MSG-20260714-182626-sevl
build_ok: true
spec_added: tests/e2e/T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE.spec.ts
db_changed: true
data_architect_consult: GO — 본 요청이 DA 발신(Q2 승인). ADDITIVE(신규 NULLABLE 3컬럼, 기존 data 불변) + DA GO → autonomy §3.1 대표 게이트 면제. supervisor DDL-diff 게이트만.
risk_level: GO_WARN (DA 지정) — closing_manual_payments 합산경로 2건에 WHERE voided_at IS NULL 필터. 전건 voided_at=NULL 배포 → net-zero. in-flight 4건과 write-path 비충돌(대상파일 미겹침).
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-07-14
deploy_commit: 33653bb1
commit_sha: 33653bb1
mig_files: up=20260714190000_closing_manual_payments_softvoid.sql / rollback=.rollback.sql / runner=apply_20260714190000_*.mjs
mig_dryrun: PASS — No-Persistence Protocol (txn-control strip + BEGIN..ROLLBACK 재래핑 + post-probe 무영속 실증, 전후 컬럼수 0 불변)
mig_ledger_check: prod↔file 2자 일치(정본 확립). 원장 미기재=foot manual-apply systemic 관례(sibling 20260714180000 동일), drift 아님 → forward-doc.
mig_rollback: DROP COLUMN IF EXISTS ×3 준비. 롤백 순서=코드 필터 롤백 → DDL 롤백. forward-only(전건 NULL) 데이터손실 0.
db_gate_evidence: db-gate/T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE_evidence.md
field_soak_gate: 실 Galaxy Tab — 일마감 grossTotal + 매출집계 비급여버킷 동일기간 합계 배포 전후 불변(net-zero) 현장 confirm
---

# T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE — soft-void 인프라 forward 프리미티브

## 요청 (NEW-TASK, planner P1 — MSG-20260714-182626-sevl / DA Q2 승인)

closing_manual_payments 에 soft-void(무효화) 실행의 pre-condition 이 되는 **forward 프리미티브** 인프라 선행 구축.
soft-void 실행 티켓이 무효행을 만들기 전에, (1) 무효화 메타 컬럼과 (2) 전 합산경로의 무효행 배제 필터를 먼저 배포한다.

## 스코프 (foot 전용)

1. **ADDITIVE DDL** — `closing_manual_payments`
   - `voided_at timestamptz NULL` / `voided_reason text NULL` / `voided_by text NULL`
   - 멱등 가드(IF NOT EXISTS) + 롤백(DROP COLUMN IF EXISTS ×3). 파괴적 DDL 0.

2. **전 합산경로 `WHERE voided_at IS NULL`** (foot 스코프)
   - (a) FE 일마감 grossTotal — `src/pages/Closing.tsx` 수기결제 로드 쿼리 `.is('voided_at', null)`
         → totals(grossTotal) / enrichedRows / daily_closings payload 전부 무효행 배제
   - (b) 마감확정 payload 비급여버킷 — `src/components/sales/SalesDailyTab.tsx` 수기결제 로드 쿼리 `.is('voided_at', null)`
         → left.taxfree(비급여) / 우측 매트릭스 / 현금시재 전부 무효행 배제 (revenue_insurance_split §2-1 산식 소스)

3. **원자배포** — DDL 선적용(ADDITIVE, old code 무영향) → 코드 push(Vercel). 검증지문: 전건 voided_at=NULL → 3버킷 합계 불변.

## 스코프 밖
- datalake/Silver 매출 팩트뷰 voided_at 필터 = DA가 agent-silver 에 별도 VIEW-SPEC 조율. **본 repo 미접촉.**

## 조율 노트 (in-flight 4건)
동일 closing_manual_payments/일마감 축 동시작업(RETRO-BACKFILL / DAILYCLOSE-MISU / CUSTBOX-UNPAID-SYNC / SAMEDAY-REMAP)과
**write-path 비충돌** — 본 티켓은 read/합산경로 2파일(Closing.tsx 쿼리·SalesDailyTab.tsx 쿼리)만 수정, 상기 티켓의 write-path 수정과 파일/라인 미겹침.
DA 명시: forward 프리미티브는 RETRO/MISU 정정과 **독립**(forward 전용, 방향 뒤집기 아님). 본 인프라 선행배포 = soft-void 실행 티켓 pre-condition.

## 게이트/증적
- MIG-GATE 4필드 = frontmatter + `db-gate/T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE_evidence.md`
- 빌드 OK · spec 2 시나리오(일마감/매출집계 각 필터+회귀)
- 남은 게이트: supervisor DDL-diff + QA → 현장 field-soak
