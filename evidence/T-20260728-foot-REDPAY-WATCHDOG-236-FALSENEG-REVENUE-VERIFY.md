# T-20260728-foot-REDPAY-WATCHDOG-236-FALSENEG-REVENUE-VERIFY — 진단 evidence

- 작성: dev-foot / 2026-07-28
- 대상: TID 1047538236 (0724GAP seed, 288003→풋(유선))
- 성격: READ-ONLY 진단 (db_change=false, DA CONSULT 불요)
- 거래: 2026-07-28 10:11:22 KST / ₩10,000 / 승인번호 48349243

---

## AC-1 [최우선·매출안전] 매출 누락 확인 → **정합 OK, 누락 없음** ✅

`v_redpay_reconciliation_daily` (승인 48349243):
```
row_id            670773ef-c327-4889-aa34-f1e56a3dcc69
close_date        2026-07-28
external_trxid    0728C8497342
tid               1047538236
van_amount        10000
approval_no       48349243
matched_payment_id b6bb6c3d-b303-49c5-a80f-5954f8af3609
crm_amount        10000
crm_method        card
crm_created_at    2026-07-28T01:30:08.691511+00:00
recon_status      "matched"          ← ★ 정합 완료
```
`redpay_raw_transactions` (승인 48349243):
```
external_trxid   0728C8497342
tid              1047538236
amount           10000
external_status  Y (승인)
approved_at      2026-07-28T01:11:22+00:00  (= 10:11:22 KST, 원 거래와 일치)
matched_payment_id b6bb6c3d-...  (NOT NULL)
match_rule       tier3_daily_unique
```
**판정: 거래는 raw 적재 + payment 매칭까지 완료. van_amount=crm_amount=₩10,000, recon_status=matched.
매출 누락 없음 → P0 승격 불요. "매출 정합 OK, 알람만 오탐".**

## AC-2 registry 실재 확인 → **실재함** ✅ (부분 seed 누락 아님)

`redpay_terminal_registry` (tid=1047538236):
```
id             e2bf25f7-0f06-4db6-bdae-e8206c831414
domain         foot
merchant_id    1777288003
tid            1047538236
terminal_label 풋(유선)
active         true
superseded_tids ["1047479471"]
source         redpay_foot_terminal_registry.md §9 (0724 GAP ..., DA-20260725-foot-REDPAY-0724GAP)
updated_at     2026-07-24T20:20:32Z
```
**판정: registry(DB SSOT)에 domain=foot / active=true / tid=1047538236 실재.
0724GAP seed 정상 등록됨. 부분 seed 누락 아님.**

## AC-3 filterToFootScope() drift RC → **stale env override 가 DB registry 를 shadow**

### 근본 원인
- 폴러(`scripts/redpay_macstudio_poller.mjs`)의 `resolveWhitelists()` L268:
  `if (envMerchant && envTid) { return; }` — **merchant·TID env override 가 둘 다 있으면 DB registry 를 아예 조회하지 않고 env 값으로 확정.**
- 운영 env `~/.env.redpay-foot` (최종수정 2026-07-24 10:33) 의 `REDPAY_TID_WHITELIST` 에는
  **0724GAP 538xxx TID(538231/236/237/241) 및 0725GAP(538235/245) 이 없음** (479xxx + 0723GAP 535xxx 32개만).
- 반면 `REDPAY_MERCHANT_WHITELIST` env 에는 1777288003(538236의 merchant) 포함.
- 결과: `filterToFootScope` 에서 `merchantOk=true`(→ admit/적재) 이지만 `tidOk=false`
  → `drift = merchantOk && !tidOk` → "미등록 TID" 알람.

### "모순/false-negative" 발생 메커니즘 (watchdog↔poller 소스 불일치)
- **watchdog** = DB registry 를 읽음 → 538236 이 registry 에 편입된 것을 감지 →
  `dedup auto-release(TID): 명단 편입 감지 → 알림억제 해제` (07-28T00:10:05Z / 09:10 KST).
- **poller** = env override 를 읽음(538236 부재) → 같은 TID 를 drift 로 재감지 →
  재알람 (07-28T01:12:55.475Z / 10:12:55 KST, state file `alerted_tids.1047538236.first_alerted_at`).
- 즉 registry 에는 "등록됨", 런타임 poller 에는 "미등록" = 두 컴포넌트가 **서로 다른 화이트리스트 소스**를
  읽어 발생하는 모순. registry 등록은 실재하나 poller 경로에서 **inert(무효)**.

### 로그 evidence (`~/logs/redpay_macstudio_poller.out`, 7/28 KST 16:00~16:31 UTC 기준 최근)
```
[2026-07-28T07:21:03.637Z][foot] 화이트리스트 소스=env override(domain=foot) (merchant=27 tid=32)
   ↑ 소스가 env override. tid=32 (538xxx GAP 미포함). ※ body 도메인은 "DB registry" 사용(대조군).
[2026-07-28T07:05:56.806Z][foot] [NEW-TID] 풋 merchant 인정 + 미등록 TID 17건 = 기등록 merchant 아래
   신 단말 자동 admit(정상, raw 적재 완료). ... TID=[1047538231,1047538236,1047538239,1047538246,1047538241]
   ↑ "자동 admit + raw 적재 완료" 명시 = 적재/매출 안전. TID 화이트리스트 미포함만이 문제.
[2026-07-28T07:...][foot] 완료 ... drift=17 upserted=25 ... tid_alarm_new=0 tid_alarm_suppressed=5
   ↑ 현재는 dedup 으로 suppressed=5 (231/236/239/241/246). 신규 재알람은 억제 상태.
```
state file `~/.redpay-watchdog-foot-state.json`:
```
alerted_tids.1047538236 = { merchant_id:1777288003, raw_present:true,
  first_alerted_at:"2026-07-28T01:12:55.475Z", source:"poller-realtime" }
```

### 후보 배제
- in-memory 캐시 stale: **배제** — launchd 300s 마다 fresh 프로세스, 매 사이클 resolveWhitelists() 재실행.
- tid 타입/정규화 불일치: **배제** — env·registry·raw 모두 문자열 "1047538236" 일치.
- 뷰 갱신 타이밍: **배제** — 뷰는 recon_status=matched 로 이미 정합.
- **확정 RC = env override 가 DB registry 를 shadow (resolveWhitelists L268 short-circuit) + env stale.**

### 영향 범위 (비블로킹)
- 알람은 FE-측 drift 표면화 전용. `filterToFootScope` 의 admit 판정은 **merchant_id 권위**이므로
  적재/매출/정합에 영향 없음(AC-1 로 실측 확인). = 순수 오탐(false alarm).
- 동일 RC 가 5개 GAP TID(231/236/239/241/246) 공통. 239/246 은 sibling 티켓
  `T-20260728-foot-REDPAY-WHITELIST-EXPAND-0728GAP` 소유(중복 착수 금지) — 공통 RC 교차확인 완료.

### 권고 fix (별건, 본 티켓은 진단까지)
- 즉효(ops): `~/.env.redpay-foot` `REDPAY_TID_WHITELIST` 에 538231/235/236/237/241/245(+0728GAP 239/246) 추가.
- 구조(code, 별건 fix 티켓): `resolveWhitelists()` 가 env override 를 쓰더라도 TID 는 DB registry 와
  **union(합집합)** 하도록 정정 — env 가 registry 를 완전 shadow 하지 않게. 재프로비저닝 drift 근본 봉인.
- ADDITIVE only. DA CONSULT 회부는 fix 티켓 단계(스키마 무변경이면 불요).
