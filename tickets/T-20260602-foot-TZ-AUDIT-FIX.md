---
id: T-20260602-foot-TZ-AUDIT-FIX
ticket_id: T-20260602-foot-TZ-AUDIT-FIX
title: AC-7 후속 timezone 교정 — checked_in_at 일일경계 RPC/인덱스 KST 통일
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 14f7edd
deployed_at: null
bundle_hash: null
e2e_spec_exempt_reason: db_only
db_migration:
  - supabase/migrations/20260602250000_tz_checkin_kst_unify.sql
  - supabase/migrations/20260602250010_tz_checkin_index_kst_concurrent.sql
regression_risk: low
reporter: planner (MSG-20260602-221144-xpby)
created_at: 2026-06-02
---

# T-20260602-foot-TZ-AUDIT-FIX

## 지시 (planner, MSG-20260602-221144-xpby)
AC-7 후속 timezone 교정. `checked_in_at::DATE` 일일경계 비교(체크인카운트/대기번호)만 KST 통일.
dummy_progress_test 리터럴(~15건)·birth_date 입력캐스트는 false-positive 전량 제외.
idx_check_ins_clinic_date 함수인덱스 KST 정합 검토(CONCURRENTLY). 감사: _supervisor/tz_audit_20260602.md

## 근본 원인
`checked_in_at`(timestamptz, UTC 저장)을 `::date` 로 캐스팅 → 세션 tz(UTC) 기준 날짜.
비교 우변은 `(now() AT TIME ZONE 'Asia/Seoul')::date` = KST → 좌우 tz 불일치.
KST 오전(00:00~09:00) 체크인이 당일 집계/발번에서 누락. (FE는 DASHBOARD-KST-FILTER 로 기교정.)

## 수정 (활성 정의 4 + 인덱스 1)
- `next_queue_number`, `batch_checkin`, `self_checkin_with_reservation_link`(발번 159행),
  `assign_consultant_atomic`(상담사 당일 카운트): `checked_in_at::date` → `kst_date(checked_in_at)`.
- `idx_check_ins_clinic_date`: `(checked_in_at::date)` → `kst_date(checked_in_at)` 함수인덱스로
  CONCURRENTLY 재구성(이름 보존 RENAME). 쿼리 표현식과 통일해 plan 커버 회복.

## 범위 외 (false-positive / superseded — 감사 매트릭스 참조)
- dummy_progress_test ::date 리터럴 ~15건 → 테스트 시드, 제외.
- birth_date 등 입력 문자열→date 파싱 캐스트 → timestamptz 아님, 제외.
- initial_schema:365 next_queue_number(sql판), race_condition_fixes:82 batch_checkin(구판) → superseded, 제외.
- *.down.sql 롤백 파일 → 의도적 보존.

## AC
- AC-1: 4개 활성 RPC 가 `kst_date(checked_in_at)` 로 일일경계 비교 (apply DO 블록 + 스크립트 ASSERT).
- AC-2: KST 오전 경계 체크인이 당일 카운트/발번에 포함 (감사 수동 시나리오).
- AC-3: idx_check_ins_clinic_date 가 kst_date 표현식 함수인덱스로 재구성, canonical 이름 유지.
- AC-4: false-positive(dummy/birth_date) 무변경, 시그니처·리턴 회귀 0.

## 검증
- npm run build ✓ (FE 무변경, lint/build 회귀 0 확인)
- DB 변경: 있음 (RPC 4 CREATE OR REPLACE + 인덱스 CONCURRENTLY 재구성).
- E2E(Playwright): 면제 — db_only (서버 tz/일일경계 로직, 브라우저 E2E 부적합).
  대체 검증: apply 스크립트 내장 ASSERT(함수 정의 kst_date / indexdef kst_date).
- 적용 순서(supervisor 게이트):
  1) `node scripts/apply_20260602250000_tz_checkin_kst_unify.mjs` (RPC, 트랜잭션 안전)
  2) `node scripts/apply_20260602250010_tz_checkin_index_kst_concurrent.mjs` (인덱스, CONCURRENTLY)
- 롤백: 동일 스크립트 `--rollback`.

## 산출물
- 감사: _supervisor/tz_audit_20260602.md
- migrations: 20260602250000_tz_checkin_kst_unify(.rollback).sql,
  20260602250010_tz_checkin_index_kst_concurrent(.rollback).sql
- scripts: apply_20260602250000_*, apply_20260602250010_*
