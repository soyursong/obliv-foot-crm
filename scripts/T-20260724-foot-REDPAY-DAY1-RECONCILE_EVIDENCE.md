# T-20260724-foot-REDPAY-DAY1-RECONCILE — Evidence (READ-ONLY 포렌식)

**Run**: 2026-07-24 (macstudio, node) · dev-foot
**Ticket**: 관측모드 Day-1(7/23) 웹훅구간 divergence 정밀대사 (최필경 총괄, thread 1784708681.507149)
**Scope**: RAW DB 층(뷰 이전) 1:1 대조. **write/DDL/upsert = 0** (SELECT only).
**auth-context**: Supabase Management API = service_role 권한(RLS 우회) → 실 raw 행 관측. silent 0-row read 아님(Cross-CRM 진단 인증컨텍스트 표준 준수).
**replay**: `node scripts/T-20260724-foot-REDPAY-DAY1-RECONCILE_forensic.mjs`

> 층 분리: 본 티켓 = RAW DB. 이슈2 탭 표면화(cause a)=VIEW-PAYLOAD-SHAPE-FIX(뷰 층, 별개). 이슈1 15건 백필=DAILYFULL-BACKFILL(별개, 여기서 재pull 미실행).

---

## [AC1] 18:05 KST+ 웹훅구간 스냅샷 (redpay_raw_transactions, 7/23 KST 전량 = 10행)

7/23 KST 전체가 18:05:43 이후에만 존재(첫 유입 18:05:43) → 18:05+ 구간 = 7/23 전량 10행.
merchant_id 는 **webhook shape(`raw_payload.data.merchant_id`) + poller shape(`raw_payload.merchant.id`) COALESCE** 로 추출(1차 추출은 poller shape 누락으로 ∅ 오표기됨 → 정정본).

| # | status | approval_no | trxid | amount | merchant_id | merchant_name | 시각(KST) | 유입경로 |
|---|--------|-------------|-------|--------|-------------|---------------|-----------|----------|
| 1 | Y | 62071914 | 0723C8124555 | 1,004 | **1777276003** | **도수(무선)** | 18:05:43 | poller 🔴 |
| 2 | N | 62071914 | 0723C8124601 | -1,004 | **1777276003** | **도수(무선)** | 18:05:59 | poller 🔴 |
| 3 | Y | 56894018 | K1047535837…56894018 | 8,700,000 | 1777285005 | 풋5(VAN) | 18:06:47 | webhook/observe |
| 4 | Y | 62146905 | 0723C8125591 | 1,004 | 1777289013 | 풋(무선) | 18:16:29 | poller |
| 5 | N | 62146905 | 0723C8125598 | -1,004 | 1777289013 | 풋(무선) | 18:16:46 | poller |
| 6 | N | 62146905 | 0723C8125598 | 1,004 | 1777289013 | 풋(무선) | 18:16:46 | webhook/observe |
| 7 | Y | 63304014 | K1047535842…63304014 | 250,000 | 1777285003 | 풋3(VAN) | 18:48:07 | webhook/observe |
| 8 | Y | 22005414 | K1047535837…22005414 | 260,000 | 1777285005 | 풋5(VAN) | 18:55:28 | webhook/observe |
| 9 | Y | 29417129 | K1047535842…29417129 | 10,000 | 1777285003 | 풋3(VAN) | 19:24:05 | webhook/observe |
| 10 | Y | 116267542 | K1047535797…116267542 | 20,000 | 1777285007 | 풋7(VAN) | 20:24:51 | webhook/observe |

- 승인(Y)=7 / 취소(N)=3.  business_no=4572300938 6행(webhook분) + ∅ 4행(poller분, business_no 미저장).
- **dual-path 아티팩트**: 62146905 취소가 2행(#5 poller -1004 / #6 webhook +1004, 동일 trxid 0723C8125598) — 유니크키 (trxid,status,amount) 에서 금액부호(±1004)만 달라 별행 수렴. **distinct 취소 = 2건**(62071914, 62146905).

## [AC2] 최필경 9건 ↔ DB 승인(Y) 1:1 대조 매트릭스

field 9 승인: `56894018 62146905 63304014 22005414 29417129 23005414 30031451 30024628 116267542` (+취소1)

| field9 approval_no | DB 승인(Y)? | 판정 |
|--------------------|-------------|------|
| 56894018 | ✅ | 일치 |
| 62146905 | ✅ | 일치 |
| 63304014 | ✅ | 일치 |
| 22005414 | ✅ | 일치 |
| 29417129 | ✅ | 일치 |
| 116267542 | ✅ | 일치 |
| **23005414** | ❌ | **누락(DB 전무)** |
| **30031451** | ❌ | **누락(DB 전무)** |
| **30024628** | ❌ | **누락(DB 전무)** |

- **누락(승인) = 3건: `23005414 / 30031451 / 30024628`** — DB 어디에도 없음(status 불문). 원인 = whitelist/TID gap(parent RECONCILE cause b) 추정, RAW 미적재라 본 층 회복 불가(백필 형제티켓 소관).
- **초과(승인) = 1건: `62071914`** — field foot 9건에 없음. **= 도수(1777276003) leak**(아래 AC3).
- **초과 취소 = 1건: `62071914`** (field 취소=1[풋무선 62146905] ↔ DB distinct 취소=2[62146905 풋 + **62071914 도수**]). → **가설(도수 leak) 확증**.

> ⚠ 티켓 예측 "누락 2 + 초과취소 1" 대비 정정: net 승인차 9−7=2 는 **도수-leak 승인 1건(62071914)이 DB count 를 부풀린 결과**. 정직한 RAW 1:1 = 실 foot 승인 **누락 3** + 도수 leak(승인/취소 각1). 추정 아닌 쿼리 근거.

## [AC3] merchant_id 목록 + EF drop 코드경로 검증 → 도수 혼입 판정

**18:05+ 적재 merchant_id (distinct):**

| merchant_id | 건수(Y/취소) | 센터 | 유입경로 |
|-------------|--------------|------|----------|
| **1777276003** | 2 (1/1) | **BODY 도수(무선)** 🔴 | **poller** |
| 1777285003 | 2 (2/0) | foot 풋3 | webhook |
| 1777285005 | 2 (2/0) | foot 풋5 | webhook |
| 1777285007 | 1 (1/0) | foot 풋7 | webhook |
| 1777289013 | 3 (1/2) | foot 풋(무선) | poller+webhook |

**EF drop 코드경로 (redpay-webhook/index.ts §5 + _shared/redpay-foot-merchants.ts):**
```
// index.ts §5
const center = centerForMerchant(data.merchant_id);
if (center === "unknown") { …Slack alert…; return json(200,{status:"unknown_merchant_alerted"}); } // 미적재
if (center === "body")    { …log…;         return json(200,{status:"dropped_other_center"}); }     // 미적재
// → center==='foot' 만 §7 upsert 도달
// redpay-foot-merchants.ts: FOOT_MERCHANT_SET(26).has→foot / BODY_MERCHANT_SET(14).has→body / else unknown
```

**판정 — 웹훅 EF 경로 도수 혼입 = `NO` ✅** (코드 + 실통과 데이터 이중 확증):
- src=webhook 6행 전량 foot merchant(풋3/5/7/무선). BODY 0건.
- 도수 62071914 는 **webhook 경로 미적재** = EF `center==='body' → dropped_other_center` 가 정상 drop(그래서 webhook 행 없음). **화이트리스트 drop 로직 정상작동.**

**단, RAW 테이블 전체 관점 도수 혼입 = `YES` 🔴 — 벡터는 POLLER(redpay-reconcile), EF 아님:**
- 62071914(도수 1777276003) 2행 = poller-shape payload(`raw_payload.merchant.id`, `_source` 마커 없음).
- poller filterToFootScope 1차 판정 = foot merchant_id 26-allowlist → 도수 1777276003 은 allowlist 밖 → **정상이면 scoped_out**. 실재함 = **필터 해제/우회 상태의 test poll 실행**에서 유입(field 최필경 "필터 해제 시 18:05:43 도수 무선 1,004 테스트" 진술과 정확 일치. DB raw payload merchant.name="도수(무선)"·id=1777276003 로 자체 확증 — field 진술과 교차검증 이중 확정).

## 결론 · 후속 (진단·필요여부 1줄, 정정 실행은 본 티켓 밖)

- **도수 leak 정정 필요 = O** — 62071914 2행(Y+1004/N−1004, 도수 1777276003)은 observe 마커 없는 poller 행이라 foot 매칭/관측신호 오염 가능 → `data_correction_backfill_sop` spinoff(archive-first 2행 제거) 권고. **본 티켓은 진단까지.**
- 누락 3건(23005414/30031451/30024628) 회복 = whitelist gap(cause b) 선결, 백필 형제티켓 소관.
- 웹훅 EF drop 로직 = 수정 불요(정상). 유입 격리 결함은 poller 측.
