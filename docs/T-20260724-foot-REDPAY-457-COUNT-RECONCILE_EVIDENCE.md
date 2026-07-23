# T-20260724-foot-REDPAY-457-COUNT-RECONCILE — 관측 대사 증거 스냅샷

**READ-ONLY 관측 대사** · mutation 0 · 인증컨텍스트 = service_role(RLS bypass, 전건 관측)
대상: 457/풋 · close_date = 2026-07-23 (KST) · clinic_id = `74967aea-a60b-4da3-a0e7-9c997a930bc8`
재현: `node scripts/T-20260724-foot-REDPAY-457-COUNT-RECONCILE_probe.mjs`
PHI 위생: count/금액/시각/merchant·tid/소스경로만. 개별 환자 식별정보(name/phone/RRN) 제외.

---

## 판정: **분기 B — 진성 divergence (시점 차이 아님)**

현장 재집계(승인 24 + 취소 1 = 25건, net 10,779,980)와 시스템은 **일치하지 않음**.
탭에 보이는 "24건"이 현장 25건과 숫자만 근사할 뿐, **서로 다른 행을 세고 있는 착시**다.

---

## 3원 대조표 (마감 후 시점)

| 축 | 소스 | 건수 | 금액(net) | 비고 |
|----|------|------|-----------|------|
| 현장 재집계 | 총괄님 수기(카드전표/VAN 정산 추정) | 승인24 + 취소1 = **25** | **10,779,980** | 승인합 10,780,984 − 취소 1,004 |
| 레드페이 탭(뷰) | `v_redpay_reconciliation_daily` | 행 **24** (redpay-anchor 2 / crm-anchor 22) | van합 0 / crm합 2,093,900 | FE 요약 "수집 24 / 매칭 0 / 미매칭 24" |
| VAN raw 실적재 | `redpay_raw_transactions` (필터無) | **9** (승인7 / 취소2) | **9,240,000** | 실거래 5건 + foot테스트2 + body테스트2 |
| CRM 카드수납 | `payments` (card, payment) | **22** | 2,093,900 | 전건 미대사(VAN 매칭 0) |

> 4개 소스가 4개 숫자. 카운트가 우연히 24~25로 근사할 뿐 grain·모집단이 전부 다르다.

---

## 진원 3층 (추정 아님 — 쿼리 결과 확정)

### b1. VAN 웹훅/폴러 부분수신 — raw 미적재
7/23 KST `redpay_raw_transactions`(foot clinic) = **9건뿐**. 현장 승인 24건 대비 대부분 미도달.
`redpay_poller_state`: `last_incremental_to=2026-07-23T23:26Z`, `last_fetched_count=0`, `last_upserted_count=0`
→ **폴러는 0건 pull**. 적재된 9건은 webhook(플랜B observe) 경유. 실거래 상당수가 raw 에 안 들어옴.

### b2. payload merchant_id/tid = NULL → 뷰 필터 구조적 드롭
적재된 9건 중 **실거래 5건(8,700,000 / 260,000 / 250,000 / 20,000 / 10,000)이 `merchant_id=NULL`, `tid=NULL`**.
레드페이 탭 뷰는 `WHERE merchant_id IN (foot 26) AND tid IN (foot TID 26)` 를 요구 →
merchant/tid 가 NULL 인 실거래는 **whitelist 를 통과 못 해 탭에서 사라짐**. (8.7M 건 포함 전부 미표면)

| 시각 | merchant_id | tid | status | 금액 | 뷰 노출 |
|------|-------------|-----|--------|------|---------|
| 18:05 | 1777276003 (**body**) | 1047479115 | Y | 1,004 | ✗(foot필터 배제·정상) |
| 18:05 | 1777276003 (**body**) | 1047479115 | N | -1,004 | ✗ |
| 18:06 | **NULL** | **NULL** | Y | **8,700,000** | ✗(드롭) |
| 18:16 | 1777289013 (foot) | 1047479153 | Y | 1,004 | ○ missing_in_crm |
| 18:16 | 1777289013 (foot) | 1047479153 | N | -1,004 | ○ refund_not_in_crm |
| 18:48 | **NULL** | **NULL** | Y | **250,000** | ✗(드롭) |
| 18:55 | **NULL** | **NULL** | Y | **260,000** | ✗(드롭) |
| 19:24 | **NULL** | **NULL** | Y | **10,000** | ✗(드롭) |
| 20:24 | **NULL** | **NULL** | Y | **20,000** | ✗(드롭) |

### b3. 탭 "24건" 착시 — CRM측 미매칭 행이 다수
탭의 24행 = CRM 카드수납 `missing_at_van` **22** + foot 테스트 raw **2**(1 missing_in_crm + 1 refund).
즉 탭 숫자는 **실 VAN 수신이 아니라 CRM 입력측 미매칭 카드**가 채운 것. 현장 25와 근사한 건 우연.

### (부수) cross-center 테스트 유입
body merchant `1777276003` 테스트 2건이 foot clinic_id raw 에 적재됨. foot 뷰 필터로는 정상 배제되나,
webhook 수신단에서 clinic 귀속이 섞이는 정황 → 별건 관측 필요.

---

## 결론 & 후속(별건, 본 티켓 스코프 밖)
- **18→24 는 시점 차이가 아님.** 관측 정합성은 **비정상**(현장 25 ≠ 시스템 어느 소스와도 불일치).
- 핵심 진원 = **VAN raw 부분수신(b1) + 실거래 payload의 merchant/tid NULL 로 인한 뷰 드롭(b2)**.
- 금액 갭: 현장 10,779,980 vs VAN raw 9,240,000(약 1.54M) vs CRM 카드 2,093,900 — 세 층 모두 벌어짐.
- **본 티켓은 READ-ONLY 진단까지.** 수정(webhook payload의 merchant/tid 파싱·매핑, 폴러 pull=0 원인, 뷰 NULL-tid 취급, cross-center 귀속)은 planner 가 별도 티켓으로 스코프.
