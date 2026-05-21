---
id: T-20260522-foot-PENCHART-REFUND-AUTOFILL
title: "펜차트 환불동의서 — 고객정보 자동채움"
status: approved
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-24
착수예정: 2026-05-24
deploy_ready: false
db_migration: false
assignee: dev-foot
depends_on:
  - T-20260522-foot-PENCHART-PEN-OFFSET
  - T-20260522-foot-PENCHART-SCROLL-BLOCK
source: planner MSG-20260522-011218-g41d
---

# T-20260522-foot-PENCHART-REFUND-AUTOFILL (P1)

## 배경

PENCHART-REFUND-FORM(deploy-ready)으로 환불/비급여동의서 PDF 오버레이 작성 기능은 완료.
현재 고객이 직접 손으로 이름·날짜·시술명·금액 등을 모두 기입해야 함.
→ **CRM DB의 고객 정보를 동의서 PDF에 자동 채움**으로 현장 작성 시간 단축.

## 스펙

### 자동채움 대상 필드 (환불/비급여 동의서 레이아웃 매핑)
| 항목 | DB 출처 | 채움 방식 |
|------|---------|-----------|
| 작성일 | 현재 날짜 | `new Date().toLocaleDateString('ko-KR')` |
| 고객 성명 | `customers.name` | 텍스트 오버레이 |
| 생년월일 | `customers.birth_date` | 텍스트 오버레이 |
| 연락처 | `customers.phone` | 마스킹 포함 (`010-XXXX-XXXX`) |
| 시술명 | 최근 check_in의 시술 항목 | 텍스트 오버레이 |
| 담당 원장 | `check_ins.staff_name` | 텍스트 오버레이 |

### 구현 방식
1. `PenChartTab.tsx` → `refund_consent` 양식 오픈 시 `autofillFields` 생성
2. Canvas 레이어 위에 `<AutofillOverlay>` 컴포넌트: 절대 위치 텍스트 (수정 불가·회색)
3. 태블릿 펜으로 추가 기입/서명은 기존 draw 레이어로
4. 저장 시 autofill 텍스트 + pen stroke를 merged PNG로 저장

### AutofillOverlay 컴포넌트
```tsx
// 절대 위치, 포인터 이벤트 none (펜 입력 통과)
<div style={{ position: 'absolute', top: 0, left: 0, width, height, pointerEvents: 'none' }}>
  <AutofillField x={80} y={320} value={customerName} />
  <AutofillField x={80} y={380} value={birthDate} />
  ...
</div>
```

## 수용기준

- AC-1: refund_consent 양식 오픈 시 고객 성명·생년월일·연락처 자동 표시
- AC-2: 자동채움 텍스트는 회색+이탤릭으로 시각적 구분 (수동 기입과 구별)
- AC-3: 자동채움 텍스트 위에 펜 드로잉 정상 (pointerEvents none)
- AC-4: 저장된 PNG에 자동채움 텍스트 포함
- AC-5: 고객 정보 없는 필드는 빈칸 (오류 없음)
- AC-6: 빌드 OK + E2E spec 통과

## 착수 조건

- T-20260522-foot-PENCHART-PEN-OFFSET deploy-ready ✅
- T-20260522-foot-PENCHART-SCROLL-BLOCK deploy-ready ✅
