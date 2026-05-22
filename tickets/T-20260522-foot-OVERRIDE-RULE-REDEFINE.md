---
id: T-20260522-foot-OVERRIDE-RULE-REDEFINE
title: "예외 규칙(Override) 재정비 — 기능 한정 + 연동 우선"
status: deployed
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-29
reporter: planner (현장 요청 반영)
assignee: dev-foot
deploy_ready: true
deploy_ready_at: 2026-05-22
build_status: PASS
db_changes: false
e2e_spec_exempt_reason: "주석·레지스트리 문서만, UI 변경 없음"
risk_verdict: "GO (0/5)"
related_tickets:
  - T-20260522-foot-OVERRIDE-RULE
  - T-20260519-foot-LOGIC-LOCK-REGISTRY
---

# T-20260522-foot-OVERRIDE-RULE-REDEFINE — 예외 규칙(Override) 재정비

## Override 3원칙 (현장 확정)

| # | 원칙 | 설명 |
|---|------|------|
| 1 | **기능 한정** | Override = 특정 기능을 특정 경로에만 적용. 경로 전체 독립 금지. |
| 2 | **연동 우선** | 기본 로직은 전체 연동 유지. 한 쪽 변경 → 전체 반영. |
| 3 | **충돌 사전 보고** | 경로 한정 기능 vs 전체 연동 충돌 시 → planner FOLLOWUP 보고 후 처리. |

## 수용기준 결과

- [x] AC-1: 코드베이스 Override/예외 경로 전수 감사 → FOLLOWUP 보고
  - O-001~004: 모두 "기능 한정 + 연동 우선" 패턴 확인 ✅
  - `visitType` 신규/재진 분기: 이중 동선 정상 설계 ✅ (Override 아님)
  - 경로 독립 패턴 없음 확인 ✅
  - O-004: 코드 존재하나 레지스트리 미등록 → 등록 완료 ✅
  - L-003: 레지스트리 BLOCKED 오류 → ACTIVE 복원 완료 ✅

- [x] AC-2: 잘못된 패턴(경로 독립 분기) → 기능 한정 + 연동 우선으로 재구조화
  - 잘못된 패턴 없음. 기존 O-001~004 모두 정상.

- [x] AC-3: 코드 주석 `// OVERRIDE: {경로} — {기능}. 기본 로직 전체 연동.` 삽입
  - `src/lib/copayCalc.ts`: O-001 주석 갱신
  - `src/components/PaymentMiniWindow.tsx`: O-002 주석 갱신
  - `src/pages/Reservations.tsx`: O-003 주석 갱신
  - `src/pages/Packages.tsx`: O-004 주석 갱신

- [x] AC-4: 충돌 감지 시 planner FOLLOWUP 보고 의무
  - 충돌 없음 확인. planner에 FOLLOWUP 감사 결과 보고.

- [x] AC-5: Logic Lock L-003과 관계 정리
  - L-003: "차트 수정사항 CRM 전체 고객 동일 적용"
  - Override(O-{ID})는 차트 렌더링 로직 자체를 분기하지 않음
  - Override는 차트 내 특정 필드값(예: `copayment_rate_override`)에 국한
  - L-003의 "전체 고객 동일 적용" 원칙은 Override로도 우회 불가
  - LOGIC-LOCK-REGISTRY.md L-003 섹션에 상세 기재 완료

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `LOGIC-LOCK-REGISTRY.md` | L-003 BLOCKED→ACTIVE 복원 + L-003↔Override 관계 정리 + O-004 등록 + 주석 체계 재정비 |
| `src/lib/copayCalc.ts` | O-001 주석 → 새 포맷 갱신 |
| `src/components/PaymentMiniWindow.tsx` | O-002 주석 → 새 포맷 갱신 |
| `src/pages/Reservations.tsx` | O-003 주석 → 새 포맷 갱신 |
| `src/pages/Packages.tsx` | O-004 주석 → 새 포맷 갱신 |

## Override 전수조사 결과

| O-ID | 상태 | 적용 경로 | 패턴 판정 | 충돌 L-ID |
|------|------|-----------|----------|-----------|
| O-001 | ACTIVE | `copayCalc.ts` | 기능 한정 ✅ | 없음 |
| O-002 | ACTIVE | `PaymentMiniWindow.tsx` | 기능 한정 ✅ | 없음 |
| O-003 | ACTIVE | `Reservations.tsx` | 기능 한정 ✅ | 없음 |
| O-004 | ACTIVE | `Packages.tsx` | 기능 한정 ✅ | 없음 |

### visitType 분기 감사 (Override 아닌 것 확인)

| 패턴 | 파일 | 판정 |
|------|------|------|
| `stagesFor(visitType)` 신규/재진 스테이지 분기 | `src/lib/status.ts` | ✅ 이중 동선 설계 — Override 아님 |
| `if (visitType === 'new')` 체크인 생성 분기 | `src/components/NewCheckInDialog.tsx` | ✅ 비즈니스 로직 — Override 아님 |
| `if (visitType === 'new') notesParts.id_check_required` | `src/pages/SelfCheckIn.tsx` | ✅ 신규 ID 확인 로직 — Override 아님 |
| `if (!customerId || visitType !== 'returning')` | `src/pages/Reservations.tsx` | ✅ 재진 유효성 검사 — Override 아님 |
