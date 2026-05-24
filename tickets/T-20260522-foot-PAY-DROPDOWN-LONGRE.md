---
id: T-20260522-foot-PAY-DROPDOWN-LONGRE
status: deploy-ready
deploy_ready: true
build_ok: true
db_migration: false
e2e_spec: tests/e2e/T-20260522-foot-PAY-DROPDOWN-LONGRE.spec.ts
summary: "Phase2 (REOPEN): AC-6 결제수단 라벨 멤버십→패키지 (3컴포넌트, DB value 'membership' 유지) + AC-7 패키지 선택 시 금액 자동 연동 + AC-8 패키지 모드 자기 제외 유지. Phase1 Phase2 누적 완료."
phase: 2
phase2_commit: 470bd0c
---

# T-20260522-foot-PAY-DROPDOWN-LONGRE: 결제수단 드롭다운 패키지화 + 금액 자동 연동

## FIX-REQUEST 이력

- **Phase 1**: package_payments membership constraint 위반 수정
  - qa_fail_phase: phase1
  - qa_fail_reason: package_payments_membership_constraint_violation
  - FIX commit: e708173
  - deploy-ready commit: ea6ba29
- **Phase 2 REOPEN** (김주연 총괄 5/24 13:50 추가 요청):
  - AC-6 라벨 변경 + AC-7 금액 자동 연동
  - commit: 470bd0c (2026-05-24 13:59)

## AC 체크리스트

### Phase 1 (완료)
- [x] AC-1~4: 롱레 CRM 결제수단 4종(card/cash/transfer/membership) — payments 테이블 정합
- [x] AC-5(A): paymentMode==='package' 시 visibleMethodOptions에서 membership 제외 (UI 필터)
- [x] AC-5(B): handleSubmit submit 가드 — !isSplit && method==='membership' → toast.error + 조기 리턴
- [x] AC-5(C): 패키지 모드 전환 시 method==='membership'이면 'card'로 리셋
- [x] AC-5 주석 정정: payments CHECK ✅ vs package_payments CHECK ❌ 명시

### Phase 2 (완료, commit 470bd0c)
- [x] AC-6: 결제수단 드롭다운 라벨 "멤버십" → "패키지" (3개 컴포넌트)
  - PaymentMiniWindow.tsx: label 멤버십→패키지
  - PaymentDialog.tsx: label 멤버십→패키지, icon 🎫→📦
  - PaymentEditDialog.tsx: label 멤버십→패키지
  - DB value 'membership' 유지 (CHECK constraint 변경 불필요)
- [x] AC-7: 단건 결제 + 패키지 수단 선택 시 금액 자동 연동
  - 패키지 수단 클릭 → pkgTemplates 목록 표시
  - 템플릿 선택 → handleSelectTemplate → amountStr = total_price 자동 세팅
  - 금액 수동 편집 가능 (자동 세팅 후 Input 자유 수정)
  - 수단 전환 시 selectedTemplateId 초기화
  - 패키지 미선택 시 placeholder "패키지 선택 시 자동 입력"
- [x] AC-8: 패키지 결제 모드에서 "패키지" 수단 자동 제외 (기존 AC-5 로직 유지)

## 구현 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/PaymentDialog.tsx` | Phase1: AC-5 주석·visibleMethodOptions·submit 가드·모드 리셋 |
| `src/components/PaymentDialog.tsx` | Phase2: AC-6 label/icon 변경, AC-7 pkgTemplates UI + handleSelectTemplate |
| `src/components/PaymentMiniWindow.tsx` | Phase2: AC-6 label 멤버십→패키지 |
| `src/components/PaymentEditDialog.tsx` | Phase2: AC-6 label 멤버십→패키지 |
| `tests/e2e/T-20260522-foot-PAY-DROPDOWN-LONGRE.spec.ts` | Phase1: AC-5b 테스트 / Phase2: AC-6·AC-7 3 describe 6 test 추가 |

## 기술 노트

- FE-only, DB 변경 없음
- package_payments CHECK: `('card','cash','transfer')` — membership 없음
- payments CHECK: `('card','cash','transfer','membership')` — membership 있음
- Phase1 3중 방어: UI 필터(렌더 제외) + submit 가드(조기 리턴) + 모드 전환 리셋
- Phase2 risk: GO_WARN (1/5 비즈니스 로직 — 금액 자동 연동, 수동 수정 가능으로 위험도 낮음)
