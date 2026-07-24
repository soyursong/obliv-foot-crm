# T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP — 8-loci 동기 audit + 현장 2차 relay reconcile

last_verified: 2026-07-24 · dev-foot · READ-ONLY audit + 9th-locus 편입 근거
근거 티켓 §"현장 2차 relay 보강"(MSG-20260724-103743-uhv6) reconcile 3항 + RC done_log.

## A. 편입 대상 (0723GAP)
- merchant **1777285002**(풋2 VAN, 285001↔285003 seed-omission) — 신규 편입.
- 5 TID(1047535797·835·837·842·845) — 기등록 merchant(285001/003/005/006/007) VAN 재프로비저닝 신 TID(구 1047479xxx superseded).

## B. loci별 285002 반영 대조 (선례 CORRECTION 사고=5곳만 반영·3곳 누락 재발 방지)

| # | locus | 경로 | 285002 | 비고 |
|---|-------|------|--------|------|
| a | registry SSOT md | redpay_foot_terminal_registry.md §2/§8 | ✓ | DA-owned SSOT, §8 Opt-B′ DECISION 2026-07-24 |
| b | env (poller merchant/TID set) | ~/.env.redpay-foot | ✓ | poller override 도메인 스코프 |
| c | EF redpay-reconcile FOOT_MERCHANT_SET | functions/redpay-reconcile/index.ts | ✓ | 27-set VAN8 |
| d | recon view (tid-membership) | Opt-B′ 마이그 superseded_tids UNION 재정의 | ✓ | merchant seed INSERT 285002 + 구/신 TID UNION |
| e | ocr sql | ocr_receipt_redpay_match | ✓(merchant 파생) | registry 기반, 하드코드 없음 |
| f | poller const | scripts/redpay_macstudio_poller.mjs | ✓ | DEFAULT band↔center 미러 |
| g | closing-tab spec | tests/e2e/T-20260708-foot-REDPAY-CLOSING-TAB.spec.ts | ✓ | 회귀 spec |
| h | plist | launchd/com.obliv.foot.redpay-macstudio-poller.plist | ✓ | 폴러 env 배선 |
| **9** | **_shared webhook FOOT_MERCHANT_SET** | **functions/_shared/redpay-foot-merchants.ts** | **✓ (본 reconcile 편입)** | **★webhook-path 9th locus — 아래 §C** |

→ 8곳 + 9th 전량 285002 반영. 재-drift 0.

## C. 현장 2차 relay 보강② reconcile 결과 — env-var `REDPAY_WEBHOOK_BUSINESS_NO_ALLOW`

현장 요청: `REDPAY_WEBHOOK_BUSINESS_NO_ALLOW` `457,511` → `457,511,1777285002`.
**판정 = literal append 하지 않음(현장 값 그대로 붙여넣기 금지). 대신 webhook-path merchant whitelist(9th locus)에 285002 편입.**

### (a) 9th locus 여부 = YES, 편입
- webhook EF(redpay-webhook/index.ts)는 2단 필터: step4 business_no(`isAllowedBusinessNo`, env=`REDPAY_WEBHOOK_BUSINESS_NO_ALLOW`) + step5 merchant_id whitelist(`centerForMerchant`→`_shared/redpay-foot-merchants.ts` FOOT_MERCHANT_SET).
- 285002는 step5에서 `centerForMerchant→'unknown'`→`unknown_merchant_alerted` drop.
- 이 _shared FOOT_MERCHANT_SET은 poller-path 8-loci(reconcile inline set)와 **별개 미러**였으나 26-set(285002 부재)로 남아 있던 **누락 locus** → 9th locus로 편입(285002 추가, 27-set VAN8). commit 반영.

### (b) semantic 정합 = env 변경 불요
- 457·511 = **business_no** prefix(457-23-00938 foot / 511-60-00988). 1777285002 = **merchant_id**(10-digit).
- `isAllowedBusinessNo`는 payload business_no를 정규화 후 exact match. merchant_id를 business_no allow에 append하면 **never-match 무의미 엔트리**(파싱 semantics 오염 위험) — drop 원인(step5 merchant whitelist)을 해소하지 못함.
- 풋2(285002) business_no = **457-23-00938** = 기존 allow `457`에 이미 open(REDPAY-LOOKUP-BIZNO-511TO457 §80 "457·511 둘 다 열림, 웹훅 수신 무영향" 확인). → **business_no env 변경 불필요.** 올바른 키 = merchant_id whitelist = (a) 9th locus.

### (c) DAY1 AC3 ↔ RC 텐션 = webhook filter가 실제 drop 벡터(로그 근거, 추정 아님)
- RC 티켓 done_log(T-20260724-foot-REDPAY-1805PLUS-RESIDUAL-CAPTURE-RC): 미적재 3건(승인 23005414/30031451/30024628) 전부 TID 1047535843 / merchant **1777285002**. RC = **"웹훅은 수신됐으나 whitelist 필터로 드롭"**(merchant 1777285002 미등록) 100% 귀인.
- 즉 18:05+ 잔여 3행의 실제 drop 벡터 = **webhook step5 merchant whitelist**(poller-only 아님). DAY1 AC3 "18:05+ whitelist gap=0건"은 이 3건에 대해 오판(원장 확보 전 raw 부재로 배제 처리됐던 것).
- → poller-path(reconcile) + webhook-path(_shared) **양쪽 locus 편입**이 정합. 양쪽 다 285002 반영 완료(§B [c],[9]).

## D. 현장 2차 relay 보강① reconcile = divergence 아님(조치 불요)
- 현장 "6정상/3누락"(18:05+ 웹훅구간 subset, 누락3=23005414/30031451/30024628=전량 285002)은 본 티켓 진단 merchant미등록 5Y(full-day 7/23)의 subset(3 ⊂ 5). 모순 아님.
- AC-2 백필 스코프는 여전히 **full 7/23 daily_full 재pull**(3건 부분백필 금지). 최종 acceptance = 승인24+취소1 / net 10,779,980원 수렴.

## E. 상태
- 상태·게이트 무변경(approved, ball=dev-foot, 빌드 in-flight). §3.1 ADDITIVE(Opt-B′) 유지 — 9th locus 편입은 코드 const 미러 sync(ADDITIVE, DDL 아님, §Non-goals DDL 화이트리스트 무영향).
- deploy-ready 전: MIG-GATE 4필드 + AC-2 재pull FROM/TO=2026-07-23·화이트리스트 스코프·last_incremental_to 미접촉 재확인.
