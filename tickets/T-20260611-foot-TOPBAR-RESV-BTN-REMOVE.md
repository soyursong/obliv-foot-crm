---
ticket_id: T-20260611-foot-TOPBAR-RESV-BTN-REMOVE
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-11
deploy_ready_at: 2026-06-12
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260611-foot-TOPBAR-RESV-BTN-REMOVE.spec.ts
db_changed: false
rollback_sql: ""
risk_level: GO (0/5)
commit_sha: PENDING
---

## 요청

원천: NEW-TASK MSG-20260611-165502-yik9 (planner, P2, GO) — 김주연 총괄 요청.
CRM 맨 상단 헤더 영역의 불필요한 "예약하기" 버튼 제거.

## 1. 변경 내용 (diff-first 특정)

- **렌더 지점**: `src/components/AdminLayout.tsx` `<header>` 우측 액션 영역의 전역 [예약하기] 버튼
  (`data-testid="btn-header-make-reservation"`, 라인 ~493–513). 인라인 `onClick`(navigate → /admin/reservations,
  openReservationFor 빈 예약) 포함 버튼 블록 전체 제거.
- **dead code 정리**: 버튼 제거로 미사용된 `CalendarPlus` lucide import 제거(버튼이 유일 사용처였음, build로 확인).
  `navigate`는 로그아웃·고객이동 등 타 사용처 존재 → 유지.
- **DB 변경 없음** (FE-only).

## 2. 유일경로 가드 (제거 전 필수 확인 — 통과)

헤더 버튼은 예약 등록 **유일 진입점이 아님**. 대체 경로 5개 보존 확인:
1. 예약관리 페이지 '새 예약' 버튼 (`Reservations.tsx`, T-20260513-foot-RESV-PLUS-PHONE-SEARCH)
2. 고객관리 우클릭 [예약하기] (`Customers.tsx`)
3. 대시보드 고객카드 (`Dashboard.tsx`, handleNewReservation)
4. 차트 내 [예약하기] (`CustomerChartPage.tsx`)
5. 캘린더 날짜 클릭 (`CalendarNoticePanel.tsx`)

→ 유일경로 아님 → 제거 안전. planner FOLLOWUP 보류 사유 없음.

## 3. LOGIC-LOCK 영향

- L-002(=[예약하기] 클릭 시 항상 /admin/reservations full page 전환)의 핵심 원칙은
  잔존 진입점(고객관리·대시보드·차트·캘린더)에 **그대로 유지**. 본 변경은 헤더 surface 1개만 제거.
- LOGIC-LOCK-REGISTRY.md L-002 파일 목록의 "전역 헤더 [예약하기]" 항목은 supervisor 배포 후 정리 권고
  (원칙 자체는 불변이므로 코드 GO 차단 사유 아님).

## 4. AC (수용 기준)

- ① 상단 헤더 [예약하기] 버튼 미노출
- ② 기존 예약 동선 회귀 없음 (대체 진입점 5개 보존)
- ③ 레이아웃 깨짐 / 콘솔에러 없음

## 5. E2E 시나리오 (tests/e2e/T-20260611-foot-TOPBAR-RESV-BTN-REMOVE.spec.ts — 8 pass)

거대-인라인 컴포넌트(AdminLayout) 관례 = source-integrity gating(소스 정적 단언). 실 렌더/콘솔에러는 field-soak.

- **AC1-1**: `btn-header-make-reservation` testid 잔존 없음
- **AC1-2**: `<header>` 블록 내 '예약하기' 라벨 텍스트 없음
- **AC1-3**: 제거 사유 추적 주석(티켓 ID) 존재
- **AC2-1**: `CalendarPlus` import 제거 (dead import 없음)
- **AC2-2**: `navigate`/`useNavigate`/`navigate('/login')` 유지 (타 사용처 보존)
- **AC3-1**: 예약관리 '새 예약' 진입점 보존
- **AC3-2**: openReservationFor 자동오픈 동선 보존

## 6. supervisor field-soak 체크포인트

- [ ] 로그인 후 상단 헤더에 예약하기 버튼 미노출 (PC·태블릿 폭)
- [ ] 헤더 우측 정렬·간격 깨짐 없음 (고객검색·알림·프로필 정상)
- [ ] 콘솔 에러 0
- [ ] 예약관리 '새 예약'으로 빈 예약 생성 정상 (대체 동선 회귀 없음)
