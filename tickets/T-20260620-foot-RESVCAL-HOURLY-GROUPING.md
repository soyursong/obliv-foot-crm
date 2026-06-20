---
ticket_id: T-20260620-foot-RESVCAL-HOURLY-GROUPING
id: T-20260620-foot-RESVCAL-HOURLY-GROUPING
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-20
owner: agent-fdd-dev-foot
requester: 김주연 총괄 (C0ATE5P6JTH) — "10시/11시/12시 등 시간단위로 묶자. 10시반 예약 고객도 10시 타임으로. 최대한 짧아지게."
approved_by: planner NEW-TASK MSG-20260620-180425-twd6
build_ok: true (tsc --noEmit 0, vite build 4.44s)
spec_added: tests/e2e/T-20260620-foot-RESVCAL-HOURLY-GROUPING.spec.ts (4 tests, desktop-chrome PASS)
db_changed: false (FE 표시 레이어 전용 — 저장시각/입력 슬롯 로직 무변경)
data_architect_consult: 불요 — FE 표시 그룹핑만. 신규 컬럼·테이블·enum 0. DB·계약 무접촉.
risk_level: LOW (display-only; 데이터·createReservationCanonical·slotMaxFor·handleDrop 로직 불변)
---

# T-20260620-foot-RESVCAL-HOURLY-GROUPING — 예약캘린더 정시 단위 그룹핑

## 요청 (김주연 총괄)
"10시/11시/12시 등 시간단위로 묶자. 10시반 예약 고객도 10시 타임으로. 최대한 짧아지게."

## 범위 (표시 레이어 전용)
- 캘린더 시간축을 정시(HH:00) 단위로만 표시 → 30분(:30) 라인 제거.
- HH:30 등 반시 예약은 해당 정시(HH:00) 그룹에 흡수 표시.
- 같은 정시 그룹에 여러 예약을 함께 쌓아 표시(시각 오름차순→유형 KIND_ORDER) → 세로길이 최소화.
- ⚠ 데이터 불변: 실제 저장시각(10:30)·입력 슬롯 로직(slot_interval·slotMaxFor·createReservationCanonical) 무변경.
  카드 클릭/상세/저장엔 실제 시각 그대로. 카드(reservation_time) 표기 불변.
- 예약 누락 0: gridSlots 의 모든 슬롯이 정확히 한 정시 그룹에 1회 귀속. 색상/인터랙션 유지.

## 구현
- 신규 `src/lib/resvHourBucket.ts` — `buildHourBuckets(gridSlots)` (격리 유틸, no-op 안전: slot_interval=60이면 member 1개).
- `Reservations.tsx` tbody: `gridSlots.map` → `hourBuckets.map`. 행=정시. data-slot-time=`HH:00`.
  - cell: `memberSlots`(정시 흡수 슬롯) union으로 `list` 구성, `bucketMax`/`activeCount` 합산,
    `full`=영업 가능 member 전부 마감, `primarySlot`=첫 비마감 member(생성/이동/클립보드 대표 시각).
  - 입력/이동/클립보드는 항상 `primarySlot`(실제 30분 슬롯 시각) 사용 — slot 로직 불변.
  - 현재시각 행 ref = 현재 정시(HH) 그룹(currentHourKey).

## AC / 현장 클릭 시나리오 (E2E 변환)
- AC-1: 시간축 행 전부 `HH:00` — :30 라인 0개. (PASS)
- AC-2: 정시당 1행(중복 0) + 오름차순. (PASS)
- 시나리오3: 빈 슬롯 (+) 예약생성 affordance 보존, testid 토큰 `slot-plus-YYYY-MM-DD-HH:00`. (PASS)
- 시나리오4: 카드 클릭해도 그리드 무손상(행 수 보존). (PASS)

## 충돌 조율 (RESVCAL-COMPACT-HALFSIZE)
동일 캘린더 컴포넌트의 px 압축(셀/카드/폰트)과 additive·다른 축. HALFSIZE의 h-4/text-[10px] 클래스 보존 위에
시간버킷(행=정시) 압축을 얹음. 회귀 검증: COMPACT-HALFSIZE / AUTOSCROLL / 5FIX / DND / BOX-INTERACT spec 전수 PASS.

## 검증
- tsc --noEmit: 0 errors. vite build: OK.
- E2E: HOURLY-GROUPING 4 + AUTOSCROLL + 5FIX(source-grep `cell-kind-count-${dateStr}-${time}` 보존) = 23 passed.
- 회귀: DND-SHORTCUT / BOX-INTERACT / COMPACT-HALFSIZE / RESVMGMT-COMPACT-POPUPFLOW / RESVPOPUP-3BUG = 11 passed 1 skipped, 0 fail.
- DB 변경: 없음.
