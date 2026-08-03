# T-20260803-foot-REDPAY-POLLER-0722-INGESTION-GAP-ROOTCAUSE — READ-ONLY 진단 EVIDENCE

- domain: foot · obliv-foot-crm · **READ-ONLY** 진단 (ef_only, mutation 0, DDL 0, 자동백필 미실행)
- 진단자: agent-fdd-dev-foot · 일시: 2026-08-03
- 인증컨텍스트: **service_role**(DB 전건 관측) + **RedPay 조회API live pull**(한국IP=macstudio) — cross-CRM 진단 인증컨텍스트 표준 준수(0-row 를 "wipe"로 오독 금지)
- 부모: `T-20260803-foot-REDPAY-NOTXN-SCAN-CANCELPAIR-FILTER-AUDIT`(verdict: 필터버그 아님, 잔여권고 A)
- 자매: B=`NOTXN-SCAN-3STATE-MODEB-PERSIST`(관측성 지속/DDL) · C=`0722-MISS-BACKFILL-SOP-ENVELOPE`(소급 재적재 봉투)
- 재현 스크립트(본 커밋 동봉, write 0): `_dualbizno_probe.mjs`(AC-1 bizno 버킷 확정) / `_ac2_sweep.mjs`(AC-2 전기간 feed↔raw delta1)

---

## 결론 3줄

1. **AC-1 근본원인 확정(추정→확정):** 7/22 미적재 = **business_no flip(511→457) seam**. 폴러는 매 사이클 **단일 business_no** 로만 조회하고(union 없음), 07-22 종일 당시 정본 **511** 로 date=2026-07-22 를 5분마다(거래 17:30 이후 6.5h) 조회했으나 **511 피드는 07-22 종일 0행 반환**(로그 `fetched=0` 전 사이클). 문제의 2건은 **457 버킷에만 존재**(live probe: 457→2, 511→0). 즉 거래가 **폴러가 읽던 단일 스코프(511) 밖**에 있었다.
2. **영구화 enabler(구조결함):** **forward-only·date-granular·2h max-lookback 증분커서 + foot 적재용 daily_full 재스윕 백스톱 부재 + flip 구간 cross-bizno union 부재.** KST 07-23 00:00 에 커서가 date 를 07-23 로 넘긴 뒤 **date=07-22 를 다시는 조회하지 않음**. 07-23 20:00(KST) 457 전환 후에도 최근 date 만 조회 → 실제 행이 있는 457 버킷으로 **07-22 를 재조회하는 경로가 원천 부재** → transient feed 공백이 **영구 silent-miss** 로 고착.
3. **AC-2 범위 확정: single-shot(비-systemic).** 폴러 전 생애(07-11~08-02) feed↔raw count-first delta1 스윕 = **07-22 단 1일만 under-ingestion(Δ2건, TID 1047479158, merchant 1777289012, net 0원)**, 그 외 전일 raw≥feed·net 일치. 현장 우려("다른 지점 실 취소도 조용히 누락?")에 대한 직답 = **관측기간 내 타 날짜·타 merchant silent under-ingestion 0건.** 단 위 구조결함은 **재발조건(차기 bizno flip·KST자정 걸친 정산지연/다운타임)에서 동일 영구누락을 재생산할 수 있는 systemic 잠재**를 보유.

---

## AC-0 (중복방지) — RECONCILE-COVERAGEGAP 와 별개 층위: **확인**

| 축 | `T-20260802-...-RECONCILE-COVERAGEGAP` | **본건(0722-INGESTION-GAP)** |
|---|---|---|
| 층위 | reconcile **매칭풀**(payments `since14d` aged-out) | **적재 자체**(redpay_raw_transactions **raw 0행**) |
| 증상 | 적재는 됐으나 14d 내 매칭 못해 대사풀 이탈 | 애초에 raw 파이프에 **미진입**(feed엔 실재) |
| 대상 | payments(card orphan 38 + non-card 6) | RedPay feed 2건이 raw 0행 |
| 인과위치 | 하류(매칭) | **상류(수집)** |

→ 본건은 인과 **상류(수집)** 의 별개 결함. COVERAGEGAP 처방(매칭풀 lookback)으로는 해소 불가(raw 자체가 없으므로 매칭할 대상이 없음). **중복 아님.**

---

## AC-1 (근본원인 코드경로 특정) — **확정: business_no flip seam + 증분커서 forward-only**

### 후보 5종 판정
| 후보 | 판정 | 근거 |
|---|---|---|
| 폴러 **실행공백**(launchd 다운) | **아님** | 07-22 종일 5분주기 연속 가동(`business_no=511-60-00988` 683 라인, `완료` 287 사이클). 크래시/공백 창 없음 |
| **조회창 파라미터** | **부분원인(enabler)** | 증분커서 forward-only. KST 07-23 00:00 이후 date=07-22 **재조회 안 함**(로그: `from=2026-07-22&to=2026-07-22` 마지막=07-22T14:59Z=KST 23:59) |
| **merchant/bizno 스코프 union 누락** | **★1차 원인** | 폴러 fetch 는 **단일 business_no** 스코프(`poller.mjs:526 business_no=REDPAY_BUSINESS_NO`). {511 ∪ 457} union 없음 → flip seam 에서 457-booked 행 불가시 |
| 조회API **페이지네이션** | **아님** | 07-22 feed_total 자체가 0(511) — 페이지 순회 이전 문제 |
| **에러 삼킴** | **아님** | 07-22 전 사이클 200 OK·`errors=0`. non-2xx/예외 로그 없음. 조용한 200-empty(정상형 0건) |

### 결정적 실측 (hard evidence)

**(1) 폴러 로그 — 07-22 종일 511 로 조회, feed 0행 (`~/logs/redpay_macstudio_poller.out`)**
```
07-22 가동 라인 business_no: 511-60-00988 × 683 (전량, 공백/폴백 0, BIZNO-READFAIL 0)
07-22 08:33:51Z 사이클(거래 08:30:13Z 3분 후): url=…from=2026-07-22&to=2026-07-22 (X-API-KEY 200 OK)
07-22 전 사이클 완료: fetched=0 scoped_out=0 drift=0 upserted=0 errors=0  (287/287 cycle)
07-22 max_fetched=0  sum_upserted=0   ← 511 피드가 07-22 종일 0행
대조 07-20 max_fetched=26 sum_upserted → 511 시대에도 26행 정상 수집(대조군)
커서 date-roll: 마지막 date=07-22 조회 07-22T14:59Z(KST 23:59) → 이후 date=07-23 (KST자정 경계)
bizno flip(폴러): 마지막 511=07-23T10:55Z / 첫 457=07-23T11:00Z (=KST 07-23 20:00)
```
→ 폴러는 **정상 가동 + 정상 bizno(511) + date=07-22 를 거래 직후부터 6.5h 반복조회**했으나, **511 피드가 07-22 를 0행으로 반환.** 실행공백·에러삼킴·페이지네이션 전부 배제.

**(2) dual-bizno live probe (`_dualbizno_probe.mjs`, 2026-08-03) — 2건이 어느 버킷에 있나**
```
date=2026-07-22  457(현행): feed_total=2 foot=2 merchant1777289012=2건
                   · Y +5000 trx 0722C8038056 tid 1047479158 appr 17:30:13
                   · N -5000 trx 0722C8038132 tid 1047479158 appr 17:30:56
                 511(구):    feed_total=0 foot=0 merchant1777289012=0건
date=2026-07-20  457(현행): feed_total=47 foot=26 net 5,931,200 (=이미 적재된 26행)
                 511(구):    feed_total=0 (flip 후 전 이력이 457로 귀속)
```
→ 문제의 2건은 **457 버킷에만 존재.** 07-22 종일 폴러가 읽던 **511 스코프 밖.** = 단일-bizno 조회의 flip seam 이 1차 원인.

### 근본원인 서술 (확정)
> **폴러는 사이클당 정확히 하나의 `business_no` 로만 fetch 한다(union 부재). 07-22 의 거래(단말 1047479158/merchant 1777289012, 즉시 승인-취소 net0)는 457 버킷에 booked 됐으나, 그 시각 폴러는 당시 정본 511 로 date=2026-07-22 를 조회 중이었다 → 511 피드가 07-22 를 0행 반환 → 수집 스코프 밖으로 누락.** 이 transient 불가시(feed 공백)가 **영구** 누락이 된 이유 = **증분커서가 forward-only(date-granular, 2h max-lookback)라 KST 07-23 00:00 이후 date=07-22 를 다시 조회하지 않고, foot 에는 daily_full 재스윕 백스톱이 없으며, flip 구간을 커버할 {511∪457} cross-bizno union 도 없기 때문.** 07-23 20:00 폴러가 457 로 전환했을 때는 이미 커서가 최근 date 만 보므로 실제 행이 있는 457 버킷으로 07-22 를 재조회할 경로가 원천 부재.

- 왜 511 이 07-22 를 0행 반환했나(정확한 저층 사유 = RedPay 측): (a) 해당 단말이 flip 시 457 로 재귀속되며 07-22 이력이 457 로 이동, 또는 (b) 즉시 승인-취소 net0 테스트건이 KST 07-23 정산배치에서야 노출(폴러 date window 종료 후). **어느 쪽이든 폴러가 통제 가능한 처방(백스톱/union)의 부재가 영구화 원인** — RedPay 측 저층 사유 disambiguation 은 처방과 무관(둘 다 동일 백스톱으로 회수됨).

---

## AC-2 (범위: single vs systemic) — **single-shot 확정 + 구조적 systemic 잠재**

`_ac2_sweep.mjs` (feed 457 ↔ raw, foot 27-set, count-first delta1, 07-11~08-02):
```
day        Δcnt(feed−raw)  verdict
07-11..07-21   0            ok (07-20: feed26=raw26 net5,931,200 정합)
07-22          +2           ⚠UNDER-INGEST   feed TID=[1047479158]  ← 유일
07-23          -2           raw>feed(ok)   net 일치 10,779,980 (raw가 feed≥, 무손실)
07-24..07-28   ≤0           raw>feed(ok)   net 전일 일치 (511-live 수집분 ≥ 현행 457 retro-query)
07-29..08-02   0            ok
```
**UNDER-INGESTION 요약: 2026-07-22 Δ2건, TID 1047479158 — 그 외 전무.**

- **영향 목록(전량):** 날짜=2026-07-22 1일 / merchant=1777289012 1개 / TID=1047479158 1개 / 건수=2(Y +5000, N −5000) / net=**0원**.
- **systemic 아님:** 타 날짜·타 merchant silent under-ingestion **0건.** 독립교차검증(부모 AUDIT): 워치독 최근7일 합계 RedPay 247=DB 247, net ₩91,512,740 정확일치.
- `raw>feed(ok)` 날들(07-23~28): raw 가 현행 457 retro-query 보다 많음(무손실). 사유=511-시대 live 수집분/웹훅분이 457 재귀속에 100% 미이전 — **net 전일 일치**로 금전영향 0. under-ingestion 아님(raw≥feed).
- **현장 우려 직답:** "다른 지점 실 취소가 조용히 누락되나?" → **관측기간 내 그런 사례 0.** 단 아래 구조결함이 남아 **차기 bizno flip / KST자정 걸친 정산지연·다운타임**에서 동형 영구누락을 재생산할 수 있음(재발조건 명시).

---

## AC-3 (silent-miss 관측성 노출/침묵점) — 자매 B 입력

| 관측 경로 | 07-22 seam 포착? | 침묵 사유 |
|---|---|---|
| 워치독 ③ 휴면감지 / `get_redpay_feed_freshness` raw_count | ❌ | raw-only 스캔 → (a)net0상쇄 (b)진성무거래 (c)미적재 3상태 미구분(total-blindness). 부모 AUDIT AC-3 계승 |
| 폴러 자체 `fetched=0` 로그 | ❌ | 200-empty(정상형 0건)를 이벤트로 안 봄. "feed 0행"과 "진성 거래0" 미구분(BIZNO-FAILCLOSED 불변식의 확장축) |
| **A12 delta1(feed↔raw count-first)** | ✅ HIGH 포착 | 유일하게 feed 를 대조축으로 끼움. 07-22 `delta1 cnt=2 verdict=HIGH` 실측(부모 AUDIT) |

**침묵점 = 단일-bizno 조회 + raw-only 관측.** 관측성 처방(자매 B, DDL 수반 가능):
1. **A12 HIGH 의 지속/에스컬레이션 persist(Mode B 로그테이블)** — 현재 A12 HIGH 는 settled-window(기본7d) 내에서만 발화 → 미조치 시 창밖 aging 후 재침묵(retention 갭). 07-22 는 이미 창 근접 → persist 없으면 곧 재침묵.
2. **flip 구간 cross-bizno union 관측** — freshness/delta 를 {구·신 bizno} 양쪽으로 대조(flip seam 조기탐지).
3. **폴러 `feed=0 while 인접일 feed>0` 이상신호** — date별 feed 0행이 인접 영업일과 불연속이면 alert(현 침묵).

---

## 처방 방향 (설계만 — 본건 미착수, 게이트 경유)

> ⛔ 아래는 **설계/라우팅**이다. 본건 = READ-ONLY 진단 종결. 구현은 게이트 경유:

- **P-fix1 (영구화 enabler 제거, 권장):** foot 적재에 **저빈도 daily_full 재스윕 백스톱**(일 1회, 어제~N일 전 date 를 현행 bizno 로 재조회, 멱등키로 무중복 재적재). 5분 증분과 분리해 부하 격리. → transient feed 공백/flip seam/정산지연을 **차기부터 자동 회수**. 코드 옵션은 이미 존재(`POLL_MODE=daily_full`, `REDPAY_DAILY_FROM/TO`) → launchd 인스턴스 추가 수준. **db_change 여부·cron 신설 → supervisor gate.**
- **P-fix2 (flip 구간 한정 union):** bizno flip 진행 중에는 {구·신} 양 bizno 를 union fetch(1회성 flip 런북). 상시 union 은 타도메인 혼입면 확대 위험 → flip window 한정.
- **자매 B(NOTXN-SCAN-3STATE-MODEB-PERSIST):** A12 HIGH persist/에스컬레이션 = **DDL(로그테이블) 수반 → DA CONSULT 1차게이트.**
- **자매 C(0722-MISS-BACKFILL-SOP-ENVELOPE):** 07-22 2건(net 0원) 소급 재적재 = **Data-Correction Backfill SOP 봉투**(대상셋 freeze=trxid 2건, 멱등키, dry-run, rows-affected assert, 원장무접점, supervisor dry-run). **본건 자동백필 금지 준수** — 실행 안 함. net 0원이라 매출영향 0 → 우선순위 낮음(grain 완전성 목적).

---

## 게이트 준수
- READ-ONLY 완료. write 0 / DDL 0 / CRM 화면 무변경(ef_only). 결제·수납·매칭·취소 경로 무접촉. 코드 로직 변경 0(본 커밋 = 진단 evidence + READ-ONLY probe 아티팩트만).
- 자동 백필 미실행(자매 C 봉투로 이관). DDL 필요분(자매 B) = DA CONSULT 게이트 이관.
- under-report 금지: 실 미적재 공백 = 07-22 2건(net 0원) 전량 명시, 그 외 systemic under-ingestion 0.
