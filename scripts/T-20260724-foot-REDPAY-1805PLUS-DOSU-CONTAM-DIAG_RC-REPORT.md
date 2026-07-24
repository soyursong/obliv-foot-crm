# T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG — RC 리포트 (READ-ONLY 진단)

- **티켓**: T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG (P2, DIAG, READ-ONLY, mutation 0)
- **parent**: T-20260724-foot-REDPAY-457-COUNT-RECONCILE (done, Branch B)
- **reporter**: 최필경 총괄 (finding ②③)
- **probe**: `scripts/T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG_probe.mjs` (+`_probe2.mjs`)
- **인증컨텍스트**: service_role (RLS bypass, 전건 관측 — 진단 인증컨텍스트 표준 준수)
- **PHI 위생**: count/금액/시각/TID/merchant_id/approval_no/단말라벨/소스경로만. name/phone/RRN·member_name 제외.
- **db_change**: false. 본 티켓은 진단만. fix는 spinoff.

---

## 0. 핵심 발견 (1줄)

**총괄이 본 "장첸 DB 승인7/취소2" = 필터 해제(unfiltered) `redpay_raw_transactions` raw count 다.**
정상 필터 뷰(`v_redpay_reconciliation_daily`)는 18:05+ 를 **승인1/취소1** 로만 표면화한다. 즉 divergence 는
"두 개의 서로 다른 DB 숫자"를 하나로 뭉뚱그린 데서 온다 — (A) 필터 해제 raw = 7/2, (B) 필터 뷰 = 1/1.

## 1. 18:05+ raw 전건 (9행, 필터無, service_role)

| # | 시각(KST) | payload shape | domain(merchant) | tid | status | 금액 | approval_no | 뷰포함 |
|---|-----------|---------------|------------------|-----|--------|------|-------------|--------|
| 1 | 18:05:43 | poller(nested) | **BODY 도수(무선)** 1777276003 | 1047479115 | 승인 Y | 1,004 | **62071914** | ❌드롭 |
| 2 | 18:05:59 | poller(nested) | **BODY 도수(무선)** 1777276003 | 1047479115 | 취소 N | -1,004 | **62071914** | ❌드롭 |
| 3 | 18:06:47 | **webhook envelope** | NULL(추출불가) | NULL | 승인 Y | 8,700,000 | 56894018 | ❌드롭 |
| 4 | 18:16:29 | poller(nested) | FOOT 풋(무선) 1777289013 | 1047479153 | 승인 Y | 1,004 | 62146905 | ✅뷰 |
| 5 | 18:16:46 | poller(nested) | FOOT 풋(무선) 1777289013 | 1047479153 | 취소 N | -1,004 | 62146905 | ✅뷰 |
| 6 | 18:48:07 | **webhook envelope** | NULL(추출불가) | NULL | 승인 Y | 250,000 | 63304014 | ❌드롭 |
| 7 | 18:55:28 | **webhook envelope** | NULL(추출불가) | NULL | 승인 Y | 260,000 | 22005414 | ❌드롭 |
| 8 | 19:24:05 | **webhook envelope** | NULL(추출불가) | NULL | 승인 Y | 10,000 | 29417129 | ❌드롭 |
| 9 | 20:24:51 | **webhook envelope** | NULL(추출불가) | NULL | 승인 Y | 20,000 | 116267542 | ❌드롭 |

- **집계(필터無)**: 승인 7 / 취소 2 ← **총괄이 본 장첸 숫자와 정확히 일치**.
- **뷰 표면(필터有)**: 승인 1 / 취소 1 (row4 missing_in_crm, row5 refund_not_in_crm).
- **payload shape 2종**:
  - `poller(nested)`: `{tid,trxid,...,merchant:{id},...}` → `raw_payload->merchant->>id` 추출 OK. (rows 1,2,4,5)
  - `webhook envelope`: `{data,_mode,_source,event_id,event_type,occurred_at}` → merchant/tid 가 `data` 하위 →
    **`raw_payload->merchant->>id` = NULL, 컬럼 `tid` = NULL** → 뷰 WHERE `(merchant∈foot26) AND (tid∈foot26)` 구조적 드롭. (rows 3,6,7,8,9)

---

## 2. [AC1] 취소 over-count (+1) — 도수 오염 **확정: 예**

- **오염 TID/건**: approval_no **62071914**, merchant_id **1777276003**(BODY 14-band, 단말라벨 "오블리브-서울오리진점 도수(무선)"),
  tid **1047479115**, ±1,004 승인+취소 페어, 18:05:43 / 18:05:59.
- **풋 457 count 포함 여부**:
  - 필터 뷰(`v_redpay_reconciliation_daily`) = **미포함**(❌드롭). 뷰 merchant∧tid 필터가 정상 배제.
  - 필터 해제 raw count(총괄이 본 7/2) = **포함**. → 이 경로에서 취소 +1 발생.
- **오염경로 층 지목 = (c)** "도수 단말 457 biz 리포트 → 스코프분리 부재".
  - **(a) whitelist 도수TID 오등록 = 아님**: tid 1047479115 / mid 1777276003 은 풋 26-set 에 **없음**(오등록 無).
  - **(b) 매처/뷰가 457 biz만으로 포함 = 아님**: 뷰는 merchant∧tid 도메인 경계로 정상 배제(❌드롭 확인).
  - **(c) 확정**: 도수 단말이 공유 사업자번호(457) 대역으로 리포트 → **poller(redpay-reconcile) 가 merchant drop 없이 풋 raw 에 적재**(REDPAY-DOSU-CONTAM-FIX 포렌식 leak_vector=poller 와 일치) → **도메인 스코프분리 없는 필터해제 count 가 집계**.
- **취소 축 완전 정합**: 필터 뷰 취소1 = 현장 취소1(row5 foot appr 62146905) **일치**. over-count +1 은 오직 필터해제 raw 에서만, 전량 도수(row2)로 설명 → **취소 축 잔여델타 0**.
- **라우팅**: 기존 **T-20260724-foot-REDPAY-DOSU-CONTAM-FIX** (poller merchant-drop parity + archive-first 2행 정정, freeze-set=62071914). 본 진단이 18:05+ 국소에서 동일 freeze-set 재확증.

---

## 3. [AC2] 승인 under-count (-2) — 라우팅

두 개 divergence 를 분리해야 한다:

### (I) 필터 뷰(탭)의 승인 under — cause(a) VIEW-PAYLOAD-SHAPE **확정**
- 뷰가 표면화한 승인 = **1건**(row4 poller-shape foot test 1,004)뿐.
- 실 풋 승인 webhook 5건(8.7M / 250K / 260K / 10K / 20K, rows 3·6·7·8·9)이 **payload envelope-shape 로 인해 전량 드롭**
  (`raw_payload->merchant->>id`=NULL ∧ `tid`=NULL). → **cause(a) VIEW-PAYLOAD-SHAPE-FIX** (기 발행 DA CONSULT).
- **cause(b) 신규TID whitelist밖 = 해당 없음**: 18:05+ 에 expand TID(1047535xxx)·타 풋 TID 유입 0건.

### (II) 필터해제 raw vs 현장 승인 -2 (총괄이 본 net)
- 필터해제 raw 승인 = 7 (webhook 5 + 도수 1 + foot poller-test 1). 현장 = 9. net **-2**.
- 분해: 도수 오염 **+1**(row1, 62071914, §2에서 제거 대상) + 실풋 raw 승인 6(webhook5 + foot-test1) vs 현장 9 = **-3**.
  → +1(도수) − 3(실풋 미반영) = **net -2** (산술 정합).
- 즉 필터해제 net -2 는 **도수 +1 이 실풋 -3 을 가린 합성치**.

---

## 4. [AC3] rc-report — 18:05+ divergence 완전분해

| 축 | 현장 | 필터해제 raw(총괄) | 필터 뷰(탭) | 분해 | 잔여 |
|----|------|-------------------|-------------|------|------|
| 취소 | 1 | 2 | 1 | 실풋1(62146905) + **도수오염+1**(62071914) | **0** — 전량 설명 |
| 승인 | 9 | 7 | 1 | (탭) webhook 5 payload-shape 드롭 + foot-test1 = 표면1 ↔ (raw) webhook5+도수1+foot-test1=7 | **≠0 아래** |

- **완전 설명된 부분**:
  - 취소 over +1 = 도수 오염(62071914). → DOSU-CONTAM-FIX. 잔여 0.
  - 탭 승인 표면 1 vs 실풋 6 = webhook 5건 payload-shape 드롭. → VIEW-PAYLOAD-SHAPE-FIX. (뷰 국한, 완전 설명)
- **잔여 미설명 델타(명시)**: 필터해제 raw 실풋 승인 **6** vs 현장 **9** = **-3 (도수 보정 전 net -2)**.
  - webhook 5 + foot-poller-test 1 만 raw 실재. 현장이 센 9 중 **3건이 raw(webhook·poller 양측) 어디에도 미적재**로 보임.
  - CRM payments 18:05+ 카드 = **4건**(250K@18:54 / 260K@19:07 / 10K@19:27 / **8,800@20:22**) — raw webhook 5건과 금액·건수 1:1 불일치
    (raw 8.7M·20,000 은 CRM 무매칭 / CRM 8,800 은 raw 무매칭). 매칭 noise 존재.
  - **RC 확정 불가(READ-ONLY 데이터 한계)**: 현장 "승인9" 의 approval_no/금액/시각 원장 리스트가 있어야 -3 을 (미적재 webhook-capture gap) vs (현장 test/경계 계수차)로 최종 귀속 가능.
  - **경계 확인 완료**: 17:00~18:05 raw = **0건** → 현장 18:05 기준선과 window 경계 오차 아님.
  - **범위 경계**: 본 -3 은 18:05+(웹훅 커버 구간) 이므로 pre-18:05 DAILYFULL-0723-BACKFILL 축과 무관. 후보=webhook-recv capture gap(별도 spinoff 판단 planner).

---

## 5. 분기 판정

- **분기 A (도수 오염 확정) → YES.** spinoff fix = **기존 T-20260724-foot-REDPAY-DOSU-CONTAM-FIX** 로 완전 커버
  (poller merchant-drop parity = 재유입 0 + archive-first 2행 정정, freeze-set 62071914). 뷰/whitelist 수정 아님(뷰 정상) →
  본 오염 정정은 RAW 정정 경로이므로 DOSU-CONTAM-FIX 의 기존 DA CONSULT + MIG-GATE 게이트 승계.
- **탭 승인 표면 부족** → **VIEW-PAYLOAD-SHAPE-FIX** (webhook envelope-shape 를 뷰가 merchant/tid 추출하도록 — 기 발행 DA CONSULT).
- **잔여 -3(실풋 미적재 후보)** → 현장 approval 원장 대조 필요. webhook capture gap spinoff 판단(planner).

## 6. 산출물 (READ-ONLY, mutation 0 확인)

- probe 스크립트 2종 + 본 RC 리포트. DB write/DDL **0**. `redpay_raw_transactions`·뷰·payments **조회만**.
