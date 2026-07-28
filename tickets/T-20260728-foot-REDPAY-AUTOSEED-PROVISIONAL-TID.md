---
id: T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: "ef_only — scripts/redpay_macstudio_poller.mjs --self-test (31/31 PASS; 신규 autoseed 후보선택 7-case 포함. 폴러=macstudio launchd, FE E2E 무관 → self-test 대체. rows-affected assert/notify-on-change/0-row 분별은 실 PATCH 경로 = supervisor code-gate 검증항목)"
summary: "레드페이 폴러 자동 수렴 seed — drift(기등록 foot merchant 아래 미등록 신 TID)를 registry 기존 행 superseded_tids 에 DISTINCT-append UPDATE 로 자동 반영 → 뷰 membership(tid∪superseded) UNION 즉시 소급 표면화 → 4세대(0723→0724→0725→0728) 수동 seed 루프 구조적 종식. ★DA CONSULT-REPLY(MSG-20260728-185221-xvx6, verdict GO/ADDITIVE data-lane CONDITIONAL) mechanic 정정 준수: (1) plain provisional=true INSERT ✗ (ON CONFLICT(merchant_id) DO NOTHING = no-op silent-fail) → superseded DISTINCT-append UPDATE ✓, (2) primary tid 자동승격 배제 = 자동경로 append-only(구·신 병존 live 중 machine demote 금지, §1 강화), (3) provisional 컬럼 미신설(§2 REJECT, no-DDL). 가드 4종(§4): ①rows-affected=1 assert(0-row 은 확증 GET 으로 멱등 vs write-차단 분별, (b)=fail-loud+알람) ②멱등+notify-on-change-only(dedup, 배열 bloat 0) ③fail-closed(registry 소스 아닐때·신규/미등록 merchant·active foot 행 부재 시 미발화 — 신규 merchant 자동 seed 절대 금지, DA CONSULT 게이트 존치) ④A11 워치독 안전망 존치(NEW-MERCHANT·CROSS-TENANT 독립 탐지). 킬스위치 REDPAY_POLLER_AUTOSEED_ENABLED(default true)."
created: 2026-07-28
reporter: planner
consult_ref: MSG-20260728-185221-xvx6 (data-architect CONSULT-REPLY, verdict GO/ADDITIVE data-lane CONDITIONAL)
governance_note: "★DA §5 governance NOTE 고지 대상 — 본 건은 registry(도메인 경계 SSOT)를 런타임 폴러가 상시 자동 mutate 하는 control 신설. mechanic 이 면제 precedent(§3.1 ADDITIVE-equiv: 회귀0·monotonic-widening·롤백=원소제거)라 DA 자율이나, 'governed SSOT 자동 mutation' 성격을 supervisor/planner 에 명시 고지. 이견 시 planner 가 CEO 승격 판단. 리스크 최소표면화 = append-only·confirmed-foot 한정·A11 회귀센서."
commit: PENDING_SUPERVISOR_MERGE
risk_verdict: GO
risk_reason: "변경 격리 = scripts/redpay_macstudio_poller.mjs 1파일(FE·EF 무접촉) + tickets/*.md + evidence. db-change=false: 신규 컬럼·테이블·enum·마이그레이션 0 (superseded_tids text[] + 소비뷰 UNION 은 Opt-B′ 20260724170000 prod applied 旣배포 — 재실행 없음). 자동 write = confirmed-foot merchant 아래 superseded DISTINCT-append UPDATE 단 하나(§3.1 ADDITIVE-equiv: 회귀0·monotonic membership widening·롤백=배열원소 제거). ★admit 판정(filterToFootScope, merchant_id 권위)·매출 산식 무접촉 → 매출 정확도 회귀 0. §4④ A11 워치독 안전망 존치(NEW-MERCHANT·CROSS-TENANT 독립 탐지 무회귀). fail-safe: 슬랙/DB write 오류 전부 비치명(적재 본업 무영향, best-effort, 다음 사이클 멱등 재시도). 대표 게이트 면제(autonomy §3.1). supervisor code-gate 만(§5)."
option_decision: "DA §1 mechanic 채택 — superseded DISTINCT-append UPDATE(INSERT ✗) + primary tid append-only(자동승격 배제) + provisional 컬럼 미신설(§2 REJECT). 가드 4종 구현(§4). registry 소스일 때만 발화(§4③ fail-closed)."
---

# T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID

DA CONSULT-REPLY(MSG-20260728-185221-xvx6, verdict **GO / ADDITIVE data-lane / CONDITIONAL**) 준수 구현.
정본 = `redpay_foot_terminal_registry.md §12` (DA-owned SSOT, 본 판정 codify).

## 배경 (4세대 수동 seed 루프)
`bizno 511→457 churn` 재프로비저닝으로 신 TID(538 band)가 계속 등장 → registry 미등록 →
뷰 tid-membership 정상 탈락(실시간 매출 under-surfacing). 0723GAP→0724GAP→0725GAP→0728GAP
**4세대** 모두 사람이 registry 에 신 TID 를 수동 seed-remap 해 해소해 왔다.
raw 는 §10 merchant-admission 경로로 전량 캡처됨(silent-drop 아님, `raw_present=true`) —
남은 것은 뷰 tid-membership latency 뿐(seed 즉시 소급 해소).

## RC = 수동 seed 루프 구조적 잔존
0b 실시간 알람(T-20260727-...-WATCHDOG-LATENCY-CLOSE)이 인지창을 ≤5분으로 줄였으나
"사람이 명단에 신 TID 를 수동 추가"하는 루프는 그대로였다.

## mechanic 정정 (DA §1, GO의 조건)
- **plain `provisional=true 1행 INSERT` ✗** — 제약 `UNIQUE(merchant_id)` + merchant 는 이미
  registry 행 보유 → `ON CONFLICT(merchant_id) DO NOTHING` = **no-op silent-fail**
  (`cross_crm_write_rowcheck_standard` 위반). 자동화 실체 = **superseded_tids append**(INSERT 아님).
- **정본 = 기존 행 superseded_tids DISTINCT-append UPDATE**(e<>new 가드, 멱등).
  membership `tid ∪ unnest(superseded_tids)` UNION(Opt-B′ 旣배포)이 즉시 신 TID 가시화 → 뷰 소급 표면화.
- **★primary `tid` 자동승격 배제(§1 강화)** — 자동 경로는 primary tid **무접촉·append-only**.
  구·신 병존 live(§8.1) 중 machine 이 primary 를 demote 하면 잘못된 상태단언 → append-only 가 항상-정확·최소표면.
  (수동 remap 마이그레이션은 `tid=신` 승격 유지 = 사람 판정. 자동 경로만 append-only.)
- **`provisional` 컬럼 미신설(§2 REJECT)** — 도메인 경계는 merchant 레벨에 확정(트리거는
  `merchant_id ∈ registry(domain=foot,active)` 아래 신 TID에만 발화 → 정의상 foot). 안전이득 0 ·
  `text[]` per-element flag 불가 · no-DDL 유지가 정답.

## 구현 (scripts/redpay_macstudio_poller.mjs)
1. **config** — `REDPAY_POLLER_AUTOSEED_ENABLED`(default true, 킬스위치) · `REDPAY_POLLER_AUTOSEED_CHANNEL`.
2. **registry 행 스냅샷** — `loadRegistryFromDb()` 가 per-merchant 행(`rows`) 반환 → `resolveWhitelists()`
   에서 `registryRowByMerchant`(merchant_id → {tid, superseded:Set}) + `registrySource` 확정.
   registry 실 SSOT 소스일 때만 채움(§4③).
3. **`selectAutoSeedCandidates()`** (순수·self-test) — drift 중 자동 seed 대상만 그룹핑
   (TID 식별 가능 + tidWhitelist 밖 + active foot 행 보유 + primary/superseded 미포함).
4. **`autoSeedSupersededTids()`** — fresh read → DISTINCT-append 계산(primary 무접촉) →
   PATCH(guard 필터 `tid=neq.신` + `superseded_tids=not.cs.{신}`, `return=representation`) →
   **rows-affected assert**(1=성공 change / 0=확증 GET 으로 멱등 vs write-차단 분별 / >1=이상 fail-loud).
5. **wire** — main loop 에서 `fireRealtimeTidAlarms` **前** 실행 → seed 성공분을 tidWhitelist 에
   즉시 반영(`markSeededLocal`) → 수동 알람 중복 억제. 잔여(신규 merchant·DB 미가용)만 수동 알람 + A11.

## 가드 (DA §4 = supervisor code-gate 검증 항목)
| # | 가드 | 구현 |
|---|------|------|
| ① | rows-affected=1 assert | PATCH `return=representation` 배열 길이 검증. 0-row = 확증 GET 으로 (a)멱등 no-op vs (b)write-차단(RLS/scope) 분별. (b)=fail-loud+슬랙 알람(성공 오인 금지). |
| ② | 멱등 + notify-on-change-only | guard 필터(`not.cs`)로 동일 TID 재감지 = 0-row change. 실제 append(affected=1)일 때만 슬랙 1회. no-op/benign 은 무알람. |
| ③ | fail-closed | `registrySource!=='registry'`(DB 미가용 fallback)·`merchant∉active foot 행`·신규 merchant = 미발화. 신규 merchant 자동 seed **절대 금지**(§3, 285002 류 DA CONSULT 게이트 존치). |
| ④ | A11 워치독 안전망 존치 | 자동 seed 는 benign NEW-TID 만 해소. NEW-MERCHANT·CROSS-TENANT = 워치독 계속 독립 탐지(회귀 센서). |

## §2 mirror (DA §4-5)
자동 append 분은 A11 output 으로 DA 주기 reconcile(자율, 비블로커). primary tid 재정렬은
mirror reconcile 시 사람 cosmetic(자동 밖).

## self-test
`node scripts/redpay_macstudio_poller.mjs --self-test` — **31/31 PASS**
(신규 autoseed 후보선택 7-case: 기등록 신TID·trx누적·fail-closed 미등록merchant·멱등 primary/superseded·
tidWhitelist 등록·미상 스킵·data.tid COALESCE). 근거 = evidence 파일.

## governance NOTE (DA §5 고지)
registry(도메인 경계 SSOT)를 런타임 폴러가 상시 자동 mutate 하는 control 신설.
mechanic 이 면제 precedent 라 DA 자율이나 'governed SSOT 자동 mutation' 성격 명시 고지 —
이견 시 planner 가 CEO 승격 판단.
