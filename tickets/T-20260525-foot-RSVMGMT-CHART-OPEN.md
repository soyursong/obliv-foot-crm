---
ticket_id: T-20260525-foot-RSVMGMT-CHART-OPEN
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-25
deadline: 2026-05-29
deploy_ready_at: 2026-05-25
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260525-foot-RSVMGMT-CHART-OPEN.spec.ts
db_changed: false
rollback_sql: ""
risk_level: GO (0/5)
commit_sha: f85f025
fix_commit_sha: c0801ba
---

# T-20260525-foot-RSVMGMT-CHART-OPEN — 예약관리 고객박스 클릭 차트 열림 누락 수정

## 배경

planner NEW-TASK MSG-20260525-081428 (08:14 KST).
예약관리 페이지 고객박스 클릭 시 1·2번차트 열림 동작 누락. 대시보드는 정상 동작.

## 근본 원인

`CustomerHoverCard` 컴포넌트에 `onClick` prop이 없었음.
예약관리에서 `CustomerHoverCard`를 사용하면서 `handleResvOpenChart` 연결 누락.
대시보드는 `handleCardClick`으로 `openChart(customer_id)`를 직접 호출하는 방식이라 정상.

## 변경 내역

### c0801ba — fix(reservations): 차트 미열림 수정

**`src/components/CustomerHoverCard.tsx`**
- `onClick?: () => void` prop 추가
- 이름 `span`에 `onClick` 연결
- `onClick` 존재 시 `data-testid="customer-hover-card-name-clickable"`, 없으면 `"customer-hover-card-name"` — E2E 구분 정확도 향상

**`src/pages/Reservations.tsx`**
- `CustomerHoverCard onClick={() => handleResvOpenChart(resvAsCheckIn(r))}` 연결
- `handleResvOpenChart` → `openChart(ci.customer_id)` → ChartContext → CustomerChartSheet (AdminLayout 단일 소스)
- 주석: `// T-20260525-foot-RSVMGMT-CHART-OPEN AC-1`

### f85f025 — [deploy-ready] E2E spec + testid

- `data-testid` 분기 추가 (clickable/non-clickable)
- E2E spec 3시나리오: `tests/e2e/T-20260525-foot-RSVMGMT-CHART-OPEN.spec.ts`

## AC

| AC | 설명 | 상태 |
|----|------|------|
| AC-1 | 예약관리 고객박스 클릭 → 1·2번차트 열림 | DONE |
| AC-2 | 열린 차트에 고객 정보 정확 표시 (aria-label="고객차트") | DONE |
| AC-3 | 대시보드 기존 동작 유지 / 드래그 인터랙션 유지 | DONE |

## E2E 시나리오 (5건)

| SC | 설명 |
|----|------|
| SC-1 | 예약관리 고객박스 클릭 → CustomerChartSheet 열림 |
| SC-2 | 열린 차트 aria-label 확인 |
| SC-3 | 고객A→B 클릭 차트 전환 |
| SC-4 | 대시보드 칸반 카드 클릭 기존 동작 |
| SC-5 | 예약관리 페이지 정상 렌더 + 콘솔 에러 없음 |

## 변경 파일

| 파일 | 변경 유형 |
|------|----------|
| `src/components/CustomerHoverCard.tsx` | EDIT (onClick prop + testid 분기) |
| `src/pages/Reservations.tsx` | EDIT (onClick 연결) |
| `tests/e2e/T-20260525-foot-RSVMGMT-CHART-OPEN.spec.ts` | NEW (E2E 5건) |

## 빌드 결과

```
✓ built in 3.20s
```

## supervisor 체크리스트

- [ ] Vercel 배포 확인
- [ ] 예약관리 페이지 고객박스 클릭 → 차트 열림 현장 확인
- [ ] 대시보드 기존 동작 회귀 없음 확인
