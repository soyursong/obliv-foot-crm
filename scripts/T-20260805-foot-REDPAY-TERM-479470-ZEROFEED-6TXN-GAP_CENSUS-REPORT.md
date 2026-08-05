# T-20260805-foot-REDPAY-TERM-479470-ZEROFEED-6TXN-GAP — READ-ONLY Census 판정

**작성**: dev-foot / 2026-08-05 · **범위**: READ-ONLY census (⛔ prod WRITE/DELETE/UPDATE/UPSERT **0**)
**발원**: 최필경 총괄 RedPay 전수조사 (플랜A 2번 단말 TID 1047479470 = RedPay 피드 0건)
**게이트**: 본 단계 = READ-ONLY. remap/whitelist/stale 확정 시 write(registry UPDATE·external_tid 정정)는 **별 게이트**(DA CONSULT·supervisor DDL-diff·archive-first·0805GAP superseded-remap 멱등 UPDATE 준용).
**증적**: `scripts/audit_out/T-20260805-foot-REDPAY-TERM-479470-ZEROFEED-6TXN-GAP_census.json`
**러너**: `scripts/T-20260805-…_census.mjs` + `scripts/T-20260805-…_ac6_baseline.mjs` (SELECT-only, service_role, 0 writes)

---

## 판정 요약 (AC-5)

> **가설 (ii) whitelist/scope 도, (iii) stale-tid 도 아님. 실질 = feed 원천 미수신(RedPay VAN 미도달).**
> TID 1047479470 의 CRM 6건 결제는 **RedPay 피드에 애초 존재하지 않으며(가설 i remap 반증 포함)**, 그 6건은 **3 AUTHNO × (₩3,000 승인 + 즉시 취소) = net ₩0 자기상쇄 test 쌍**이다. **매출/수납 리스크 0.**

**가설 3종 판정:**

| 가설 | 판정 | 근거 |
|------|------|------|
| **(i) remap** (479xxx→538xxx 재프로비저닝) | ❌ **반증** | CRM 3 AUTHNO(32397288·30880289·58668290)를 `redpay_raw_transactions` 전수 tid-무관 추적 → **raw_hits=0** (어느 tid·어느 merchant 아래에도 부재). `raw_payload->merchant->>id` 권위 실측. 479470 은 registry primary·superseded 양쪽 **부재**(remap 대상 아님). |
| **(ii) whitelist/scope** (registry·폴러필터·bizno-scope 탈락) | △ **부분(구조적)** | 479470 은 registry 26행 어디에도 **미등록**(§2 dead-TID roster 부재 = 총괄 발견 재확인). 폴러 admit 권위 = merchant_id allowlist(`filterToFootScope`, TID-agnostic). **단** whitelist-drop 이면 raw 는 §10 admission 으로 적재되어야 함 → raw=0 = whitelist 이후 필터가 아니라 **피드 자체 미도달**을 시사. |
| **(iii) stale-tid** (CRM tid ≠ 실 단말 TID) | ❌ **판정근거 부재** | 동일 AUTHNO 가 raw 어디에도 없어 "실 단말 TID"를 확인할 수 없음 → stale 여부 판정 불가. 재프로비저닝 이력(479470→538xxx)도 registry 부재로 미확인. |

**dispositive**: 총괄 전수조사(bizno 457 + 구 511, 06~08 전기간 801건)에서 흔적 0 → **whitelist-drop(ii-a)·bizno-scope(ii-b) 모두 배제**(둘 중 하나면 801건 전수에 AUTHNO 가 잡혀야 함). 잔여 유일 설명 = **이 단말의 승인 트랜잭션이 RedPay VAN 에 애초 미전송** (오프라인/독립 CAT 이거나, CRM external_tid=1047479470 이 RedPay 미등록 단말번호).

---

## AC-1 — CRM census (external_tid=1047479470, 08-04)

- **정확 매칭 6건** (표기변형 LIKE %479470% 도 동일 6건, 변형 없음 = `1047479470` 단일 표기).
- **3 distinct AUTHNO**, 각 **승인 1 + 취소 1** 쌍, 전액 **₩3,000**, method=card, memo="코밴 단말 카드결제"/"결제취소".
- 전 6건 `external_trxid=NULL · external_status=NULL · reconciled_at=NULL` (**RedPay 대사 이력 전무**).

| AUTHNO | 승인(KST) | 취소(KST) | 금액 | net |
|--------|-----------|-----------|------|-----|
| 32397288 | 14:23:35 | 14:33:59 | ₩3,000 | ₩0 |
| 30880289 | 14:47:50 | 14:48:49 | ₩3,000 | ₩0 |
| 58668290 | 15:40:16 | 15:40:52 | ₩3,000 | ₩0 |

→ ₩3,000 승인 후 수초~10분 내 즉시 취소 = **단말 test 트랜잭션 지문**. 실 고객청구 유지 위험 **없음**(전 건 취소 완결).

**RedPay 측(AC-1')**: `redpay_raw_transactions` @tid=1047479470 = **raw 0건** (zero-feed CONFIRMED).

## AC-2 — remap 반증 (raw_payload->merchant->>id 권위 실측)

3 AUTHNO 전수 tid-무관 추적 → **landed_tids=[] · landed_merchant_ids=[]** (raw 부재). registry 479470 primary=0행·superseded=0행. → **remap 아님.**

## AC-3 — whitelist/scope

- registry total 26행 중 479470 = **ABSENT**. foot band 의 479-세대(479471·479474·479475)는 각각 538236·538241·538246 으로 superseded 등록됐으나 **479470 만 numeric gap(미프로비저닝)**.
- 폴러 fetch=bizno=457 scope, admit=merchant_id allowlist(26). raw=0 = 피드가 애초 이 거래를 담지 않음(총괄 801건 전수 0 = bizno 457·구511 양측 모두 부재).

## AC-4 — stale-tid: INDETERMINATE (AUTHNO 실 단말 TID 미확인 → 판정근거 부재)

## AC-6 — 부모 gate 정량 대조 (CRM 26 vs RedPay 19, divergence 7)

full-day 08-04 플랜A(payment_attempt_id NOT NULL, card, active) **재현 = CODEREVIEW ⑭ 정합**:

| tid | CRM(all-legs) | CRM(approve/authno) | RedPay raw | CRM−RedPay |
|-----|------|------|------|------|
| 1047479470 | 6 | 3 / 3 | **0** | **+6** |
| 1047538246 | 9 | 7 / 7 | 6 (Y4·N2) | +3 |
| **플랜A 계** | **15** | 10 | 6 | 9 |

**479470 의 divergence(7) 기여** (grain 의존):
- all-legs grain: **6 of 7** — divergence 의 **majority driver**.
- approve/authno grain: **3 of 7**.
- net(매출) grain: **0 of 7** — 자기상쇄 test 쌍, **매출영향 0**.

**부모 baseline 갱신 근거**: 479470 6건은 (a) RedPay 0 대응이 **정상**(피드 미수신 확정, 대사불가행 아님), (b) net ₩0 test 쌍이므로 **매출-대사에서 제외 대상**. → 부모 CRM26 은 이 6건(또는 3 approve)을 **분모에서 차감**하면 RedPay19 와의 divergence 가 **7→1~4 로 수렴**. 정확한 차감폭은 부모의 window·leg-grain 명시 후 확정 권고(in-repo 부재).

---

## 후속(별 게이트 — 본 티켓 범위 밖)

1. **registry 정정 금지 판정**: 479470 은 net ₩0 test 단말 + 피드 미수신 → registry seed/remap **대상 아님**(538xxx 후계 없음). superseded-append 불요.
2. **external_tid 정정 여부**: CRM 6건의 external_tid=1047479470 이 실 단말번호인지(오기재/독립 CAT) = 현장 단말 실물 확인 필요. write 정정 시 Data-Correction Backfill SOP + supervisor dry-run + archive-first.
3. **부모 DUP-VERIFY baseline**: 479470 6건(net ₩0)을 대사 분모에서 제외 → divergence 재계산.

**결론: 판정 회신 + evidence JSON 동봉 → pm-confirm.** (write 0, 별 게이트 미착수)
