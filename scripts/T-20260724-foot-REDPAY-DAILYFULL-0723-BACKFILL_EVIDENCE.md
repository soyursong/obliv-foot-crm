# T-20260724-foot-REDPAY-DAILYFULL-0723-BACKFILL — Evidence

**Run**: 2026-07-23T23:45Z (macstudio, node v26.4.0) · dev-foot
**Ticket**: 7/23 daily_full 소급 백필 (parent RECONCILE Branch B 진단 후속)
**db_change**: false (DDL 0 · 멱등 upsert · 파괴 op 0) · **outcome**: (B) 미달 — cause(b) WHITELIST gap 로 수렴 실패

---

## 1. Backfill 실행 (scripts/redpay_macstudio_poller.mjs)

```
env: REDPAY_POLL_MODE=daily_full REDPAY_DAILY_FROM=2026-07-23 REDPAY_DAILY_TO=2026-07-23
     REDPAY_BUSINESS_NO=457-23-00938 REDPAY_DOMAIN=foot
화이트리스트 소스=env override(domain=foot) (merchant=26 tid=26)
daily_full 백필 범위 override: from=2026-07-22T15:00:00.000Z to=2026-07-23T14:59:59.000Z  ← 정확히 7/23 00:00~23:59:59 KST
레드페이 200 OK (403 아님) — success=true
완료 elapsed_ms=56747 fetched=2 scoped_out=0 drift=0 upserted=2 errors=0
```

- **fetched=2** — 서버측 `tid=` narrowing(26 whitelist TID)으로 하루 전체에서 2건만 유입(둘 다 기존 09:16 ±1004 테스트쌍, 멱등 → 신규 INSERT 0).
- **파괴 op 0** 확인: 멱등 upsert(on_conflict=external_trxid,external_status,amount).

## 2. poller_state 무오염 확인 (실시간 웹훅 cursor 격리)

| 필드 | BEFORE | AFTER | 판정 |
|------|--------|-------|------|
| last_daily_to | 2026-07-16T01:13:25Z | **2026-07-23T23:45:06.556Z** | daily_full 이 갱신 (=run nowIso 정확 일치) ✓ |
| last_incremental_to | 2026-07-23T23:41:12.77Z | 2026-07-23T23:46:13.238Z | run nowIso(23:45:06.556)와 **불일치** → 병행 5분 incremental cron 이 정상 전진시킨 값. 백필이 건드리지 않음 ✓ |

> ⚠ 폴러 로그의 `poller_state heartbeat 갱신 완료: ... last_incremental_to=...` 문구는 **cosmetic 버그**(L483 라벨 하드코딩). daily_full 경로의 실제 write payload(updatePollerState)는 `last_daily_to` 만 포함(L471). DB 실측으로 웹훅 cursor 무접촉 확정.

## 3. count 재확인 (7/23 KST, redpay_raw_transactions, PHI 제외)

- **BEFORE=AFTER**: 총 10행 (Y 7, N 3), net **9,241,004**. 백필로 신규 0행.
- 시스템 적재분 approved_at 전건 09:05~11:24 UTC(=18:05~20:24 KST) → cause(c) 웹훅 18:05 등록 후만 유입 재확인.

## 4. 현장 24건 대조 — RedPay 정본 merchant-scope 진단 (READ-ONLY, no upsert)

7/23 business_no=457-23-00938 직접 조회(`tid=` 미전송, merchant 1차 권위 기준) = 총 47행(457 공유 5도메인).
**"풋" merchant 명 기준 foot 거래 = 24 승인(Y) + 1 취소(N)** → **현장 직접조회 24+1 과 정확 일치.**

| foot merchant | total | approved Y | 26-merchant allowlist |
|---|---|---|---|
| 1777285001 풋1(VAN) | 3 | 3 | ✅ 등록 |
| **1777285002 풋2(VAN)** | **5** | **5** | ❌ **미등록(allowlist 누락)** |
| 1777285003 풋3(VAN) | 6 | 6 | ✅ |
| 1777285005 풋5(VAN) | 6 | 6 | ✅ |
| 1777285006 풋6(VAN) | 2 | 2 | ✅ |
| 1777285007 풋7(VAN) | 1 | 1 | ✅ |
| 1777289013 풋(무선) | 2 | 1(+1 취소) | ✅ |
| **합계** | **25** | **24** | |

## 5. 갭 분해 (추정 금지 · 쿼리 근거) — 왜 백필이 수렴 못했나

시스템 7 Y ↔ 정본 24 Y, **미적재 17 Y 전량이 whitelist gap(cause b)에 막힘** → daily_full 재pull(whitelist 유지)로 구조적 회복 불가:

1. **TID whitelist gap (5개 미등록 단말)** — allowlist 등록 merchant 위 거래이나 tid 미등록 → 서버측 `tid=` narrowing 탈락. 18행:
   - `1047535797`×1, `1047535835`×2, `1047535837`×6, `1047535842`×6, `1047535845`×3
   - (티켓 예측=797/837/842. 진단으로 835·845 추가 확인)
2. **Merchant whitelist gap (1개 미등록 가맹점)** — **풋2(1777285002)** 5 Y → merchant allowlist(26) 누락 → filterToFootScope 단계에서 배제(fetch 되더라도 탈락). **티켓 미예측 신규 발견.**
3. **cause(c) 웹훅 18:05 등록** — 시스템 기존 10행이 18:05 이후만 유입된 이유. 단, 미적재분 회복은 위 whitelist gap 이 선결이라 cause(c) 단독 회복 경로 없음.

- **원인불명분 = 0.** 24+1 이 RedPay 정본 foot merchant 로 100% 설명됨.
- **뷰버그(cause a)** = 탭 표면화 이슈로 raw 적재 문제와 별개 축(본 진단 범위 밖).

## 6. 결론 · 후속

- 백필은 cause(c) 회복만 담당. **본 7/23 케이스는 cause(c) 회복 대상 whitelist-TID 거래가 0(fetched 2 모두 기존)** → 백필 단독으로 24 수렴 **불가**(over-promise 금지 confirm).
- **수렴 선결 = cause(b) WHITELIST-EXPAND** (별도 티켓, DA CONSULT 게이트):
  - TID +5: 1047535797, 1047535835, 1047535837, 1047535842, 1047535845
  - MERCHANT +1: 1777285002 (풋2 VAN)
  - 확장 후 daily_full 7/23 재pull → 18(TID)+5(풋2) 거래 회복 예상.
- **cause(a) VIEW-PAYLOAD-SHAPE-FIX** 미착지 시 탭 완전수렴 별도 보장 X.

---
*replay: `REDPAY_POLL_MODE=daily_full REDPAY_DAILY_FROM=2026-07-23 REDPAY_DAILY_TO=2026-07-23 REDPAY_BUSINESS_NO=457-23-00938 REDPAY_DOMAIN=foot node scripts/redpay_macstudio_poller.mjs`*
