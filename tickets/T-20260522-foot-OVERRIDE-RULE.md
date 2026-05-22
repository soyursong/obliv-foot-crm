---
id: T-20260522-foot-OVERRIDE-RULE
title: "풋센터 CRM Override(예외) 규칙 재정비"
status: deployed
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-29
reporter: 김주연 총괄
assignee: dev-foot
deploy_ready: true
deploy_ready_at: 2026-05-22
build_status: PASS
db_changes: false
e2e_spec_exempt_reason: "문서+주석만, UI 변경 없음"
risk_verdict: "GO_WARN (1/5)"
related_tickets:
  - T-20260519-foot-LOGIC-LOCK-REGISTRY
---

# T-20260522-foot-OVERRIDE-RULE — 풋센터 CRM Override(예외) 규칙 재정비

## 수용기준 결과

- [x] AC-1: `LOGIC-LOCK-REGISTRY.md` "Override 연동 규칙" 섹션 신설 (3단 구조)
- [x] AC-2: 코드 내 `// OVERRIDE-RULE: O-{ID}` 주석 체계 정의 + 기존 코드 마킹
- [x] AC-3: Override 충돌 시 사전 보고 프로세스 정의 (planner MQ FOLLOWUP P0)
- [x] AC-4: 기존 override 적용 건 전수조사 → 재분류 (충돌 없음)

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `LOGIC-LOCK-REGISTRY.md` | Override 연동 규칙 섹션 신설 (3단 구조, 주석 체계, O-001~003 등록) |
| `src/lib/copayCalc.ts` | O-001 주석 추가 |
| `src/components/PaymentMiniWindow.tsx` | O-002 주석 추가 |
| `src/pages/Packages.tsx` | O-002 주석 추가 |
| `src/pages/Reservations.tsx` | O-003 주석 추가 |

## Override 등록 목록 (전수조사)

| O-ID | 설명 | 충돌 L-ID | 결과 |
|------|------|-----------|------|
| O-001 | `copayment_rate_override` — 보험 자기부담률 개별 적용 | 없음 | 정상 |
| O-002 | `customAmounts` / `price_override` — 결제 수기조정 | 없음 | 정상 |
| O-003 | `overrideTherapistId` — 치료사 수동 배정 | 없음 | 정상 |
