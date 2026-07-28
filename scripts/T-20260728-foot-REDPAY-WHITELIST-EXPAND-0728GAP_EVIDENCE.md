# T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP — 증거 (READ-ONLY prod probe + runtime forensics)

작성: dev-foot / 2026-07-28 / macstudio-local node, GET-only, write·DDL 0
probe: `scripts/T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP_CONSULT-PROBE.mjs`

---

## 트랙1 — registry seed (DA 게이트 대기) : pre-seed READ-ONLY 실측

### ① registry 현재값 (target 2 merchant)
| merchant_id | domain | tid(현재·구) | superseded_tids | label | active |
|---|---|---|---|---|---|
| 1777289006 | foot | 1047479480 | NULL | 풋(멀티) | true |
| 1777288008 | foot | 1047479475 | NULL | 풋(유선) | true |

### ①b 신 2 TID 전역 부재 확증
- `1047538239`: registry.tid hit=0 / superseded_tids hit merchants=[]  → **registry 전역 부재**
- `1047538246`: registry.tid hit=0 / superseded_tids hit merchants=[]  → **registry 전역 부재**
- ∴ 두 merchant 는 이미 registry 행 보유(구 tid) → plain INSERT = ON CONFLICT(merchant_id) DO NOTHING = **no-op → 신 TID 미저장(silent fail)**. ⛔INSERT ✗ → **superseded-remap UPDATE ✓** (0724/0725gap verbatim).

### ② redpay_raw_transactions 실측 (raw_payload.data merchant 확정 — 힌트 단독채택 아님)
- **1047538239 → merchant 1777289006 "오블리브-서울오리진점 풋(멀티)"** (band 289* = foot 멀티, §1). raw **10건** / Σ 11,390,000 (7/27 04:17Z ~ 7/28 06:17Z, external_status=Y). raw_present=true.
- **1047538246 → merchant 1777288008 "오블리브-서울오리진점 풋(유선)"** (band 288* = foot 유선, §1). raw **2건** / Σ 10,200 (7/28 05:46Z, external_status=Y). raw_present=true.
- ⚠ **티켓 데이터 정정**: 티켓 표는 239 를 "풋 멀티 2건 ₩270,000"(7/28 부분만·불완전), 246 을 "미상"으로 기재. 실측 raw = 239 는 **10건 ₩11,390,000**(7/27 첫등장 포함), 246 은 **1777288008 풋(유선) 2건 ₩10,200**. "신규 2대분 합 ₩280,200" 는 7/28 부분 스냅샷 착시.

### ③ AC-3 baseline (live 뷰 직접질의)
- `SELECT count(*) FROM v_redpay_reconciliation_daily WHERE tid IN ('1047538239','1047538246')` → **apply前 = 0** ✓
- 뷰 registry-파생 실증(Opt-B′ 20260724170000 live): 已remap 배포분 `1047538241`(0724gap) → view_rows=11, `1047538235`(0725gap) → view_rows=1 로 뷰에 표면화됨. ∴ 본 seed-remap 시 239/246 도 **소급 표면화**(재적재/백필 불요, §9.5.2).
- 뷰 grain = per-transaction(row-level, VAN∪CRM UNION ALL) → apply後 count 은 239 raw 10 + 246 raw 2 (+ payment-side leg) = **12+ 행 예상**(티켓 "4" 는 불완전 데이터 산정, 실 표면화는 그보다 큼). DoD 판정신호 = **apply前 0 → apply後 >0(실매출 표면화)**; registry_hit/raw-only 카운트 금지(0725gap 교정 계승).

### 예정 mechanic (DA GO 후)
```
1777289006: tid 1047479480 → 1047538239, superseded_tids += 1047479480 (DISTINCT)
1777288008: tid 1047479475 → 1047538246, superseded_tids += 1047479475 (DISTINCT)
WHERE domain='foot'
```
no-DDL data-lane UPDATE (0725gap 20260727100000 블록 verbatim). ⛔ADD COLUMN/CREATE OR REPLACE VIEW 재실행 금지(Opt-B′ 소관).

---

## 트랙2 — ★AC-4 detection-gap RC (read-only, DA 무관, 완료)

### 판정: **detection-gap 버그 없음. 가설 A~D 전부 REFUTED (런타임 증거).**

증거 = ① alerted_tids 상태파일(`~/.redpay-watchdog-foot-state.json`, mtime 2026-07-28 14:50 KST) + ② poller launchd 로그(`~/logs/redpay_macstudio_poller.out`).

**239 (1047538239, merchant 1777289006 풋멀티) — 미발화 아님, 7/27 정상 발화:**
- 로그: `2026-07-27T04:18:54Z [TID-ALARM-REALTIME] 미등록 TID 즉시 알람 발송 tid=1047538239 merchant=1777289006 trx=1 ch=C0ATE5P6JTH` = **2026-07-27 13:18 KST 슬랙 발송됨**.
- state: `alerted_tids["1047538239"].first_alerted_at = 2026-07-27T04:18:54Z, source=poller-realtime`.
- 7/28 재거래(10:20·13:39·15:17 KST)는 **TID 자신이 7/27부터 alerted 상태 → 정상 dedup 억제**(TID-level dedup 의도된 동작). 재알람 안 함이 정상.

**246 (1047538246, merchant 1777288008 풋유선) — 7/28 첫등장, 정상 발화:**
- 로그: `2026-07-28T05:50:26Z [TID-ALARM-REALTIME] ... tid=1047538246 merchant=1777288008 trx=2` = **2026-07-28 14:50 KST 발송**(티켓 "14:50 정상 4분내" 일치).

### 가설별 판정 (실코드+로그+state 대조, 추정 0)
- **가설A (merchant-level dedup 로 239 억제) = REFUTED.** dedup 은 코드상 **TID-keyed**(`state.alerted_tids[tid]`, poller L490/568 · watchdog L568). 239 가 7/28 억제된 이유 = 239 **자신의 TID** 가 7/27 alerted 여서(정상), merchant 키잉 때문 아님. 신 TID(538246)는 억제 없이 즉시 발화 → merchant-level 억제 가설 반증.
- **가설B (filterToFootScope drift 조기탈락) = REFUTED.** 239 는 `[NEW-TID] 풋 merchant 인정 + 미등록 TID` drift 로 정상 산출·알람됨(로그 L34616~). 탈락 없음.
- **가설C (실행창 정렬/launchd 로그) = REFUTED.** poller launchd 300s StartInterval 정상 가동(로그 연속). 239 첫거래 7/27 04:17Z → 04:18:54Z(2분내) 발화. 실행창 miss 없음.
- **가설D (발신층 침묵) = REFUTED.** 239·246 모두 ch=C0ATE5P6JTH 발송 성공.

### 근본 오인
"239 미발화·7/28 첫등장" 은 **7/28 수동 대사자가 7/27 정상발화·TID-dedup 억제분을 '신규 미발화'로 오독**한 것. 실제 239 는 7/27 첫등장·발화 완료, raw 전량 캡처(§10 admission 정상). silent-drop 아님 — 뷰 membership latency(=seed 대기)뿐(§10.4.1 예상 잔여).

### spinoff 여부: **불요.** 실버그 없음(A/B 반증). detection-gap fix 별건 티켓화 없음.

### (선택) 개선 여지 — 참고
TID-dedup 은 "신 TID 1회 발화 후 seed 까지 억제 유지"가 설계다(스팸 방지). seed 지연 시 후속일 수동 대사자가 재알람 부재를 오인할 수 있음(이번 케이스). 근본 해소 = **적시 seed**(트랙1) + §10.4.2 fast-follow(뷰 tid-membership 도 merchant-keyed 이관 → seed-remap 루프 자체 종식). 둘 다 기존 트랙. detection 층 코드변경 불요.
