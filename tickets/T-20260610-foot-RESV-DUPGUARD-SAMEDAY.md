---
id: T-20260610-foot-RESV-DUPGUARD-SAMEDAY
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-06-10 10:25
completed: 2026-06-10
deadline: 2026-06-12
db_changed: true
db_migration: supabase/migrations/20260610100000_reservation_dup_guard_fn.sql
db_migration_2: supabase/migrations/20260610100010_reservations_customer_daily_unique.sql
db_rollback: supabase/migrations/20260610100000_reservation_dup_guard_fn.rollback.sql
db_rollback_2: supabase/migrations/20260610100010_reservations_customer_daily_unique.rollback.sql
db_deployed: full   # RPC + partial UNIQUE index 모두 적용 완료(2026-06-10 Step3 집행)
db_gate: DONE
db_gate_status: done   # 김주연 총괄 Y-CONFIRM(reply_ts 1781056892.979629) → dedupe 14row + index 적용 종결
db_gate_steps: DONE   # Step3.1 dedupe(14row cancelled) / 3.2 재조사 0건 / 3.3 index 적용 / 3.4 검증
rpc_deployed: true
index_deployed: true
confirm_request_msg: MSG-20260610-103454-vrv6
confirm_reply_ts: 1781056892.979629
step3_report: scripts/out/resv_dedupe_step3_execution_report.md
e2e_spec: tests/e2e/T-20260610-foot-RESV-DUPGUARD-SAMEDAY.spec.ts
risk_verdict: GO_WARN
risk_reason: "FE 가드 standalone(fallback SELECT)로 무중단 즉시 동작. RPC는 read-only 추가(supervisor 적용 게이트). index는 prod 활성중복 13그룹 존재 → dedupe+사람확인 후 supervisor 적용(GO_WARN)."
data_arch_consult: "비해당 — 함수+인덱스만 추가, 신규 컬럼/테이블/enum 없음(§S2.4 CONSULT gate 미적용)"
author: dev-foot
---

# T-20260610-foot-RESV-DUPGUARD-SAMEDAY — 대시보드 당일 동일고객 예약 중복 생성 방지 (P1)

## 상태

**deploy-ready · DB 게이트 종결** (FE 가드 동작·빌드·spec·E2E 6 passed, RPC + index 모두 적용).
**DB index = 적용 완료** — 김주연 총괄 Y-CONFIRM("웅 진행ㄱ", reply_ts 1781056892.979629) 후 Step3 집행:
Step3.1 dedupe 14 row 논리삭제(cancelled) → 3.2 재조사 활성중복 0건 → 3.3 `idx_reservations_customer_daily` 적용 → 3.4 pg_indexes 검증 통과.
확정 override: 류복화 05-24 KEEP=checked_in(7dba8647)/CANCEL=noshow(e061d191) — 실제내원 보존. 김창재 05-20 KEEP=checked_in(cf9d146a)/CANCEL=동시간중복(422f364e).
집행 리포트: `scripts/out/resv_dedupe_step3_execution_report.md`.

## Root Cause

`Dashboard.tsx` `QuickReservationDialog.handleSave` 의 `reservations` INSERT 가
동일고객(customer_id/phone) + 당일(reservation_date) 중복 생성을 막지 못함.
기존 중복 가드는 `reservation_id` 기준(체크인 단계 `unique_reservation_checkin`)만 존재 →
**신규 예약 생성 경로는 무방비**. 체크인 완료(`status='checked_in'`) 고객도 또 예약이 생성됨
(현장 증거 첨부 **F0B9CLQ1KRT**).

## 선행 정본 (병렬 가드 정의 금지)

`T-20260602-foot-SELFCHECKIN-DUP-GUARD` (키오스크 `check_ins` 가드)의
`fn_selfcheckin_dup_guard` + `idx_checkins_walkin_daily` 패턴을 **reservations 로 일관화**.
조회조건·반환형·이중방어 구조 동일.

## STEP1 그라운딩 게이트 (AC-0)

1. **데이터모델 분기 = (a)** reservations 당일 1건 강제. (b) cross-table(check_in 존재 시 차단) 미채택.
   - 근거: 증거 F0B9CLQ1KRT 의 중복은 `checked_in` **예약 row**(reservations 에 존재) →
     (a)가 활성(NOT cancelled) 예약으로 잡아 차단. cross-table 불요.
   - 한계(스코프 밖, 후속): reservation 없이 키오스크 워크인 check_in 만 있는 고객의 신규 예약은
     (a)로 안 잡힘 → 필요 시 별도 티켓(b 분기).
2. **취소 제외**: `status NOT IN ('cancelled')` — 취소 후 재예약 정상 동선 유지(AC-3 회귀 금지).
3. **prod dedupe 사전조사 (dry-run, READ-ONLY)**: `scripts/dedupe_reservations_customer_daily_dryrun.mjs`
   - 결과(2026-06-10): (clinic_id, customer_id, reservation_date) status<>cancelled **활성 중복 13그룹**
     (행별confirm 11 / QA일괄 2), phone-only(customer_id NULL) 중복 0.
   - → `idx_reservations_customer_daily` 생성 시 23505 실패 → **dedupe + 사람확인 선행 필수(GO_WARN hold)**.
   - 산출물: `scripts/out/resv_dedupe_dryrun_report.md`
4. **DB 게이트**: RPC/index 적용은 supervisor 사전이관 게이트. 롤백 SQL 동반(2종).

## 변경 사항

### FE (즉시 배포 — Vercel)
- `src/pages/Dashboard.tsx`
  - `checkReservationDupSameDay(clinicId, customerId, phone, date)` 헬퍼 신설.
    - 1차: 서버 권위 RPC `fn_reservation_dup_guard`.
    - fallback: 당일·클리닉 활성 예약 일괄 조회 후 클라 OR 매칭(customer_id / phone digits).
    - RPC 미배포 환경에서도 fallback 으로 graceful degrade → **무중단 즉시 동작**.
  - `handleSave` INSERT 직전 게이트: 중복 시 `toast.error` + abort.

### DB (supervisor GO_WARN 게이트 — db_deployed=false)
- `fn_reservation_dup_guard` RPC (read-only, CREATE OR REPLACE idempotent).
  적용 스크립트: `scripts/apply_20260610100000_reservation_dup_guard_fn.mjs` (dev-foot 미실행, supervisor 실행).
- `idx_reservations_customer_daily` partial UNIQUE (GATE-HOLD — dedupe 13그룹 정리 후 생성).

## Acceptance Criteria

- **AC-1**: 동일 customer_id 당일 활성 예약 존재 시 신규 예약 생성 차단 + 표준 에러 표시.
- **AC-2**: customer_id 미연결 워크인 예약도 phone(digits 정규화) 매칭으로 차단.
- **AC-3**: `status='cancelled'` 예약은 카운트 제외 → 취소 후 동일날 재예약 정상 허용(회귀 금지).
- **AC-4**: 타 날짜(reservation_date 상이) 예약은 오늘 가드에 무영향.
- **AC-5**: `checked_in` 예약도 활성으로 간주 → 체크인 완료 고객 재예약 차단(F0B9CLQ1KRT 재현).
- **AC-6**: 타 고객은 무영향.

## 현장 클릭 시나리오 (E2E 커버)

- **S1 중복차단**: 같은 고객 같은 날 두 번째 예약 클릭 → 차단 토스트.
- **S2 취소후재예약허용**: 예약 취소 → 같은 날 다시 예약 클릭 → 정상 생성.
- **S3 타고객·타날짜무영향**: 다른 고객/다른 날짜 예약 → 영향 없이 생성.

## 검증

- `npm run build` ✅ (2026-06-10 재검증, built in 3.78s — 브라우저 시뮬 준비 OK)
- E2E `tests/e2e/T-20260610-foot-RESV-DUPGUARD-SAMEDAY.spec.ts` — **6 passed** (재실행 2026-06-10 10:34 KST).
  RPC `fn_reservation_dup_guard` 가 prod 배포 확인되어 RPC 검증 블록도 passed(이전 GO_WARN skip 해소).
- dry-run 재실행(READ-ONLY, 2026-06-10 10:33 KST): 활성 중복 **13그룹**(행별confirm 11 / QA일괄 2) 동일 유지.

## FIX-REQUEST 조치 (MSG-20260610-102747-wa7d, supervisor)

- ✅ #3 E2E 실행결과 공유: **6 passed** (RPC 포함).
- ✅ #4 브라우저 시뮬 준비: build green → 시뮬 1회 수행 가능 상태 확인.
- ✅ RPC 배포 재검증: `fn_reservation_dup_guard` prod 존재 확인 / `idx_reservations_customer_daily` 미적용 확인.
- ⏳ #1 김주연 총괄 행별 confirm: responder 경유 요청 발행
  (시트 MSG-20260610-103454-vrv6 + 액션 MSG-20260610-103513-slrp, 확인시트 `scripts/out/resv_dedupe_confirm_request.md`).
- ⛔ #2 dedupe 실행 + index 적용: **#1 confirm 회신 대기 중 hold**
  (prod 파괴적 작업 → 사람 confirm 없이 집행 금지). confirm 도착 시: dedupe(취소처리) → 재조사 0건 → supervisor index 적용.

## supervisor 인계 (GO_WARN)

1. RPC 적용: `node scripts/apply_20260610100000_reservation_dup_guard_fn.mjs` (read-only, 무중단).
2. dedupe: dry-run 리포트(13그룹) 대표/총괄 행별 confirm → 활성 1건 keep, 나머지 `cancelled` 논리삭제.
3. 재조사 0건 확인 후 index 적용: `20260610100010_reservations_customer_daily_unique.sql`.
4. 실패 시 롤백 SQL 2종 사용.

## Author

dev-foot / 2026-06-10
