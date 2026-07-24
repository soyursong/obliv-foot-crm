# T-20260725-foot-REDPAY-WATCHDOG-TID-GRAIN-RECON — build evidence

- **date**: 2026-07-25 (KST)
- **agent**: dev-foot
- **gate**: DA CONSULT-REPLY GO + `db_change=false` → 대표 게이트 면제(§3.1), supervisor `backend_script_no_db` 검증
- **DA SSOT**: `redpay_foot_terminal_registry.md` §10 (DECISION 2026-07-25, verdict=GO·db_change=false)
- **scope**: 기배포 merchant-grain 워치독(`redpay_terminal_watchdog.mjs`, commit 4ed4e12c)에 **TID-grain 대사 diff-pass 1개 추가**. 별도 job/테이블 신설 0. DDL 0.

---

## 1. 무엇을 왜 (근인)

기배포 워치독(①~③)의 감지 단위 = **merchant**. 그러나 적재/소비 필터의 탈락 단위 = **TID**((merchant_id,tid) 복합, §8.5.1).
→ 이미 명단에 있는(known) foot merchant 가 신 TID 를 발급하면 merchant 는 통과, TID 만 silent-drop → ①의 "미분류 merchant" 그물에 안 걸림. 3세대 반복(0723 `1047535xxx` → 0724 `1047538xxx`). 이 blind-spot 을 잡는 **직교 보완** TID-grain 대사를 얹음.

## 2. 설계 준수 (DA §10 R1~R3 + build-gate)

| 항목 | 구현 |
|------|------|
| **R1 권위소스** | RedPay 정본 파트너 API(read-only GET), NOT `redpay_raw_transactions`. `fetchAllUnfilteredMultiBizno`. |
| **R1 raw-presence 분기** | 알람 TID의 raw 존재여부 emit(`checkRawPresence`) → raw 有 = seed-only 소급표면화(§9.5.2) / raw 無 = 백필 필요(§7). 슬랙 payload `• 조치:` 라인. |
| **R2 grain** | foot-스코프 merchant 내부 TID-grain. `merchant ∈ registry(active foot)` = 권위키 불변(타도메인 오발 0), `tid ∉ membership` = 탐지. `detectUnclassifiedFootTids`. |
| **R3 불변식** | 대사 membership = `tid ∪ unnest(superseded_tids)` (active foot 행). `buildMembershipTids`. active tid만 쓰면 remap 후 구 TID false-alarm → UNION 필수. |
| **AC-1** | `COALESCE(col_tid, data.tid)` = `extractTid` (538144 col_tid-only 실증 대응). |
| **build-gate §10.5-4 bizno** | 전환기 511∪457 union(`REDPAY_BUSINESS_NOS`). merchant-grain(①) fetch 무접촉. |
| **N-윈도우** | 7일 rolling(`REDPAY_WATCHDOG_TID_QUERY_DAYS=7`), 일 1회. |
| **AC-3 dedup** | TID-keyed 로컬 JSON 상태(`alerted_tids`) + `autoReleaseClassifiedTids` — membership 편입(WHITELIST-EXPAND) 시 자동 해제 = R3 UNION 자연해소. |
| **db_change=false** | registry 읽기=read-only. 신규 컬럼/테이블/enum/뷰 0. `saveState`=macstudio 로컬 JSON. |
| **무회귀** | merchant-grain(①~③)은 단일 bizno(env) fetch·3일 window 그대로. TID-grain은 독립 fetch(별도 조회). |

## 3. build-gate(1급) READ-ONLY bizno probe — 511 vs 457 확정

스크립트: `scripts/T-20260725-foot-REDPAY-WATCHDOG-TID-GRAIN-RECON_BIZNO-PROBE.mjs` (RedPay GET + Supabase GET only, write 0)

```
[registry] active foot merchant=27 membership(tid∪superseded)=36
[bizno=511-60-00988] trx=0   distinct_merchant=0  distinct_tid=0   footNewTids=0
[bizno=457-23-00938] trx=189 distinct_merchant=38 distinct_tid=42  footNewTids=0
```

- **확정**: foot 실거래는 전량 **457-23-00938** 하위(7/23 이관 완료). 511=0건.
- **511만 조회 시 FALSE-CLEAN 실증** → 전환기 대사 스코프 = **511 ∪ 457 union**. (DA §10.2 함정 확증)
- 457도 5도메인 공유(도수/피부 merchant 다수 출현) → bizno 단독 필터 불충분, `merchant ∈ registry` foot-스코핑이 권위(§10.2 정합).
- footNewTids=0 = 현재 registry membership(36)이 신 TID 전량 커버(0724gap seed 반영 후 정상 clean 상태).

## 4. self-test (네트워크 無 합성 픽스처) — 순수로직

`node scripts/redpay_terminal_watchdog.mjs --self-test` → **전체 통과**. TID-grain 신규 검증:
- R3 membership = tid ∪ superseded_tids (신·구 TID 모두, 3종)
- AC-1 extractTid: col_tid 우선 / data.tid 폴백 / 부재 시 빈문자열
- TID-grain: 기분류 foot merchant 명단-밖 신 TID **2종 감지**(col_tid + data.tid shape), 건수 누적
- 미분류 merchant(①담당) 제외(중복알람 방지), 타도메인 merchant 제외(권위키 불변)
- TID dedup 억제 + auto-release(membership 편입 시 해제)
- recon union이 511·457·현행 env bizno 모두 포함(false-clean 방지)

## 5. live dry-run (RedPay 정본 API 실조회, read-only) — 슬랙 미발송·상태 미저장

`node scripts/redpay_terminal_watchdog.mjs --dry-run`:
```
가동 [DRY-RUN]: business_no=457-23-00938 ... tid_recon_bizno=[511-60-00988∪457-23-00938] tid_query_days=7
명단(registry active) merchant=27건 tid=27건 로드
④ TID-grain 대사 시작: membership(tid∪superseded)=36건
  [TID-recon] bizno=511-60-00988 조회 0건
  [TID-recon] bizno=457-23-00938 조회 189건
④ 대사 조회 189건 → 기분류 foot merchant 의 명단-밖 신 TID 0종 감지
④ ✅ TID-grain clean — 명단-밖 신 TID 없음 (적재/소비 필터와 정합).
[dry-run] 상태파일 미저장
완료 ... tid_new=0 tid_suppressed=0
```
- 실 RedPay 정본 API 189 live trx 스캔, 0 false-alarm = 현 시점 정합(clean) 상태 실증.
- 검출 경로는 self-test(§4)에서 2종 flag 로 실증(live 는 정상 clean 이라 0).

## 6. 무영속 확인 (db_change=false)

- `git diff --stat`: `scripts/redpay_terminal_watchdog.mjs`(수정) + probe/evidence(신규) 만. `supabase/migrations/` 무변경.
- DDL 0, 신규 컬럼/테이블/enum/뷰 0. registry·raw_transactions read-only.
- dedup 상태 = macstudio 로컬 JSON `~/.redpay-watchdog-foot-state.json` (v1→v2 자동마이그, `alerted_tids` 추가).

## 7. 관측 (out-of-scope, 정보성)

- ③ 휴면 pass 가 갓 seed 된 538xxx 일부 TID 를 "휴면"으로 표기(raw 미적재분). 이는 ③(detectDormant)의 **기존 로직**이 신 registry 상태에 대해 보이는 것으로 본 티켓 변경과 무관(내가 건드리지 않음). raw 백필(§7) 완료 시 자연 해소. 필요 시 planner 별건.
- launchd plist 변경 불요(동일 스크립트 인라인 pass — 별도 job 아님, §10.4).
