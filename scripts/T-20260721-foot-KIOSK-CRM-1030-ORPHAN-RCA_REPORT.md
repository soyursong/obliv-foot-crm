# T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA — RCA 결과 (READ-ONLY, DB 무변경)

**결론: 분기 (A) 실환자.** orphan/E2E더미 아님. **DELETE 대상 없음** → TEST-DUMMY-CLEANUP 인계 없음(ping-pong 차단).
**단, planner 가정(대시보드 표시필터/FE 바인딩)과 근본원인이 다름 → 재정의(redefinition) 발생.**

날짜: 2026-07-21 (KST) · 작성: dev-foot · mutation 0 / DELETE 0

---

## 1. 현장 신고 vs 실체

- 신고: 키오스크 10:30 명단에 `ㄱ*******ㄴ`(빨간박스, 마스킹)이 뜨는데 CRM 대시보드 10:30엔 없음.
- **실체: `ㄱ*******ㄴ` = 강승은 (실환자, dopamine 예약, is_simulation=false).**
  - 대시보드 스샷(dashboard_new_1.png, 09:20) 10:30 빨간박스 = 서경숙3123·문봉수2823·**강승은3969** → 강승은은 대시보드에 **이미 정상 표시되고 있었다.**
  - 즉 "대시보드에 없는 고객"은 **오인**이다. 키오스크에서 마스킹이 깨져(`ㄱ*******ㄴ`) 대시보드의 `강승은`과 동일인임을 알아보지 못한 것.

## 2. 근본원인 (RC) — 확증

**강승은 `customers.name` 이 유니코드 NFD(자모 분해)로 저장 → 키오스크 서버측 마스킹 함수가 codepoint 단위로 동작 → 마스킹 결과가 깨짐.**

- 대상 고객: `f137fe98-30b2-4a66-bcc0-73bc68277b58`, phone `+82109362`**`3969`** (대시보드 "강승은 **3969**" 칩과 일치).
- UTF-8 hex dump: `e18480 e185a1 e186bc | e18489 e185b3 e186bc | e1848b e185b3 e186ab`
  = U+1100(ᄀ) U+1161(ᅡ) U+11BC(ᆼ) / U+1109(ᄉ) U+1173(ᅳ) U+11BC(ᆼ) / U+110B(ᄋ) U+1173(ᅳ) U+11AB(ᆫ)
  = **conjoining Hangul Jamo (NFD)**, 완성형 음절(U+AC00~) 아님.
- `char_length(raw)=9` (자모 9개), `char_length(NFC)=3` (음절 3개).
- 마스킹 함수 `fn_selfcheckin_today_reservations`(mig 20260711120000)의
  `left(nm,1) || repeat('*', char_length(nm)-2) || right(nm,1)` 를 raw 에 적용 →
  `ᄀ` + `*`×7 + `ᆫ` = **`ᄀ*******ᆫ`** (화면상 `ㄱ*******ㄴ`).
- 동일 함수를 `normalize(nm, NFC)` 후 적용 → **`강*은`** (기대값).

| | 강승은 |
|---|---|
| mask_raw (키오스크 현행) | `ᄀ*******ᆫ` ✗ |
| mask_nfc (기대) | `강*은` ✓ |

**대시보드는 마스킹을 하지 않고 raw 이름을 렌더 → NFD/NFC 시각적으로 동일하게 `강승은` 표시 → 문제 없음.** 그래서 대시보드=정상, 키오스크=깨짐 의 비대칭이 발생.

## 3. 대시보드 vs 키오스크 필터 대조 (ticket step-3)

- 키오스크: `fn_selfcheckin_today_reservations(clinic, date)` = `clinic_id + reservation_date + status='confirmed'`, 서버측 마스킹.
- 대시보드(Dashboard.tsx L4283): `clinic_id + reservation_date + status<>'cancelled'` → `stripSimulationRows()`(is_simulation=true 숨김).
- **차이는 sim 필터가 맞지만, 본 건은 sim 무관**(강승은 is_simulation=false, 대시보드에 정상 노출됨). 표시 누락 원인 아님. 진짜 원인은 §2 NFD 마스킹.

## 4. 3분기 판정 근거 (AC-1)

- (A) 실환자 ✅ — 강승은: is_simulation=false, source_system=dopamine, phone 유효, 대시보드 정상 노출.
- (B) orphan ✗ — customer_id 정상 FK(강승은 레코드 존재), dangling 아님.
- (C) E2E더미 ✗ — 이름 자음-only 아님(NFD 완성형 3음절), prefix(cf1-new-/단계이동_/칸반테스트_) 불일치.
  - (참고: 금일 jongno E2E prefix 더미 9건·`총괄테스트3/4` 등은 별건 — 본 10:30 대상과 무관.)

## 5. NFD 오염 범위 (blast radius) — 잠재 2차 결함

`char_length(name) <> char_length(normalize(name,NFC))` 인 **실환자 3건 (전부 jongno, is_simulation=false)**:

| id | name(NFC) | cp_len | created_at |
|---|---|---|---|
| b734f069-5a06-414b-9ad6-f32ee3b3bf2c | 백민석 | 9 | 2026-07-16 |
| f137fe98-30b2-4a66-bcc0-73bc68277b58 | 강승은 | 9 | 2026-07-20 |
| 0fc0752c-7ccd-4a71-85ec-b7e4e5f20527 | 천승환 | 9 | 2026-07-20 |

- 모두 dopamine 유입 시점대 → **상류(도파민 push / 입력기)에서 NFD 로 유입되는 경로 추정.**
- **잠재 2차 결함(마스킹 표시뿐 아니라):** 이름 기반 검색·중복판정·매칭이 NFC 리터럴과 안 맞음.
  - RCA 중 `WHERE name LIKE '%강승은%'`(NFC) 가 **0건 반환** = 스태프 이름검색/dedup 도 동일하게 실패함을 실증.

## 6. AC-4 — SELFCHECKIN-TODAYRESV-NOSYNC 역회귀 점검

- 그 배포(FE p_date KST TZ 수정, foot-checkin repo)는 "키오스크 오늘예약 0행"을 고친 건 → 현재 키오스크가 오늘 confirmed 행(강승은 포함)을 **정상 조회**함 = 그 수정 정상 동작. **역회귀 없음.**
- 본 NFD 마스킹 결함은 마스킹 함수(mig 20260711120000, 2026-07-11)에서 유래한 **선재(pre-existing) 결함** — TZ 수정과 무관.

## 7. 권고 (fix 는 별도 게이트 티켓 — 본 read-only 티켓 밖)

planner 가정(FE 표시필터, db_change=false)은 실제 RC와 불일치. 실제 수정은 DB 를 건드림:

- **Fix-1 (표시 즉시 교정):** `fn_selfcheckin_today_reservations` 마스킹 입력을 `normalize(nm, NFC)` 로 감쌈.
  - CREATE OR REPLACE (ADDITIVE), owner=postgres SECDEF → **supervisor DDL-diff DB-GATE + MIG-GATE 4필드**. db_change=**true**.
- **Fix-2 (근본·잠재결함 제거):** `customers.name` NFD→NFC 정규화 백필 (위 3건 + 상시 가드).
  - 데이터 정정 mutation → **§S2.4 DA CONSULT 게이트 + Cross-CRM Data-Correction Backfill SOP + supervisor DB-gate**.
  - 상류(도파민 push 경로) NFC 정규화까지 봐야 재유입 차단.

→ redefinition_risk=WATCH 현실화. 재스코프·게이트 부여는 planner/DA 소관 → FOLLOWUP 로 반환.
