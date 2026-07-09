# T-20260709 풋-측 회귀-verify — dopamine WRITEPATH-INPLACE post-deploy 정합

**verdict: AC-3 전항목 PASS — 풋 upsert 경로 회귀 0. dopamine AC-3 완결 조건 충족(orphan row / 재발번 0).**
read-only 검증(계약·DDL 무변경, db_change=false). foot 코드변경 불요.

ref: T-20260709-dopamine-RESCHEDULE-COMPANION-WRITEPATH-INPLACE (AC-3, commit 1707885, deployed 17:10)

---

## 1. 배경

dopamine BookingModal: liveness=dead→cancel+재생성 경로 제거 → `rescheduleMainReservationInPlace()`로
본예약 row in-place UPDATE(created_at 미터치·방문일만 갱신, cue_card_id 유지). CRM 재push =
`createCrmReservation(external_id=cue_card_id 멱등 UPSERT)`. 풋 수신 경로는 동일 upsert 경로
(`upsert_reservation_from_source`, cross_crm_data_contract §4)이므로 풋-측 post-deploy 정합 회귀-verify.

## 2. 코드 경로 정독 (회귀 0 근거)

- **ingest EF** `reservation-ingest-from-dopamine/index.ts:407-506`: (source_system, external_id) 선조회 →
  기존 행 발견 + date/time 상이 → `isReschedule` → RPC `upsert_reservation_from_source`로 **동일 external_id** 위임.
- **RPC** (mig 20260708150000, 18-arg 최종 권위 body) `:192-209`: `ON CONFLICT (source_system, external_id)
  DO UPDATE` → 기존 행 UPDATE(RETURNING 동일 id), 신규행 INSERT 아님. `p_is_companion=true` → customer_id NULL 유지(§444).
- 멱등키 = `UNIQUE(source_system, external_id)` partial index → 동일 external_id 재push는 항상 UPDATE로 수렴.
- dopamine in-place(cue_card_id 유지) ⇒ 본예약 external_id·동행 composite external_id 모두 안정 →
  구(cancel+재생성=new cue_card_id) 경로에서 발생하던 orphan/재발번 원천 제거.

## 3. 라이브 functest (prod rxlomoozakkjesdqjtvd, 왕복 + cleanup 순소실 0)

`scripts/T-20260709-foot-COMPANION-RESV-FIELD-DROP_reschedule_inplace_verify.mjs`

| AC | 검증 | 결과 |
|----|------|------|
| ① 본예약 리스케줄 | 동일 external_id → **동일 id UPDATE**, 행수=1(신설 아님), date/time 갱신, status 유지 | ✅ |
| ② 동행 리스케줄 | 동일 composite external_id → 동일 id UPDATE, 행수=1(**orphan 무발생**), customer_id=NULL 유지, 본예약≠동행 별개 행 | ✅ |
| ③ outbox retry 무회귀 | 동일 payload 2회 재호출(retry 재현) → 본예약/동행 각 행수=1(멱등), cue_card 전체 행수=2(재발번/orphan 0) | ✅ |

실측 id: 본예약 `b1fd868b…`(리스케줄 전후 불변), 동행 `f5e51848…`(리스케줄 전후 불변, customer_id=NULL).

## 4. 결론

- **orphan row / 재발번 0** → dopamine AC-3 완결 조건(조건1: 풋 동일 external_id UPDATE·orphan 무발생) 충족.
- dopamine_to_crm_outbox retry는 풋 수신부 멱등키로 항상 동일 행 수렴 → 무회귀.
- 풋 코드변경 불요(read-only 검증). 회귀 미발견 → FOLLOWUP 불요, dopamine 티켓 회신용 완결 근거로 제출.
