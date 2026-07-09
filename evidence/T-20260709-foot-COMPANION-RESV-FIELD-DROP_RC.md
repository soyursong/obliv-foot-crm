# T-20260709-foot-COMPANION-RESV-FIELD-DROP — RC read-only 결론

**verdict: 가설 REJECT — foot-side drop/미매핑 아님. 수신부(EF INSERT + RPC) + FE 바인딩 모두 정상·main 배포됨.**
관측 공란의 실인자 = brief_note(간략메모) 단독, 도파민 emit 타이밍(013691e 이전 push된 stale row). foot 코드변경 불요.

---

## 1. RC read-only DB 조회 (prod rxlomoozakkjesdqjtvd) — 실 동행 row

`scripts/T-20260709-foot-COMPANION-RESV-FIELD-DROP_rc.mjs`

동행 row `bb7dcc73` (customer_id=NULL, external_id=`..._comp_동행이`, 2026-07-10):

| 컬럼 | 값 | 판정 |
|------|-----|------|
| customer_name | `동행이` | ✅ 값 있음 (성함 비공란) |
| customer_real_name | `동행이` | ✅ |
| visit_route (예약경로) | `TM` | ✅ 값 있음 |
| registrar_name (예약등록자) | `[도파민TM] 박민지` | ✅ 값 있음 |
| source_system | `dopamine` | ✅ (FE resolver fallback→'TM'/'도파민 등록') |
| memo (예약메모) | reservations.memo=NULL **but** `reservation_memo_history` timeline=`발톱무좀체크 [풋동행테스트 동행]` | ✅ SoT(timeline) 착지 |
| brief_note (간략메모) | `NULL` | ⚠ 유일 공란 |

- `reservations.is_companion` 컬럼 **미존재** — 동행 판정 = customer_id NULL + external_id `_comp_` 패턴(설계상 정상).
- 결론: **경로/등록자/메모 3필드는 DB row에 값 있음** → 티켓 분기표상 **detail-form 매핑 gap(=값 있음)**, ingest drop 아님.

## 2. 수신부 코드 정독 — 동행 필드 drop 0 확인

- **ingest EF fresh INSERT (`rsvPayload`, index.ts:594-639)**: `is_companion`은 customer_id/customer_phone만 gate. brief_note/registrar_name/visit_route/customer_name/customer_real_name는 동행도 동일 삽입. memo→`syncReservationMemoToTimeline`.
- **RPC `upsert_reservation_from_source` (mig 20260708150000, 18-arg)**: `p_is_companion` → customer_id/phone만 NULL. registrar_name/brief_note/customer_real_name/memo(timeline) 전부 write. (visit_route는 EF INSERT 소유 — 실 row로 확인.)

## 3. write-path 실왕복 functest (GREEN)

- `scripts/functest_20260708150000_brief_note.mjs`: RPC brief_note 신규/보존/갱신 = ✅✅✅ (prod 라이브 확인).
- `scripts/T-20260709-foot-COMPANION-RESV-FIELD-DROP_functest.mjs` (is_companion=true, phone=NULL):
  - customer_id=NULL ✅ / customer_name=동행이 ✅ / customer_real_name=동행이 ✅
  - registrar_name=`[도파민TM] 박민지` ✅ / brief_note=`발톱무좀` ✅ / source_system=dopamine ✅
  - memo→timeline=`동행 상담메모` ✅
  - **결과: 동행 필드 drop 0.** cleanup 완료.

## 4. FE 바인딩 정독 (ReservationDetailPopup.tsx) — 동행도 표시됨

- 이름(1400): `customer?.name ?? reservation.customer_name` → 동행이(fetchWeek `select('*')` → detail 전달).
- 예약경로(1544 editable): `resolveVisitRouteDisplay(visitRoute,'dopamine')`='TM'.
- 예약등록자(1566/1572): `source_system==='dopamine' && !registrar_id` → `resolveRegistrarDisplay('[도파민TM] 박민지',...)` 표시.
- 예약메모(1813): `ReservationMemoTimeline(reservationId=동행 id)` → timeline read.
- 간략메모(489): `detailBriefNote = reservation.brief_note ?? ''`.
- resolver(types.ts:813/840): 'dopamine' 공란 방지 fallback 정상. 전부 main 커밋·배포됨(410a9762/b9d0b041/a5c420ba).

## 5. AC 게이트

- **AC3(연락처 없이 저장 stop-gate)**: 미터치 — DDL 0, customers write 0, 동행 customer_id=NULL 유지. dummy-phone invariant(T-20260706) 무접촉 → 재게이트 불요.
- **AC4(체크인 phone-match 배제)**: 검증 OK. NewCheckInDialog:204 `normalizedInputPhone && r.customer_phone` 양쪽 truthy 요구 → NULL-phone 동행 skip. foot-checkin SelfCheckIn:1841 digits-match도 `customer_phone ?? ''`→ E164/8자리 매칭 불성립. 오매칭 0.

## 6. 결론 / 권고

- **foot 코드변경 불요.** 가설(경로/등록자/메모 foot drop) = RC로 REJECT.
- 관측 공란 = brief_note 단독, dopamine 013691e(emit) 이전 push된 stale row. 013691e 배포 후 **신규** 동행 push는 4필드 전부 채워짐(수신부 이미 배선·라이브).
- confirm-gate 권고: 013691e 배포 후 **신규 동행 1건 재관측** → 4필드+성함 채워짐 확인 시 종결. (기존 stale row는 소급 채움 대상 아님 — 백필 필요 시 별도 판단.)
