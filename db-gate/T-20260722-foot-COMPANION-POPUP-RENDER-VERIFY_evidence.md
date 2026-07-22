# T-20260722-foot-COMPANION-POPUP-RENDER-VERIFY — 화면-렌더 진단 (READ-ONLY)

- 진단자: agent-fdd-dev-foot
- 성격: READ-ONLY 코드경로 진단 (DB/코드 무변경, 비즈로직 변경 0)
- 대상 케이스: 본예약자[customer_id=2f222b4c] / 8/1 10:00 본예약 + 동행 동행자[resv=51e48e57]
- 원 데이터흐름 확인: dev-dopamine (MSG-20260722-225144-j1iw) — 본예약 `dbec22bc`(customer_id=2f222b4c) + 동행 `51e48e57`(customer_id=NULL) 모두 풋CRM에 `confirmed` 적재 완료

---

## 결론 요약

**정상(by-design). 데이터 버그 아님.** 단, "고객정보 팝업(휴대폰 조회)"와 EXPOSE-DECISION의 "예약상세 팝업"은 **서로 다른 화면**이며 동행 노출 경로가 다르다.

| 화면 | 조회 키 | 8/1 본예약(본예약자[customer_id=2f222b4c]) | 동행(동행자[resv=51e48e57], customer_id=NULL) |
|------|---------|--------------------|-------------------------------|
| **고객정보 팝업 = 고객관리 고객차트** (`CheckInDetailSheet` customerMode) | `customer_id` | ✅ 렌더 | ❌ 미렌더 (설계 의도) |
| **예약상세 팝업** (`ReservationDetailPopup`, 예약판 행 클릭) | 예약 row(r.id) | ✅ 렌더 | ✅ 렌더 + "동행자 연락처"(customer_real_phone) |

---

## AC1 — 조회 쿼리 로직 판정: **가설 B (개별 customer_id 매칭)**

"고객정보 팝업(휴대폰 조회)" = 고객관리 페이지(`src/pages/Customers.tsx`)에서 휴대폰으로 고객을 찾아 여는 **고객차트**(`CheckInDetailSheet` customerMode, T-20260511-foot-CUSTMGMT-DETAIL-SHEET).

- 휴대폰 검색: `Customers.tsx:108` `phone.ilike.%…%` 로 **customers 테이블**에서 고객 1건(본예약자[customer_id=2f222b4c], customer_id=2f222b4c) 해석.
- 그 뒤 차트 내부 모든 조회는 **`customer_id` 개별 매칭**:
  - `CheckInDetailSheet.tsx:663-666` — `reservations … .eq('customer_id', customerId)`
  - packages/check_ins/payments 전부 `.eq('customer_id', …)`

→ **본예약 phone 기준 '그룹' 조회가 아니다(가설 A ✗).** 예약을 customer_id로 개별 매칭하므로, **customer_id=NULL 인 동행행(51e48e57)은 이 팝업 쿼리 결과에 애초에 포함되지 않는다.**

## AC2 — 본예약자[customer_id=2f222b4c] 조회 렌더 결과

- 8/1 10:00 **본예약**: `dbec22bc.customer_id=2f222b4c` → customer_id 매칭 → **고객차트에 정상 렌더**.
- **동행(동행자[resv=51e48e57])**: `51e48e57.customer_id=NULL` → **이 고객차트(고객정보 팝업)에는 미표시**. 이는 누락 버그가 아니라 아래 설계에 따른 정상 동작.

## AC3 — 동행행 customer_id/phone=NULL 적재의 정상성 + 화면 구분

- **설계 근거(cross_crm_data_contract §4-2b, INV-3)**: 동행은 공유폰 collapse 방지를 위해 **진성 customers row를 만들지 않는다(customer_id=NULL)**. 대신 본인 실 신원은 예약 row의 `customer_real_name`/`customer_real_phone` 스냅샷으로 보존.
- 따라서 **customer_id 로 묶이는 고객차트에 동행이 안 뜨는 것은 설계상 당연**(동행은 본예약자[customer_id=2f222b4c]의 고객레코드에 종속되지 않음).
- **동행이 실제로 렌더되는 경로 = 예약판 + 예약상세 팝업** (이미 배포됨):
  - `Reservations.tsx` 예약판은 날짜/클리닉 기준으로 reservations row를 그리므로 8/1 10:00에 **동행행이 독립 예약카드로 렌더**된다.
  - `Reservations.tsx:1841 handleResvCardOpen` — customer_id=NULL(동행) 행 클릭 시 신규예약 오판 없이 `setDetail(r)` → **예약상세 팝업** 진입 (T-20260713-foot-COMPANION-RESVCLICK-NEWPOPUP-MISROUTE, 배포됨).
  - `ReservationDetailPopup.tsx:1473-1476` — `customer_real_phone` 존재 시 **"동행자 연락처"** 표시 (T-20260721-foot-COMPANION-PHONE-EXPOSE / EXPOSE-DECISION, 배포·field_soak until 2026-07-23).

### REDEFINITION_RISK(advisory) 해소
conflict_detail의 우려대로 **두 팝업은 다른 컴포넌트·다른 쿼리**다:
- EXPOSE-DECISION이 손댄 "예약상세 팝업" = `ReservationDetailPopup` (예약 row 기준) → **동행 표시함**.
- 본 티켓의 "고객정보 팝업(휴대폰 조회)" = `CheckInDetailSheet` customerMode (customer_id 기준) → 동행 미표시(설계).
→ 재정의/중복 아님. 인접-화면 렌더 검증(continuation)으로 확정.

## 시나리오 2 (엣지) — phone=NULL 동행행 오노출/중복

- 고객정보 팝업(customer_id 매칭)에서는 동행행이 아예 결과에 없으므로 **오노출·중복 위험 0**.
- 예약판에서는 동행행이 **본예약과 구분되는 별도 카드 1건**으로만 뜬다(중복 아님). customer_real_name=동행자[resv=51e48e57]으로 성함 표기.

---

## 판정 및 후속

- **정상 확인(TICKET-UPDATE)**: 데이터흐름 무결 + 두 화면 렌더 동작 모두 설계대로.
- **advisory(현장 기대 disambiguation 필요)**: 만약 박민지 TM팀장이 기대한 화면이 "**고객차트 안에서 본예약과 동행을 함께 묶어 보기**"라면, 이는 버그가 아니라 **신규 스코프 결정 사항**(동행을 customer_id 없이 고객차트에 그룹 노출 = 신설 기능)이다. 이 경우 planner가 scope 판정 후 별도 기능 티켓으로 분리 필요. → 원 스레드 현장 회신 시 "동행은 예약판/예약상세 팝업에서 확인" 안내 권장.

## 대조 소스
- `src/pages/Customers.tsx` (휴대폰 검색 → 고객 해석)
- `src/components/CheckInDetailSheet.tsx:624-704` (customerMode, customer_id 매칭)
- `src/pages/Reservations.tsx:1829-1848` (동행행 클릭 라우팅)
- `src/components/ReservationDetailPopup.tsx:1469-1476` (동행자 연락처 = customer_real_phone)
- cross_crm_data_contract §4-2b / INV-3 (companion identity 설계)
