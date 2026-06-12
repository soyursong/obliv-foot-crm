# T-20260612-foot-RESV-REVISIT-NOT-LISTED — 진단 결과 (오진 정정)

> 결론: **코드 버그 아님. visit_type 필터 회귀 아님.** 원인은 `is_simulation`
> (T-20260610-foot-ADMIN-SIM-FILTER 의도된 동작). planner NEW-TASK
> (MSG-20260612-134950-s10q)의 visit_type 가설은 코드·데이터 양쪽에서 불성립.
> → 사전설계 `_Bpath_predesign.md`가 식별한 **동일 A/B 사람 결정**으로 회귀. 착수 보류.

## 1. 진단 우선순위별 결과

### ① 회귀 1순위 (24dd40f, REFERRAL-VISITTYPE-CHECKBOX) → 배제
- `git show 24dd40f --stat`: `src/lib/htmlFormTemplates.ts` 단일 파일, +2/-1.
- 진료의뢰서 인쇄 양식의 외래/입원 체크박스 정적 표기만 변경. 예약관리·대시보드
  목록 쿼리와 무관. **회귀 아님.**

### ② 예약관리 vs 셀프접수 WHERE 차이 → visit_type 필터 자체가 없음
- `Reservations.tsx` L379-385 fetchWeek 쿼리: `clinic_id` + `reservation_date`
  범위 + order. **visit_type 조건 0개.** L393 `stripSimulationRows` 적용.
- `Dashboard.tsx` L3758-3770 타임라인 쿼리: `clinic_id` + `reservation_date` +
  `status != cancelled`. **visit_type 조건 0개.** L3770 `stripSimulationRows` 적용.
- 셀프접수 명단(SelfCheckIn.tsx L1028)은 RPC `fn_selfcheckin_today_reservations`
  → sim strip **미적용** (anon 키오스크 RLS로 FE strip 불가).
- → 분기점은 visit_type이 **아니라** `stripSimulationRows`(=customers.is_simulation).

### ③ 대시보드 공통 필터 → 동일하게 stripSimulationRows
- 타임라인·체크인 칸반 모두 L3625/3770/3793 `stripSimulationRows` 경유. 단일 원인.

## 2. 데이터 실측 (dev DB rxlomoozakkjesdqjtvd, 2026-06-12)

```
토마토 고객: is_simulation = TRUE  (id 45adae8f…463f, clinic 74967aea…b8c8)
토마토 6/12 예약: visit_type=returning, status=checked_in  ← 데이터 정상 생성
오늘 비취소 예약 66건 → admin 노출 63 / sim 숨김 3 / 실고객 오숨김 0
visit_type 분포: new=29, returning=37  ← 재진 예약 정상 노출 중
```

- 실고객(is_simulation=false/NULL) 재진 예약은 **모두 정상 노출**. strip 정확(누락 0).
- 토마토 재진이 안 보이는 유일 사유 = 고객이 sim. visit_type=new였어도 동일하게 숨김.
- 현장이 "신규는 보이고 재진은 안 보임"으로 인지한 것은, 신규 예약은 비-sim 고객으로,
  재진 예약은 기존 sim 고객(토마토)으로 만든 우연한 상관일 뿐 인과 아님.

## 3. 왜 코드를 고치면 안 되는가

- AC "재진 예약을 예약관리/대시보드 노출"을 토마토(sim)에 적용하려면 admin 화면에서
  sim 고객을 보이게 해야 함 → **T-20260610-foot-ADMIN-SIM-FILTER 의도 기능을 되돌림**
  → 전 지점 admin 목록에 테스트 더미 재유입 (반대 방향 회귀).
- 따라서 올바른 해법은 visit_type/쿼리 수정이 아니라 **A/B 사람 결정**:
  - **A**: 토마토가 실환자 오플래그 → 데이터 정정(`is_simulation=false`) → 어디서나 노출.
    (단 이름이 "토마토"=테스트 정황 강함, 정정 시 실 admin 목록 오염 위험)
  - **B**: 토마토=테스트 → 셀프접수 RPC에도 sim 필터 추가 → 어디서나 일관 숨김
    (= `_Bpath_predesign.md` 작업 범위, 비대칭 해소).

## 4. 권고

- planner에 오진 정정 FOLLOWUP 발행. visit_type 코드 수정 **착수 안 함**.
- 김주연 총괄 A/B 결정 수령 후 해당 path로 전환(B면 사전설계대로 RPC 1줄, db_change →
  supervisor 승인). 결정 전까지 보류 유지.

---
*작성: dev-foot · 2026-06-12 · 코드(Reservations/Dashboard/simulationFilter) + dev DB 실측 기반*
