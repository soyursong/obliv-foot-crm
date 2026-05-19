# LOGIC-LOCK REGISTRY — obliv-foot-crm

> **목적**: 풋센터 CRM 핵심 비즈니스 로직 불변 규칙 목록.  
> 이 파일에 등재된 항목은 **현장(김주연 매니저) 승인 없이 코드 변경 절대 금지**.  
> 코드 내 `// LOGIC-LOCK: {L-CODE}` 주석과 1:1 대응.  
> 마지막 갱신: 2026-05-19 · 티켓: T-20260519-foot-LOGIC-LOCK-REGISTRY

---

## L-001 — 셀프접수 고객정보 노출 금지

| 항목 | 내용 |
|------|------|
| **상태** | ACTIVE · deployed |
| **원칙** | 셀프체크인(/checkin/:clinicSlug) 화면에서 고객 DB 조회 결과를 UI에 노출하거나 자동완성·드롭다운으로 선택하게 해서는 안 된다. |
| **허용** | 전화번호 입력 완료 후 서버사이드에서 고객 ID 매칭만 수행 (UI 미노출). 오늘 예약 배너(시간+방문유형)는 노출 가능. |
| **금지** | 고객 이름 드롭다운, 고객 목록 자동완성, 과거 방문 이력 표시 |
| **이유** | 키오스크(태블릿) 특성상 다음 고객이 이전 고객 정보를 볼 수 있음. 개인정보 보호 + 현장 요청. |
| **파일** | `src/pages/SelfCheckIn.tsx` (파일 상단 + L001 resetKey 주석 + handleSubmit 주석 + 이름 input 주석) |
| **티켓** | T-20260517-foot-CHECKIN-2STEP |

---

## L-002 — [예약하기] 클릭 → `/admin/reservations` 전체 페이지 전환

| 항목 | 내용 |
|------|------|
| **상태** | ACTIVE · deployed |
| **원칙** | 전역 [예약하기] 버튼 및 모든 컨텍스트의 [예약하기] 클릭 시, **반드시** `/admin/reservations` full page 전환으로 처리해야 한다. 슬라이드오버·팝오버·인라인 모달 단독 처리 절대 금지. |
| **이유** | 예약관리 페이지가 예약 생성·수정·캘린더 조회의 단일 진입점. 분산 시 동기화 버그 발생 이력 (T-20260516-foot-RESV-ROUTE-FIX). |
| **파일 목록** | |
| ↳ `src/components/AdminLayout.tsx` | 전역 헤더 [예약하기] |
| ↳ `src/pages/Customers.tsx` | 고객관리 [예약하기] |
| ↳ `src/pages/Dashboard.tsx` | 대시보드 [예약하기] |
| ↳ `src/pages/CustomerChartPage.tsx` | 차트 내 [예약하기] |
| ↳ `src/components/CalendarNoticePanel.tsx` | 캘린더 날짜 클릭 |
| **티켓** | T-20260517-foot-RESV-NAV-DIRECT, T-20260516-foot-RESV-ROUTE-FIX |

---

## L-003 — [BLOCKED]

| 항목 | 내용 |
|------|------|
| **상태** | BLOCKED — 원문 잘림으로 스펙 미확보 |
| **처리** | 원문 확보 후 planner → dev-foot NEW-TASK 발행 예정 |
| **티켓** | T-20260519-foot-LOGIC-LOCK-REGISTRY (하위 항목) |

---

## L-004 — 차트 접근 경로 잠금 (CHART-ACCESS-LOCK)

> `scripts/chart-access-lock.json` 의 10개 required_patterns 와 대응.  
> 차트 접근은 `useChart()` hook / `ChartContext` 단일 경로만 허용.  
> 체크 스크립트: `scripts/check-chart-access-lock.sh`

| 항목 | 내용 |
|------|------|
| **상태** | ACTIVE · deployed · pre-push guard 적용 |
| **원칙** | 차트(CustomerChartSheet) 열기/닫기는 반드시 `useChart()` hook 경유. `AdminLayout.tsx` 에서 단일 렌더. createPortal 제거 금지. |
| **이유** | nested Dialog race condition 재발 이력 5회+. T-20260516-foot-CHART2-STATE-UNIFY 구조적 방지 가드. |
| **티켓** | T-20260519-foot-CHART-ACCESS-LOCK, T-20260516-foot-CHART2-STATE-UNIFY |

### CHART-ACCESS-LOCK ↔ L-004 세부 매핑

| CHART-LOCK-ID | 설명 | 파일 | L-코드 |
|---------------|------|------|--------|
| CHART-LOCK-001 | `useChart` hook export | `src/lib/chartContext.ts` | L-004 |
| CHART-LOCK-002 | `ChartContext` export | `src/lib/chartContext.ts` | L-004 |
| CHART-LOCK-003 | AdminLayout `openChart` 구현 | `src/components/AdminLayout.tsx` | L-004 |
| CHART-LOCK-004 | AdminLayout `ChartContext.Provider` 래핑 | `src/components/AdminLayout.tsx` | L-004 |
| CHART-LOCK-005 | AdminLayout `CustomerChartSheet` 단일 렌더 | `src/components/AdminLayout.tsx` | L-004 |
| CHART-LOCK-006 | CustomerChartSheet `createPortal` | `src/components/CustomerChartSheet.tsx` | L-004 |
| CHART-LOCK-007 | CheckInDetailSheet `openChart` 호출 | `src/components/CheckInDetailSheet.tsx` | L-004 |
| CHART-LOCK-008 | Customers 페이지 `openChart` 호출 | `src/pages/Customers.tsx` | L-004 |
| CHART-LOCK-009 | Dashboard `openChart` 호출 | `src/pages/Dashboard.tsx` | L-004 |
| CHART-LOCK-010 | Reservations `openChart` 호출 | `src/pages/Reservations.tsx` | L-004 |

---

## 변경 절차

1. 현장(김주연 매니저) 승인 획득
2. planner 티켓 생성 → supervisor GO 판정
3. 코드 수정 + 이 파일 해당 L-코드 `상태` 업데이트
4. `scripts/chart-access-lock.json` 해당 항목 `active:false` 변경 (L-004 관련)
5. PR에 변경 사유 + 승인자 명시 필수

---

*last updated: 2026-05-19 · by dev-foot · ticket: T-20260519-foot-LOGIC-LOCK-REGISTRY*
