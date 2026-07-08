---
id: T-20260708-dopamine-NAILSUBFILTER-AC3-STEP1-FOOTPUSH
domain: foot
priority: P2
status: deploy-ready
qa_result: pending
deploy_commit: b9d0b041
deployed_at: 2026-07-08 (STEP1 정식 승격·prod 실재 검증 완결. 부모 T-20260708-FOOTRESV-NAILPROB-SUBFILTER-PUSH 코드체인 410a9762→7a9c56d5→b9d0b041 이미 prod 반영 확인 + 원장 forward-doc reconcile)
bundle_hash: n/a (DB RPC + Edge Function — FE 번들 무변경)
db_change: true
summary: "부모 티켓 AC3(도파민 문제성발톱 선택→풋 예약상세 팝업>간략메모 동기화) field-soak 미충족 해소 STEP1 = foot 수신부(upsert_reservation_from_source RPC p_brief_note 배선 + reservation-ingest-from-dopamine EF brief_note 배선). planner 진단='foot STEP1 미배포(ledger/bus deploy 이벤트 0건)' → dev-foot prod 실측 결과: RPC/EF/컬럼 全 이미 prod 반영(부모 코드체인 배포 완료) + functest 3/3 green. 실제 유일 gap=schema_migrations 원장에 20260708150000 미기록(management API database/query 적용이 원장 자동기록 안 됨=ledger drift) → 이것이 planner가 관측한 'deploy 이벤트 0건'의 정체. Ledger Reconciliation SSOT '정본(prod 실재) 기준 forward-doc' 분기로 원장에 기적용 마이그 정직 기록(idempotent ON CONFLICT DO NOTHING). scope=20260708150000 단건(historical drift 전면 백필은 별도 LEDGER-DRIFT-SWEEP 소관, 확대 금지). end-to-end AC3(도파민 선택→push→풋 간략메모)는 STEP2(dopamine EF/FE 실배포, dev-dopamine)와 결합 시 종결 — foot STEP1 critical path 해소 완료."
created: 2026-07-08
assignee: dev-foot
owner: agent-fdd-dev-foot
parent_ticket: T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH
e2e_spec: tests/e2e/T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH.spec.ts
edge_function: supabase/functions/reservation-ingest-from-dopamine/index.ts
da_gate: "GO+ADDITIVE 승계 (부모 MSG-135334-y7uw / MSG-tjrg) — 신규 CONSULT·대표게이트 불요. supervisor DDL-diff only."
ssot_ref: "1_Projects/201_메디빌더_AI도입/foot_briefnote_push_da_decision_20260708.md (C1~C5)"
# ── MIG-GATE (db_change=true) 4필드 ──
mig_files: "supabase/migrations/20260708150000_foot_ingest_brief_note_wiring.sql (+ .rollback.sql). RPC 18-arg(p_brief_note 末尾 append) 재구현, 스키마 무변경 ADDITIVE(brief_note 컬럼 旣존 20260624100000)."
mig_dryrun: "부모 DRYRUN(BEGIN…ROLLBACK) green 기실행. 본 티켓 prod 실측 재검증: pg_get_functiondef 18-arg 단일 오버로드 + INSERT brief_note=NULLIF(btrim(p_brief_note),'') + ON CONFLICT COALESCE-preserve 모두 실재 확인. functest 3/3 green(신규 발톱무좀 착지 / 빈값 재push COALESCE 보존 / 편집 내성발톱 갱신)."
mig_ledger_check: "착수 시 schema_migrations에 20260708150000 ABSENT(=planner '미배포' 관측 정체, ledger drift). Ledger Reconciliation SSOT forward-doc(정본=prod 실재, 함수 실재+functest green 확인됨)로 원장 row 정직 기록: INSERT … (version,name,statements,rollback) ON CONFLICT(version) DO NOTHING. 사후 재조회 = 20260708150000 foot_ingest_brief_note_wiring recorded ✅. scope=단건(historical 전면 백필 미포함)."
mig_rollback: "supabase/migrations/20260708150000_foot_ingest_brief_note_wiring.rollback.sql (18-arg 명시 DROP → 17-arg body[20260701020000, timeline+가드#5] 복원. brief_note 컬럼은 본 migration 생성물 아님→미DROP)."
---

# T-20260708 NAILSUBFILTER-AC3-STEP1-FOOTPUSH — 부모 AC3 field-soak 미충족 STEP1 완결

## 배경 (planner NEW-TASK, 박민지 팀장 현장 피드백)

도파민 예약확정 팝업에서 문제성발톱 하위증상 필터 선택(1~3단계 정상)했으나 **풋CRM 예약상세 팝업 > 간략메모에 동기화(4단계/AC3) 안 됨.**

planner 진단(증거기반): dopamine STEP2(66d661d)는 code-complete·deploy-ready이나, foot STEP1(upsert_reservation_from_source RPC의 p_brief_note 배선)이 **미배포**로 추정 — signals/bus에 foot p_brief_note deploy 이벤트 0건.

## dev-foot prod 실측 결과 (착수 검증)

| 항목 | 상태 |
|------|------|
| RPC 18-arg p_brief_note (prod) | ✅ 단일 오버로드, INSERT/ON CONFLICT 배선 실재 |
| RPC functest 3/3 (prod) | ✅ 신규 착지 / 빈값 COALESCE 보존 / 편집 갱신 |
| ingest EF reservation-ingest-from-dopamine | ✅ ACTIVE v19, brief_note + duplicate-분기 UPDATE 배선 실재(eszip 확인) |
| reservations.brief_note 컬럼 | ✅ text (旣존 20260624100000) |
| **schema_migrations 원장 20260708150000** | ❌ **ABSENT → 이것이 planner '미배포' 관측 정체** |

## 조치

- **코드/RPC/EF/컬럼**: 부모 코드체인(410a9762→7a9c56d5→b9d0b041)에서 이미 prod 반영 완료 — 신규 코드 변경 불요.
- **원장 forward-doc reconcile**: management API `database/query` 적용은 schema_migrations에 자동기록되지 않음(ledger drift). Ledger Reconciliation SSOT의 '정본(prod 실재) 기준 forward-doc' 분기로 20260708150000 원장 row 정직 기록(idempotent). MIG-GATE mig_ledger_check 충족.
- scope: 단건만. 20260701020000/20260630* 계열 historical drift 전면 백필은 별도 T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP 소관(확대 금지).

## 배포 순서 (부모 §7)

STEP1(foot RPC+EF+원장) ✅ 완결 → dopamine EF(foot-reservation-push deploy)+FE 실배포(dev-dopamine) → end-to-end AC3 종결. **foot STEP1 = 유일 critical path → 해소 완료.**

## supervisor QA (DDL-diff only)

1. RPC 18-arg 단일 signature + brief_note INSERT/ON CONFLICT COALESCE-preserve DDL-diff 확인.
2. functest 3/3 green 재현(발톱무좀 착지/빈값 보존/내성발톱 갱신).
3. 원장 20260708150000 기록 확인.
4. (STEP2 결합 후) end-to-end: 도파민 문제성발톱 선택→push→풋 예약상세 간략메모 하이라이트 field-soak.
