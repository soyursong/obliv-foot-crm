---
id: T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-06-11
completed: 2026-06-12
db_changed: false
db_migration: none
db_gate: N/A
scenario_count: 2
commit: PENDING
spec: tests/e2e/T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV.spec.ts
build: pass
source_msg: MSG-20260611-181147-rgzg
author: agent-fdd-dev-foot
data_arch_consult: "비해당 — 신규 컬럼/테이블/enum 없음(§S2.4 CONSULT gate 미적용). FE 라우팅 + 팝업 상태만."
---

# T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV — 대시보드 슬롯 카드 우클릭 [예약상세] → 예약관리 라우팅 + 정본 팝업

## 요구 (planner MSG-20260611-181147-rgzg)
- a) 대시보드(/admin) 슬롯 카드 우클릭 메뉴 [예약상세] (기존 우클릭 패턴 재사용)
- b) 클릭 시 예약관리(/admin/reservations)로 라우팅
- c) 라우팅과 동시에 ReservationDetailPopup 열린 채 유지 (라우팅 unmount 금지)
- d) 팝업 = 클릭 원 예약 기준(reservation_id 유지)
- DB 변경 없음 (FE 라우팅 + 팝업 상태)

## 구현 (dev-foot, 2026-06-12)

### ⚠ 정합 우선검증 결과 (티켓 명시 게이트)
POPUP-SYNC(field-soak)가 예약관리 측 [예약상세]→팝업(`detail`/`setDetail`)을 **정본**으로 이미 보유.
코드 확인 결과 대시보드에도 **별도 `ReservationDetailPopup` 인스턴스(`dashResvDetail`)** 가 공존(CTXMENU-UNIFY-CANONICAL
도입분) → **중복 마운트**가 곧 "동기화 깨짐" 리스크. 따라서:
- **대시보드 로컬 팝업(`dashResvDetail` state + `<ReservationDetailPopup>` 블록 + import) 제거** → 팝업 인스턴스 단일화.
- 대시보드 [예약상세] = 클릭 원 예약 객체를 `location.state.openReservationDetail` 로 넘기며
  `navigate('/admin/reservations')` → **예약관리 정본 팝업만** 사용.
- 전체 `Reservation` 객체를 state로 전달 → 추가 fetch 없이 **라우팅 직후 깜빡임 없이** 팝업이 열린 채로 보임
  (c의 "열린 채 유지"를 라우팅 후 즉시-오픈으로 사용자 무지각화. AdminLayout hoist 같은 신규 추상화 도입 없이 기존
  navigate-with-state 패턴(openReservationFor/goToWeekOf) 재사용).

### 변경 파일
- `src/pages/Dashboard.tsx`
  - `handleResvOpenDetailFromCtx`(타임라인 슬롯 카드) / `handleCardResvDetailOrCreate`(고객카드, 캐시+DB 두 경로):
    `setDashResvDetail(...)` → `navigate('/admin/reservations', { state: { openReservationDetail: resv } })`.
    워크인(연결예약 없음) → `handleNewReservation(ci)` fallback(L-002) 보존.
  - `dashResvDetail` state + 대시보드 `<ReservationDetailPopup>` 블록 + `ReservationDetailPopup` import 제거.
- `src/pages/Reservations.tsx`
  - `navDetailConsumed` ref + useEffect: `location.state.openReservationDetail` 소비 → `setDetail(resv)`.
    1회 소비 가드 + `window.history.replaceState({}, '')`(새로고침/뒤로가기 재오픈 방지). `openReservationFor`(navStateConsumed)와 별도 ref → 동선 간 미간섭.

### 검증
- `npm run build` EXIT 0 (3.76s).
- E2E 신규 `T-20260611-foot-RESV-DASH-CTXMENU-DETAIL-NAV.spec.ts`(시나리오2 + AC c/d + 회귀) + 회귀 갱신
  `T-20260611-foot-CTXMENU-UNIFY-CANONICAL.spec.ts`(AC1-3/AC4-3 superseded 반영) → **23 passed**.

### supervisor field-soak 권고
실 브라우저 클릭 동선(대시보드 타임라인 슬롯 카드/고객카드 우클릭 → [예약상세] → /admin/reservations 전환 +
팝업 즉시 오픈, 클릭 원 예약 일치) 확인. 다른 주(미래/과거 날짜) 예약 슬롯에서도 팝업 오픈되는지 점검.
