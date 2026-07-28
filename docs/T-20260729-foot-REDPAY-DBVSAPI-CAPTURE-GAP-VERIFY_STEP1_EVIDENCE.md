# T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY — STEP1 evidence

- **ticket**: T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY
- **from**: planner NEW-TASK (MSG-20260729-032150-stm3, P2, VERIFY-FIRST)
- **executed**: 2026-07-29 04:33 KST (2026-07-28T19:33Z), macstudio, read-only
- **scope**: no-DDL / no-data-write / registry SSOT 무접촉. service_role GET + RedPay API GET(폴러 동일 경로).

## 관찰 대상 (census 부산물)
TID 1047479158 / merchant 1777289012 / 풋 무선 / net ₩0 / DB 미적재.
※ 코드상 사실: merchant 1777289012 ∈ FOOT_MERCHANT_WHITELIST(무선5), TID 1047479158 ∈ FOOT_TID_WHITELIST(무선5).
  ⇒ 화이트리스트 배제 원인 아님. drift 아님.

## STEP1-A — DB 적재 여부 (redpay_raw_transactions)
`node scripts/...VERIFY_step1_probe.mjs`
- WHERE tid=1047479158 → **0행**
- WHERE external_trxid=1047479158 → **0행**
- redpay_poller_state(id=1): last_incremental_to=2026-07-28T19:30:28Z (heartbeat 신선, 폴러 생존),
  last_daily_to=**2026-07-24T03:11Z (5일째 정지 = daily_full 미가동)**, last_fetched_count=0, last_upserted_count=0.
- **판정: 미적재.**

## STEP1-B — RedPay API 반환 여부 (from=07-22 to=07-29, bizno=457-23-00938)
`node scripts/...VERIFY_step1_api_probe.mjs 2026-07-22 2026-07-29`
- TID 1047479158 매칭 **2건** (merchant 1777289012 전건):
  | trxid | status | amount | approved_at | cancelled_at |
  |-------|--------|--------|-------------|--------------|
  | 0722C8038056 | Y(승인) | +5000 | 2026-07-22 17:30:13 | 2026-07-22 17:30:56 |
  | 0722C8038132 | N(취소) | −5000 | 2026-07-22 17:30:56 | 2026-07-22 17:30:56 |
- **TID net 합계 = ₩0** (43초 승인→취소 void 쌍. census silent-drop=₩0 과 정합).

## 판정 (STEP1 verdict)
- **미재적재 확정 — 단, self-heal 불가(구조적).**
- 근거: 거래일 = **2026-07-22** (오늘 07-29 기준 7일 전). 라이브 폴러 = **incremental 모드**
  (WINDOW_MAX_LOOKBACK_MS = 2h, poller.mjs L407/L1025: `fromDt = max(lastTo−2min, now−2h)`).
  → incremental 윈도는 최대 2h lookback → **07-22 거래는 다음 폴 사이클에서 재적재 구조적으로 불가**.
  → planner 결정트리의 "다음 폴 사이클 지나도 없음 = 실 캡처 갭" 분기에 해당(대기 무의미, 지금 확정).
- **금액영향 재산출 = ₩0** (approve +5000 / cancel −5000 즉시상쇄 void 쌍). 매출 무영향.
- 성격: *historical* 단발 void-쌍 캡처 누락. 라이브·진행형 누락 아님.

## RC 가설 (STEP2/DA 게이트용 — 본 티켓에서 단정 금지)
- 07-22 17:30 = **07-23 RedPay flip(bizno 511→457) 직전**. 당시 폴러는 bizno=**511** 스코프로 조회.
  현재 API(bizno=457)에는 07-22 거래가 보이나, 07-22 당시 511 스코프에 노출됐는지가 RC 후보.
- last_daily_to=07-24 이후 daily_full 미가동 → 사후 backfill 로도 07-22 미회수.
- ⇒ DB-vs-API bidir 렌즈 상시화 + registry/스코프 조사 = **planner/DA 게이트**(STEP2). dev-foot 는 registry SSOT 무접촉 유지.

## 산출물
- scripts/T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY_step1_probe.mjs (DB read-only)
- scripts/T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY_step1_api_probe.mjs (API read-only)
