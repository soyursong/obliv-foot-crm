# T-20260716-foot-RESVDETAIL-CAL-AVAILTIME-EMPTY-RCA — 진단 결과

- 티켓: T-20260716-foot-RESVDETAIL-CAL-AVAILTIME-EMPTY-RCA (P2, db_change=false, read-only 진단)
- 현장 신고(ch C0ATE5P6JTH / U05L44C5P50): "예약관리 > 예약상세 팝업 > 예약캘린더에서 7/24·7/30 일정 변경하려 보면 예약가능시간이 거의 없거나 아예 없다"
- 조사 시각 기준 HEAD: 32879f02

## 결론 (한 줄)
**A(근무표 미입력) 아님 · C(만석) 아님. = 설계/시맨틱 갭.**
예약상세 팝업의 시간 변경(reschedule) 시간선택기(`ReservationDayTimeslotPanel` selectable 모드)는
**"기존 예약이 있는 시간대"만 클릭 가능한 행으로 렌더**한다. 영업시간 기반 전체 슬롯 그리드를 생성하지
않으며, 근무표/듀티로스터 등 가용성 원천을 **일절 참조하지 않는다**(해당 원천이 이 경로에 존재하지 않음).
따라서 예약이 적은 날짜(7/24=2건, 7/30=2건)는 클릭 가능한 시간이 2개뿐 → 현장은 이를 "예약가능시간이 없다"로 인지.

## 코드 근거
- `src/components/ReservationDayTimeslotPanel.tsx`
  - `reservations` 테이블을 `clinic_id + reservation_date`로만 read (L66-85). 근무표/영업시간 조인 없음.
  - 슬롯 = `aggregateByTimeSlot(rows)` 결과 = **예약이 존재하는 시간대만** (`src/lib/resvSlotAgg.ts` L125-142, Map 키 = 기존 예약의 reservation_time).
  - `slots.length === 0` → "이 날짜에 예약이 없습니다." (L125-128). 예약이 적으면 행도 적음.
- `src/components/ReservationDetailPopup.tsx` L1698-1723
  - reschedule 흐름 = 미니캘린더 날짜(pickedDate) → **패널의 슬롯 행 클릭(onSelectTime)** → `selectedSlotTime` → "이 시간으로 변경"(`rescheduleToSelectedTime`).
  - 즉 **이미 예약이 있는 시간대만** 변경 대상으로 선택 가능. 빈 시간대로는 이동 불가.
- 근무표/듀티/영업시간 미참조 확증: 슬롯 경로 3파일에 `duty|roster|operating_hour|business_hour|work_schedule|근무|available_slot|open_time|close_time` 매치 **0건**.

## 실측 스냅샷 (prod rxlomoozakkjesdqjtvd, service_role read-only)
스크립트: `scripts/T-20260716-foot-RESVDETAIL-CAL-AVAILTIME-EMPTY-RCA_probe.mjs`

```
날짜        active예약  표시슬롯수  slotTimes
2026-07-23(목)  11        9        10:30,11:00,11:30,13:30,14:00,17:30,18:00,18:30,19:00
2026-07-24(금)   2        2        15:00, 16:00                       ← 신고 대상
2026-07-25(토)  17        6        10:00,10:30,11:00,14:00,14:30,15:00
2026-07-30(목)   2        2        10:00, 14:00                       ← 신고 대상
2026-07-31(금)   4        4        11:00,14:00,14:30,19:00
```
= 7/24·7/30은 실제로 예약이 각 2건뿐. 슬롯이 2개만 뜨는 것은 **데이터 그대로의 정상 렌더**(코드 오작동 아님).
정상일(7/23=9슬롯)과의 차이는 순수하게 예약 건수 차이 — 요일/월말/타임존/off-by-one 필터 버그 아님.

## A/B/C 판별
- **A (근무표 미입력)**: 코드가 근무표를 참조하지 않으므로 **가설 자체가 성립 불가**. (배제)
- **B (로직버그: 요일/타임존/off-by-one 슬롯 필터 오작동)**: 정상일 대조 결과 필터는 정상 동작. 특정 날짜 누락·off-by-one **아님**. (배제)
- **C (만석)**: 정반대. 두 날짜는 거의 비어 있음. (배제)
- **⇒ 신규 분기 = 설계/시맨틱 갭.** "시간대별 예약 현황"(AC1, read-only 카운트 표시)이 "reschedule 시간선택기"(AC2)로 겸용되며 의미가 역전: 예약이 적을수록 선택지가 적어짐(가용성과 반대).

## 권고 (planner 스펙 결정 필요 — 자동 수정 보류)
현장 기대("예약가능시간")를 충족하려면 **영업시간 기반 전체 슬롯 그리드**를 렌더하고 그 위에 기존 예약 카운트를 오버레이해야 함. 그러나:
1. 영업시간·슬롯 간격(시작/종료/30분?) 정의가 코드/DB 어디에도 없음 → 원천 확정 필요.
2. "전체 그리드 + 예약수 오버레이" vs "기존 예약만" = 제품/UX 결정.
3. 태블릿 현장 confirm 대상.
→ P2 진단 티켓 범위를 넘는 설계 결정이므로 코드 무수정. planner 스펙 + 현장 confirm 후 별도 구현 티켓 권고.
