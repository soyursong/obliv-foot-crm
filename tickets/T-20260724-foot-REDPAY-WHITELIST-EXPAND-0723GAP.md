---
id: T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP
domain: foot
status: consult-pending
priority: P1
parent: T-20260724-foot-REDPAY-DAILYFULL-0723-BACKFILL (outcome B, cause(b) whitelist gap)
da_consult: REQUIRED (1차 게이트, build 前 필수) — 발행 대기/진행중. GO(ADDITIVE/Opt-B ruling) 수신 후에만 build.
db_change: 예정 (redpay_terminal_registry seed +6행 · UNIQUE 제약완화 검토 Opt-B → DA ruling 확정 후 dev-foot DB 직접 실행 + rollback)
e2e_spec_exempt: 검토중 (registry/poller = ef+data 층. WHITELIST-EXPAND 선례 spec 재사용/회귀 추가 예정)
mig_gate: 미기입 (deploy-ready 마킹 시 seed 마이그+롤백 4필드 기입)
---

# T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP — 풋 레드페이 7/23 cause(b) whitelist 확장

## 요약
7/23 미적재 17Y 의 근본 cause(b) = whitelist gap. RedPay 정본 probe 로 확정:
- **신규 merchant 1개**: 1777285002 (풋2 VAN), tid 1047535843 — 285001↔003 사이 seed-omission.
- **신규 TID 5개**: 1047535845/842/837/835/797 = 기등록 merchant(285001/003/005/006/007)의 **VAN 단말 재등록(신 TID)**. 구 TID(1047479xxx)는 7일 dead.

★ 티켓 framing("merchant+1, tid+5")보다 gap 이 큼 — 5 TID 는 신규 단말이 아니라 **기존 merchant 의 단말 교체**. 구 TID 에 21 historical raw 행(7/11~14) 존재 → UPDATE-in-place 위험 → **UNIQUE(merchant_id)→UNIQUE(merchant_id,tid) 완화 + ADDITIVE INSERT(Opt-B)** 권고. 근거: `scripts/T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP_CONSULT-EVIDENCE.md`.

## 진행 게이트 (엄수)
1. **[진행중] DA CONSULT 1차 게이트** — (a) 285002 foot 귀속 (b) 6 TID→merchant 매핑 + Opt-B 모델 승인 (c) cross-tenant 역오염 0. **GO 수신 전 build 금지.**
2. **[대기] 8-loci 동기** (SSOT md + env + EF const + poller + view/registry seed + ocr + closing-tab + plist) — 편입 후 8곳 audit.
3. **[대기] daily_full 7/23 재pull** → 미적재 17Y 회복 확인 (FROM/TO 로그 + last_incremental_to 무접촉).
4. **[대기] deploy-ready** — MIG-GATE 4필드(seed 마이그+롤백).

## 범위 경계 (over-promise 방지)
- 본 티켓 = **수집 스코프(whitelist)**. 탭 표면화(cause a, VIEW-PAYLOAD-SHAPE-FIX)는 별개 축 → 탭 완전수렴 별도 보장 X.
- WATCHDOG 커버리지 갭(285002 미포착) = pre-ingestion blind spot → spinoff 판단(planner). 본 티켓 범위 밖.
