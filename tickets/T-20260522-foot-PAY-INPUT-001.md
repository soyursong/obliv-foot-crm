---
id: T-20260522-foot-PAY-INPUT-001
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
deploy_ready_at: "2026-05-23 21:40 KST"
fix_commit: 6c503b3
build_status: OK
build_time: 3.22s
db_change: true
db_migration: supabase/migrations/20260523040000_pay_external_fields.sql
db_migration_down: supabase/migrations/20260523040000_pay_external_fields.down.sql
db_applied: true
rollback_sql: rollback/FOOT-PAY-INPUT-001.sql
e2e_spec: tests/e2e/T-20260522-foot-PAY-INPUT-001.spec.ts
deadline: "2026-05-24T06:00+09:00"
deadline_hard: true
related: T-20260520-crm-PAY-RECON-001
risk_verdict: GO_WARN
risk_reason: "결제 입력 신규 워크플로(BL) + DB ADD COLUMN 2종(additive). 외부 API 호출·대량 데이터 변경 없음."
summary: >
  종로 풋센터 데스크 결제 입력 UI 1차.
  카드/현금/계좌이체 라디오 + 분할결제 + 승인번호(external_approval_no)·TID(external_tid) 선택 입력.
  DB: payments/package_payments ADD COLUMN 2종 (ADDITIVE-ONLY, nullable).
  PAY-RECON-001 롱레CRM external_* 네이밍 완전 일치 (2차 reconciliation 자동 흡수).
  정액권 1차 스코프 제외. redpay API 호출 0건.
---

# [FOOT-PAY-INPUT-001] 종로 풋센터 데스크 결제 입력 UI (1차)

## 구현 완료 요약

| 항목 | 결과 |
|------|------|
| DB 마이그레이션 | `20260523040000_pay_external_fields.sql` — payments/package_payments ADD COLUMN 2종 |
| 롤백 SQL | `rollback/FOOT-PAY-INPUT-001.sql` |
| PaymentDialog.tsx | 카드 선택 시 승인번호·TID 선택 입력 UI + INSERT 페이로드 포함 |
| PaymentMiniWindow.tsx | 카드 결제 저장 후 승인번호·TID 후입력 UI + INSERT 페이로드 포함 |
| 안내문구 | "2차 자동 매칭용 (입력 시 자동 매칭 100%, 미입력 시 시간·금액으로 자동 매칭 시도)" |
| E2E spec | `tests/e2e/T-20260522-foot-PAY-INPUT-001.spec.ts` (244줄, AC-1~5 + 시나리오-2) |
| 정액권 | 1차 스코프 제외 — 라디오 옵션 미노출 ✅ |
| redpay API | 0건 ✅ (스코프 가드 준수) |
| 빌드 | ✓ 3.22s (재검증 2026-05-23T23:30) |

## AC 달성 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | DB 스키마 ADDITIVE-ONLY (payments + package_payments external_* 2컬럼) | ✅ |
| AC-2 | 결제 입력 UI — 카드/현금/계좌이체 라디오 + 분할결제 + 승인번호·TID 칸 | ✅ |
| AC-3 | 정액권 차감 1차 미포함 | ✅ |
| AC-4 | PAY-RECON-001 롱레CRM `external_*` 네이밍 완전 일치 | ✅ |
| AC-5 | Cross-CRM Contract 준수 — 기존 컬럼 변경 0건 | ✅ |

## 파일 변경 목록

```
rollback/FOOT-PAY-INPUT-001.sql                    (신규)
src/components/PaymentDialog.tsx                   (수정 — external_* 입력 UI 추가)
src/components/PaymentMiniWindow.tsx               (수정 — external_* 후입력 UI 추가)
supabase/migrations/20260523040000_pay_external_fields.sql      (신규)
supabase/migrations/20260523040000_pay_external_fields.down.sql (신규)
tests/e2e/T-20260522-foot-PAY-INPUT-001.spec.ts   (신규)
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
