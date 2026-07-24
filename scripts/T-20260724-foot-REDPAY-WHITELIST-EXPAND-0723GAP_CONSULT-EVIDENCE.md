# T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP — DA CONSULT 1차 게이트 근거

**작성**: 2026-07-24 dev-foot (macstudio, 한국 IP) · **op**: READ-ONLY (RedPay 직접조회 + Supabase SELECT. write/DDL/upsert = 0)
**replay**:
- `node scripts/T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP_probe.mjs` (RedPay 정본 merchant×tid, tid= narrowing 미전송)
- 보조: 7일 활동 probe(/tmp/redpay_7day.mjs) · old-TID raw probe(/tmp/oldtid_raw.mjs) · registry 현행 probe(/tmp/reg_probe.mjs)

parent: T-20260724-foot-REDPAY-DAILYFULL-0723-BACKFILL (outcome B, cause(b) whitelist gap 수렴). 본 티켓 = cause(b) 확장.

---

## 0. 핵심 정정 — 티켓 framing보다 gap이 큼(schema 함의 有)

티켓 예측 = "MERCHANT +1(285002) + TID +5". **RedPay 정본 probe 로 실제 gap 정정:**

| 대상 | 실제 | 티켓 예측 대비 |
|------|------|----------------|
| 신규 merchant | 1777285002 (풋2 VAN), tid=**1047535843** | 예측대로 ✓ (단, 티켓은 285002 의 TID 미명시 → 843 확정) |
| 5 gap TID | 1047535845/842/837/835/797 = **이미 등록된 merchant(285001/003/005/006/007)의 신규 단말ID** | 예측(797/837/842) + 진단으로 835/845 추가 ✓ |

★ **결정적 발견**: 5 gap TID 는 신규 merchant 가 아니라 **기등록 5개 merchant 의 VAN 단말 재등록(신 TID)**. 레지스트리 현행은 이들에 **구 TID(1047479xxx)** 를 보유 → 구·신 TID divergence.

---

## 1. RedPay 정본 merchant×tid (7/23 KST, business_no=457-23-00938, tid= 미전송)

foot band(1777285*/288*/289*) 7/23 거래:

| merchant_id | name | Y | registry 등록 | 7/23 실거래 TID | registry 보유 TID |
|-------------|------|---|--------------|----------------|-------------------|
| 1777285001 | 풋1(VAN) | 3 | ✅ | **1047535845** | 1047479255 (구) |
| **1777285002** | **풋2(VAN)** | **5** | ❌ **미등록** | **1047535843** | (없음) ★seed-omission |
| 1777285003 | 풋3(VAN) | 6 | ✅ | **1047535842** | 1047479254 (구) |
| 1777285005 | 풋5(VAN) | 6 | ✅ | **1047535837** | 1047479268 (구) |
| 1777285006 | 풋6(VAN) | 2 | ✅ | **1047535835** | 1047479262 (구) |
| 1777285007 | 풋7(VAN) | 1 | ✅ | **1047535797** | 1047479263 (구) |
| 1777289013 | 풋(무선) | 1(+1취소) | ✅ | 1047479153 | 1047479157/153 (기존) |

## 2. 구 TID = dead 확증 (7일 activity probe, 7/17~7/23)

| 구 TID | 7일 거래 | 신 TID | 7일 거래 |
|--------|----------|--------|----------|
| 1047479255 (285001) | **0 (dead)** | 1047535845 | 3 (7/23~) |
| 1047479254 (285003) | **0 (dead)** | 1047535842 | 6 (7/23~) |
| 1047479268 (285005) | **0 (dead)** | 1047535837 | 6 (7/23~) |
| 1047479262 (285006) | **0 (dead)** | 1047535835 | 2 (7/23~) |
| 1047479263 (285007) | **0 (dead)** | 1047535797 | 1 (7/23~) |

→ **VAN 단말 재등록** — 구 단말 폐기, 신 TID 로 교체(7/23 발생).

## 3. ⚠ 구 TID 에 21 historical raw 행 존재 → UPDATE-in-place 위험

`redpay_raw_transactions` 중 구 TID 로 적재된 행 (7/11~7/14):

| 구 TID (merchant) | 행수 | 기간 |
|-------------------|------|------|
| 1047479255 (285001) | 6 | 7/11~7/14 |
| 1047479254 (285003) | 4 | 7/13~7/14 |
| 1047479268 (285005) | 5 | 7/13~7/14 |
| 1047479262 (285006) | 4 | 7/13~7/14 |
| 1047479263 (285007) | 2 | 7/13 |
| **합계** | **21** | |

**함의**: 소비 뷰 3종(v_redpay_reconciliation_daily / v_receipt_settlement_daily / get_redpay_feed_freshness)이
`merchant IN (registry) **AND** tid IN (registry)` (belt-and-suspenders = **AND**) 필터.
→ 레지스트리에서 구 TID 를 신 TID 로 **UPDATE-in-place** 하면 위 **21 historical 행이 뷰에서 탈락**(7/11~14 대사 붕괴).
→ 구·신 TID 를 **둘 다 active 유지**해야 historical + 신규 모두 뷰 가시.

## 4. schema 제약 충돌 — DA 판정 요청(Q2)

레지스트리 = `CONSTRAINT redpay_terminal_registry_merchant_uk UNIQUE (merchant_id)` (merchant 1:1 tid).
→ 한 merchant 에 구·신 2 TID 동시 active 불가(현 제약). 구·신 병존 = **제약 변경 필요**.

**Option 비교:**

- **Opt-A (UPDATE-in-place, no-DDL)**: registry 구 TID → 신 TID UPDATE. ❌ §3 의 21 historical 행 뷰 탈락. **REJECT 권고.**
- **Opt-B (제약완화 + ADDITIVE INSERT, DDL 1줄)** ★권고:
  `UNIQUE(merchant_id)` → `UNIQUE(merchant_id, tid)` 완화 후, 신 TID 6행 INSERT(285002/843 + 5 신TID). 구 5행 active=true 유지(historical 가시). **데이터 손실 0, 순증(widening) 제약.**
- **Opt-C (별 tid 테이블 정규화)**: 과설계. 별도 리팩터 티켓 권고, 본 건 범위 밖.

## 5. DA CONSULT 질의 (a)(b)(c)

- **(a) merchant 1777285002 foot 귀속 확정?** — probe: name="오블리브-서울오리진점 풋2(VAN)", band 1777285*(foot VAN 대역), 285001↔285003 사이 seed-omission. 5 Y 전량 7/23. → foot ADDITIVE 신규 row(무충돌).
- **(b) 5 신 TID(845/842/837/835/797) + 285002 TID(843) → merchant 매핑·foot 귀속 확정?** (권위 키=merchant_id, §1 매핑). 병존 모델 = **Opt-B(제약완화+INSERT)** 승인 요청. UPDATE-in-place(Opt-A) 는 21행 탈락으로 REJECT.
- **(c) cross-tenant 역오염 없음?** — 동일 business_no 피드에 도수(1777276003·1777269*), 피부(1777277*/279*/281*) 공존하나 **전량 non-foot band → merchant allowlist 구조적 자동배제**. foot band(1777285*/288*/289*) 내부엔 foot merchant 만. → 역오염 0(probe §unknown/§c 확인).

## 6. ⚠ WATCHDOG 커버리지 갭 (planner 지적 — spinoff 판단 근거)

`v_redpay_unclassified_merchants` = **0행**(285002 미포착). RC:
- 이 뷰는 `redpay_raw_transactions`(=적재 후) 기준. 285002·신 TID 거래는 **서버측 `tid=` narrowing(구 TID만 전송)에서 fetch 자체가 차단** → raw 미적재 → 뷰가 볼 대상이 없음.
- **구조적 blind spot**: watchdog=post-ingestion, gap=pre-ingestion(tid= 서버필터). merchant allowlist 밖 신규는 잡아도, **tid= narrowing 에 걸린 신규 TID/merchant 는 영구 미표면화.**
- **spinoff 권고**: (i) 폴러가 daily_full 1회는 tid= 미전송(merchant-only)으로 넓게 훑어 미분류 표면화, or (ii) RedPay 정본 vs registry 주기 대사 watchdog(적재 이전 층). 본 티켓 범위 밖 → planner 판단.

---
*게이트: 본 evidence 로 DA CONSULT 발행. GO(ADDITIVE 또는 Opt-B ruling) 수신 전 build(seed/DDL/코드) 착수 금지.*
