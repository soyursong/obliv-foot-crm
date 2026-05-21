---
id: T-20260522-foot-PAY-DROPDOWN-LONGRE
status: deploy-ready
deploy_ready: true
build_ok: true
db_migration: false
e2e_spec: tests/e2e/T-20260522-foot-PAY-DROPDOWN-LONGRE.spec.ts
summary: "패키지 결제 모드에서 membership 결제수단 필터링 — package_payments CHECK constraint 위반 수정. visibleMethodOptions UI 필터 + submit 가드 + 모드 전환 리셋 3중 방어."
---

# T-20260522-foot-PAY-DROPDOWN-LONGRE: package_payments membership constraint 수정

## FIX-REQUEST 이력

- **qa_fail_phase**: phase1 (코드 QA)
- **qa_fail_reason**: package_payments_membership_constraint_violation
- **FIX commit**: e708173

## AC 체크리스트

- [x] AC-1~4: 롱레 CRM 결제수단 4종(card/cash/transfer/membership) — payments 테이블 정합
- [x] AC-5(A): paymentMode==='package' 시 visibleMethodOptions에서 membership 제외 (UI 필터)
- [x] AC-5(B): handleSubmit submit 가드 — !isSplit && method==='membership' → toast.error + 조기 리턴
- [x] AC-5(C): 패키지 모드 전환 시 method==='membership'이면 'card'로 리셋
- [x] AC-5 주석 정정: payments CHECK ✅ vs package_payments CHECK ❌ 명시

## 구현 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/PaymentDialog.tsx` | AC-5 주석 추가 (L22~24) |
| `src/components/PaymentDialog.tsx` | `visibleMethodOptions` 상수 추가 (L134~136) |
| `src/components/PaymentDialog.tsx` | submit 가드 추가 (L183~188) |
| `src/components/PaymentDialog.tsx` | 패키지 모드 전환 시 method 리셋 (L466~471) |
| `src/components/PaymentDialog.tsx` | `METHOD_OPTIONS.map` → `visibleMethodOptions.map` (L608) |
| `tests/e2e/T-20260522-foot-PAY-DROPDOWN-LONGRE.spec.ts` | AC-5b 테스트 추가 + 주석 정정 |

## 기술 노트

- FE-only, DB 변경 없음
- package_payments CHECK: `('card','cash','transfer')` — membership 없음
- payments CHECK: `('card','cash','transfer','membership')` — membership 있음
- 3중 방어: UI 필터(렌더 제외) + submit 가드(조기 리턴) + 모드 전환 리셋
