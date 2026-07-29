# T-20260729-foot-REDPAY-RESEND-REPORT-DELIVER-CRIT2-AUDIT — 산출물 재제출 + 근거#2 유효성 감사 (증거)

- 실행: 2026-07-29 (prod rxlomoozakkjesdqjtvd, **READ-ONLY**)
- 스크립트: `scripts/T-20260729-foot-REDPAY-RESEND-REPORT-DELIVER-CRIT2-AUDIT_audit.mjs`
- 원자료: `evidence/.../audit_result.json`
- 범위: 결제·매칭·매출 산정 경로 **무접촉**. SELECT/집계 + EF 로그 조회만(write 0건). 스키마·데이터·코드·TTL 무변경.
- parent: `T-20260729-foot-REDPAY-RESEND-CRITERION-DECIRCULARIZE` (deployed 610f4cdb, 09:35)

---

## AC-1 — 7/28 하루치 **전체** 재집계 (수치 표)

### (a) 전체 건수 / 도착 지연(received_at − approved_at) 통계

| 항목 | 값 |
|------|-----|
| 전체 수신 행(7/28 KST) | **43건** (webhook형 3 / poller형 40) |
| 도착지연 산출가능(양 타임스탬프 존재) | **40건** (approved_at 없는 3건 제외 = 취소/무승인 이벤트) |
| 평균 도착지연 | **100.9초** |
| **중앙값** 도착지연 | **59.2초** |
| 최대 도착지연 | **245.3초 (4분 5초)** |
| 최소 / 음수 | 19.9초 / 0건 |

> 43건 중 실 저장 캡처의 **93%(40건)가 poller 경로**. webhook 200-응답은 43건이나 대부분 타센터·flag-off·business_no 필터로 drop(미적재), 실제 webhook-shape 적재는 3건. ⇒ 도착지연 분포는 webhook 지연이 아니라 **폴러 폴링주기 꼬리**가 지배.

### (b) '진짜 재전송' 판정 건수 + 걸린 기준

| 근거 | 정의 | 판정 |
|------|------|------|
| #1 event_id 중복수신 | event_id 그룹 count>1 | **0건** (단 dedup 하류 — AC-7, 신뢰불가) |
| #2 재전송/재시도 표시 필드 | payload 내 retry/attempt/redelivery | **기준 무효(필드 부재)** — AC-2 |
| #3 재시도주기(1/5/30분) 정합 tight[+0,+15s] | latency ≈ {60,300,1800}s | **1분창 2건** / 5분창 0 / 30분창 0 |

근거#3 걸린 2건 (둘 다 poller-shape, event_id 無):

| external_trxid | delay | 판정 |
|---|---|---|
| 0728C8552027 | 60.5s | 1분 경계 근접 — (C) 후보 — 우리 데이터 판정불가(레드페이 발송 로그가 결정적 근거) |
| 0728C8528816 | 61.5s | 1분 경계 근접 — (C) 후보 — 우리 데이터 판정불가(레드페이 발송 로그가 결정적 근거) |

> **DB 상 확정 재전송 = 0건.** 근거#1은 dedup 하류라 무의미, 근거#2는 무효, 근거#3의 2건은 단일축(latency)·poller형 근접값 = **확정 아닌 (C)형 후보(우리 데이터 판정불가)**.

### (c) 재전송 제외 '정상 경로만' 도착지연

| 시나리오 | n | 평균 | 중앙값 | 최대 |
|---|---|---|---|---|
| 확정 재전송 0건 → 정상경로 = 전체 40 | 40 | 100.9s | 59.2s | 245.3s |
| (C)후보 2건까지 제외(보수) | 38 | **103.0s** | 58.7s | 245.3s |

> 2건을 빼도 평균이 오히려 **오름(100.9→103.0)**, 최대 불변(245.3s). ⇒ 2건은 이상치(재전송 클러스터)가 아니라 **연속 폴러-지연 밴드의 일부**. 재전송 군집 지문 없음.

---

## AC-2 — ★근거#2(재전송 표시 필드) 유효성 감사

**결과: raw_payload 어디에도 재전송/재시도 표시 필드가 실존하지 않음 → 근거#2는 "0건 탐지"가 아니라 「기준 자체 무효(필드 부재)」.**

- retry/attempt/retry_count/redelivery/is_retry/delivery_attempt/headers … 후보 키 **0 / 43행**.
- payload 전 키 유니버스(7/28 전체):
  - webhook형 top-level: `_mode, _source, event_id, event_type, occurred_at, data`
    - `data`: `tid, trxid, amount, status, approval_no, business_no, merchant_id, merchant_name`
  - poller형 top-level: `tid, trxid, amount, status, pg_name, pg_type, merchant, order_no, root_trxid, approval_no, approved_at, status_name, cancelled_at, payment_method`
- 실 retry-count 가 실릴 **HTTP 헤더는 raw_payload 미적재**(본문만 저장) → 구조적 부재.

⇒ 최필경 총괄의 raw payload 직접 확인 심증 **실증 확정**. 분류·결론은 근거#1·#3(+ AC-6 non-2xx)만으로 재진술.

---

## AC-7 — event_id dedup 구현 여부

- **dedup 구현됨**: `redpay-webhook` EF `upsert onConflict(external_trxid, external_status, amount) DO UPDATE`. 동일 event_id·폴러 선행분 모두 **같은 행에 수렴(멱등)**, received_at만 최신 덮음.
- event_id 보유행 3/43, 중복 그룹 0.
- **함의**: '중복 event_id 0건'은 "재전송 없음"이 아니라 "**dedup으로 소거되어 중복행 미잔존**"과 **구분 불가**. ⇒ 근거#1은 재전송 유무 판정에 신뢰 불가(dedup 하류 관측).

---

## AC-6 — 수신부(EF) non-2xx 응답 이력 = (B)형 재전송의 결정적 근거

7/28 `redpay-webhook` 수신부 응답코드(function_edge_logs):

| method | status | 건수 | 의미 |
|---|---|---|---|
| POST | 200 | 43 | 정상/의도적 drop(재시도 불필요) |
| GET | 405 | 1 (19:54:42) | 결제 payload 아님(RedPay는 GET 미발송) — 재시도 트리거 아님 |
| **POST** | **503** | **1 (16:43:16 KST)** | **플랫폼 레벨 non-2xx(핸들러 미도달=event_id/payload 미적재). RedPay 발송이었다면 재시도 대상.** |

⇒ **non-2xx POST = 1건.** parent의 "재시도헤더 0 → 재전송 0" 결론과 달리, 수신부에 **(B)형 재전송 트리거 후보 1건**이 존재. "(B)형 재전송 0건 확정" 불가.
(503 직후 +40분 내 webhook 200-POST 재도착 없음 → 해당 결제가 RedPay였다면 재시도가 실패했거나 poller 경로로 최종 캡처됐을 가능성. 우리 로그로는 원 요청 정체 확정 불가.)

---

## AC-3 — 진짜 30분 지각분 재확정

- 재시도 30분 창(1800s) 정합 = **0건** (tight·wide 공통). 최대 지연 245.3s = 30분 경계보다 25.9분 이르름.
- ⇒ **우리 측 DB 기준 진짜 30분 지각분 = 0건.** 단, (C)미도달형은 DB에 흔적을 남기지 않으므로 **"전체 0건 확정"은 단정 불가**(AC-8).

---

## AC-8 — 재전송 (B)/(C) taxonomy + 외부 로그 의존

| 유형 | 정의 | 우리 데이터 판정 | 7/28 결과 |
|---|---|---|---|
| **(B) 도달 후 오류응답형** | 수신부 도달 → 401/500/플랫폼503 → RedPay 재시도 | 가능(AC-6 non-2xx 로그) | **1건** (503 POST 16:43:16) |
| **(C) 미도달형** | 네트워크·순간장애로 수신부 미도달 → RedPay 재시도. 최종성공 1회만 저장 → 중복0·응답코드이력0 | **판정 불가** | 미상. 1분창 근접 2건 = (C) 후보 — 우리 데이터 판정불가(레드페이 발송 로그가 결정적 근거) |

- **(C) 실증 폐쇄 = 외부 의존**: RedPay 7/28 발송 로그(재시도 이력 포함) 대조 필요. 우리 측 데이터로 폐쇄 불가.

---

## AC-4 — 무영향 확인

- 발화 전수 `WITH/SELECT` + EF 로그 조회. DML 부재 self-check **PASS(SELECT/log-read only)**.
- payments / pending_payment / service_charges / 매칭 write **0건**. 회귀 0. 스키마·데이터·코드·TTL 무변경.

---

## 결론 (미배정 결제함 설계 근거 / TTL 최종확정 조각)

1. 7/28 도착지연: 평균 100.9s · 중앙값 59.2s · 최대 245.3s(4분5초). 43건 중 40건 poller 캡처 = **폴링주기 지연이 실체**.
2. 근거#2(재전송 표시 필드)는 **무효(부재)** — "0 탐지" 아님. 근거#1은 dedup 하류라 신뢰 불가.
3. **(B)형 재전송: 우리 non-2xx 로그 기준 1건**(503 POST). "(B)형 0건" 아님.
4. **(C)미도달형: 우리 데이터로 판정 불가** — RedPay 발송 로그 대조 필요. 1분창 2건 = (C) 후보(우리 데이터 판정불가).
5. 진짜 30분 지각분: **우리 DB 기준 0건**이나 (C) 사각지대로 "전체 0건 확정" 단정 불가.
⇒ 미배정 결제함 설계는 "**수분 내(≤~4분) 폴러 지연**"이 실체이되, (B)형 1건·(C) 미상을 감안한 폴백 필요. **완전 폐쇄는 RedPay 발송 로그 요청 여부(현장/총괄 판단)에 달림.**
