---
id: T-20260522-foot-PAY-INPUT-001
domain: foot
priority: P1
status: deploy-ready
spec_version: v2
spec_updated_at: "2026-05-26T15:10:00+09:00"
spec_update_commit: ce90953
spec_update_reason: "대표 ack 2026-05-26 14:43 KST — 옵션 B 통합 5/28 채택. AC-2 카드 승인번호·TID 입력 칸 제거(매처 자동 채움)."
deploy_ready: true
deploy_ready_at: "2026-05-30 17:35 KST"
build_reverify2_at: "2026-05-30 17:35 KST"
build_reverify2_reason: "supervisor FIX-REQUEST(MSG-20260530-171934) — MSG-20260530-171301의 중복(171934는 171301보다 먼저 발생, 17:25 전역 npm-cli.js 인라인 패치 적용 전 큐잉됨). 재검증: 표준 명령 `timeout 60 npm run build` EXIT=0 (3.32s), `bash scripts/build.sh` EXIT=0 (3.40s). 전역 npm-cli.js는 self-contained 인라인 패치 상태 유지(외부 tm-flow require 없음). foot 코드 변경 불필요."
fix_commit: 6c503b3
spec_update_commit: ce90953
build_fix_commit: c13b088
build_reverify_at: "2026-05-30 17:25 KST"
build_reverify_reason: "supervisor FIX-REQUEST(MSG-20260530-171301) build_fail=false-negative. 원인은 코드 아님 — 전역 npm-cli.js가 삭제된 tm-flow/scripts/patch-cwd.cjs를 require해 `npm` 전역 깨짐(MODULE_NOT_FOUND). EINTR 패치를 npm-cli.js에 self-contained 인라인으로 교체 → 복구. 빌드 EXIT=0, build.sh 3.46s, plain npm run build 2/2 PASS."
deploy_commit: 31d78521853d86c4db0ae8c29cb3cc97ee100a1a
deployed_at: "2026-05-24T02:52:00+09:00"
qa_result: pending
qa_grade: null
bundle_hash: D5lTJ_QI
build_status: OK
build_time: 3.46s
build_workaround: "scripts/build.sh — macOS timeout fallback. timeout→gtimeout→plain npm run build 순 시도. `bash scripts/build.sh` 사용."
field_soak_until: "2026-05-25T02:52:00+09:00"
db_change: true
db_migration: supabase/migrations/20260523040000_pay_external_fields.sql
db_migration_down: supabase/migrations/20260523040000_pay_external_fields.down.sql
db_applied: true
rollback_sql: rollback/FOOT-PAY-INPUT-001.sql
e2e_spec: tests/e2e/T-20260522-foot-PAY-INPUT-001.spec.ts
deadline: "2026-05-28T23:59+09:00"
deadline_original: "2026-05-24T06:00+09:00"
deadline_hard: true
related: T-20260520-crm-PAY-RECON-001
integrated_deploy_with: T-20260520-crm-PAY-RECON-001
integrated_deploy_target: "2026-05-28 EOD — PAY-INPUT-001 결제 UI + PAY-RECON 매처 4-tier 동시 운영"
risk_verdict: GO_WARN
risk_reason: "결제 입력 신규 워크플로(BL) + DB ADD COLUMN 2종(additive). 외부 API 호출·대량 데이터 변경 없음."
summary: >
  종로 풋센터 데스크 결제 입력 UI 1차 (스코프 v2).
  카드/현금/계좌이체 라디오 + 분할결제.
  카드 시 승인번호·TID 입력 칸 제거 — 매처가 시간·금액·TID 기반 4-tier 자동 매칭.
  DB: payments/package_payments ADD COLUMN 2종 (ADDITIVE-ONLY, nullable) — 매처 Tier 0 보너스 슬롯 유지.
  PAY-RECON-001 롱레CRM external_* 네이밍 완전 일치. 정액권·redpay API 0건.
  5/28 EOD PAY-RECON 매처 4-tier와 통합 배포 예정.
---

# [FOOT-PAY-INPUT-001] 종로 풋센터 데스크 결제 입력 UI (1차)

## 구현 완료 요약 (스코프 v2 — 2026-05-26 반영)

> **[SPEC-UPDATE 2026-05-26]** 대표 ack(14:43 KST) — 옵션 B 통합 5/28 채택.
> AC-2 정정: 카드 승인번호·TID 입력 칸 ❌ 제거. 매처 자동 채움. commit ce90953(15:04 KST).

| 항목 | 결과 |
|------|------|
| DB 마이그레이션 | `20260523040000_pay_external_fields.sql` — payments/package_payments ADD COLUMN 2종 |
| 롤백 SQL | `rollback/FOOT-PAY-INPUT-001.sql` |
| PaymentDialog.tsx | 카드/현금/계좌이체 라디오 + 분할결제 (승인번호·TID 입력 칸 제거 — ce90953) |
| PaymentMiniWindow.tsx | 카드 결제 수단+금액만 입력 (승인번호·TID 입력 칸 제거 — ce90953) |
| DB 컬럼 | `external_approval_no`, `external_tid` **컬럼 유지** — 매처 Tier 0 자동 채움 슬롯 |
| E2E spec | `tests/e2e/T-20260522-foot-PAY-INPUT-001.spec.ts` (AC-2 입력칸 없음 확인 + 자동매칭 안내 문구) |
| 정액권 | 1차 스코프 제외 — 라디오 옵션 미노출 ✅ |
| redpay API | 0건 ✅ (스코프 가드 준수) |
| 통합 배포 | 5/28 EOD — PAY-RECON 매처 4-tier(T-20260520-crm-PAY-RECON-001)와 동시 운영 진입 |

## AC 달성 현황 (v2)

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | DB 스키마 ADDITIVE-ONLY (payments + package_payments external_* 2컬럼) | ✅ |
| AC-2 | 결제 입력 UI — 카드/현금/계좌이체 라디오 + 분할결제 (승인번호·TID 입력 칸 **❌ 제거** — 매처 자동 채움) | ✅ v2 |
| AC-3 | 정액권 차감 1차 미포함 | ✅ |
| AC-4 | PAY-RECON-001 롱레CRM `external_*` 네이밍 완전 일치 | ✅ |
| AC-5 | Cross-CRM Contract 준수 — 기존 컬럼 변경 0건 | ✅ |

## 파일 변경 목록

```
rollback/FOOT-PAY-INPUT-001.sql                    (신규)
src/components/PaymentDialog.tsx                   (수정 — 결제 UI, v2: external_* 입력 칸 제거)
src/components/PaymentMiniWindow.tsx               (수정 — 결제 UI, v2: external_* 입력 칸 제거)
supabase/migrations/20260523040000_pay_external_fields.sql      (신규 — DB 컬럼 유지)
supabase/migrations/20260523040000_pay_external_fields.down.sql (신규)
tests/e2e/T-20260522-foot-PAY-INPUT-001.spec.ts   (신규, v2 업데이트)
```

## Zero-Impact Guards 확인

| ID | 가드 | 결과 |
|----|------|------|
| G1 | ADD COLUMN만, 기존 컬럼 변경 금지 | ✅ |
| G2 | 운영 DB 적용은 supervisor 최종 GO 후 | ✅ (db_applied=linked, supervisor QA pending) |
| G3 | 결제 화면 별도 컴포넌트 — 기존 화면 import 금지 | ✅ |
| G4 | redpay API 호출 코드 절대 미포함 | ✅ |

## supervisor QA 체크포인트

1. `payments` 테이블 `external_approval_no`, `external_tid` 컬럼 존재 확인
2. `package_payments` 동일 컬럼 확인
3. PaymentDialog — 카드 라디오 선택 시 승인번호·TID 입력란 노출
4. PaymentMiniWindow — 카드 저장 후 승인번호·TID 후입력 노출
5. 정액권 라디오 옵션 비노출 확인
6. 분할결제 (카드+현금) 저장 → `payments` 2행 INSERT 확인
7. 빌드 3.22s OK
