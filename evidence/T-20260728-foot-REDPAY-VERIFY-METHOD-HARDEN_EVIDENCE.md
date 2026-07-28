# T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN — Evidence (검증방법 강화)

**티켓**: T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN (P2, **FULL-INTAKE** — 총괄 원문 tail 수신, 4축 확정)
**요청**: 총괄 최필경 — 신규 기능 아님. 기존 approved 티켓의 evidence-AC 를 **additive 상향**. 산출물은 별도 배포물이
  아니라 부모/자매 티켓 verification deliverable 에 **fold**(중복 금지).
**성격**: read-only 계측·대조·문서. db_change=false · no-DDL · no-data-mutation. 매출 split·admit·registry SSOT **무접촉**.
**e2e**: ef_only 면제(FE 렌더 변경 0) → 순수함수 self-test 로 대체.
**생성**: 2026-07-29 (KST). 실행 머신 = macstudio(레드페이 poller/watchdog launchd 정본 호스트).

## ★ 확인 순서 (Axis C — 총괄 명시): Axis B(목록 diff) 먼저 → Axis A(env-shadow) 다음
- 근거 = **"지금 매출이 빠지는 중인지가 먼저"**. 목록 diff 는 워치독 신뢰도와 무관하게 현재 누락 여부를 즉시 확정한다.
- 따라서 아래 순서도 **B → A** 로 배열. (census 도구도 실행 시 axis 순서를 로그로 명시.)

## Axis D — ★본 티켓 비대상 (중복 방지)
- item4 웹훅 EOD 리포트(마감후 리포트/정상·재시도 분리 AC-2b/TTL)는 owner=**T-20260728-foot-REDPAY-WEBHOOK-LATENCY-REMEASURE(in_progress)** 가 전량 커버.
- 본 티켓에서 착수·배포 **금지**. (여기서는 언급만.)

---

## Axis A → 부모 T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX (verification AC 강화)

총괄 req: env-shadow 는 정적 코드대조로 안 잡힘(컴포넌트별 배포·기동 → 런타임 env divergence). 런타임 실 로드값의
개수+정렬목록/해시 덤프·대조 + union fix 前/後 divergence 증명.

### A-1. 용어 매핑 + 허용목록 런타임 판독 지점 **전수** — `docs/REDPAY-ALLOWLIST-RUNTIME-LOCI.md` (신규)
- loose 용어 확정: **"수집 EF"=poller(.mjs), "워치독 EF"=watchdog(.mjs)** — 둘 다 EF 아님, macstudio launchd 프로세스.
  실제 serverless EF = **redpay-webhook**, **redpay-reconcile**.
- 허용목록을 런타임에 읽는 지점 = **4개**: A poller(env∪registry) / B watchdog(registry membership) /
  C webhook EF(정적 FOOT_MERCHANT_SET) / **D reconcile EF(env `REDPAY_TID_WHITELIST`)**.
- **★ 신규 발견(완전성 비평)**: 기존 런타임 valuecheck(ENVSHADOW-RUNTIME-VALUECHECK)는 A/B/C 3자만 대조 →
  **D(reconcile EF)가 env TID 를 읽는 점을 누락**. D 는 현행 `REDPAY_DRY_RUN=true`(G5 hard-lock) posture 로
  env-shadow inert 추정이나, **미계측 표면**임을 명시. 권고 = D 에 webhook 동일 authed introspect 라우트 미러
  (admit 무접촉 read-only) → valuecheck `--ef` 4주체 격상 = **folded follow-up**(별도 supervisor 게이트).
- `~/.redpay-watchdog-foot-state.json` = 워치독 **dedup 상태파일** ≠ 허용목록 소스(오분류 방지 명시).

### A-2. union fix 前/後 divergence 증명 — `scripts/redpay_envshadow_valuecheck.mjs --union-convergence-proof` (신규 모드)
- prod fix 이미 적용됨 → 진짜 '前' 런타임 덤프는 revert 없이 불가. 대신 poller `resolveWhitelistSources()` 의
  (구)shadow-early-return semantic 과 (신)env∪registry-union semantic 을 **동일 fixture 에 태워 divergence 를 결정적 재현**.
- divergence 정의 = registry(SSOT) TID 중 poller 가 로드 못한 집합 크기 = env-shadow silent-drop 표면.

| case | 前(구 shadow) divergence | 後(union) divergence | verdict |
|---|---|---|---|
| 236-FALSENEG RC (stale env + registry 신TID) | **3** (1047538231/236/245 미로드) | **0** | ✅ union 이 봉인 |
| env 완전(누락 없음) | 0 | 0 | ✅ 회귀 없음 |
| reg=null (DB 미가용) | 0(fail-safe) | 0(fail-safe) | ✅ 회귀 없음 |

- **종합: UNION_CONVERGENCE_PROVEN** — 구 semantic 은 stale env 에서 divergence>0(silent-drop), union 은 0(봉인).
- evidence: `evidence/T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX_union_convergence_proof.json`.
- 기존 런타임 실값 대조(A/B/C)의 NO_ENV_SHADOW·수렴 결과는 ENVSHADOW-RUNTIME-VALUECHECK evidence §2-4 참조(중복 생성 안 함).

---

## Axis B (★선착수) → 부모 T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE (census diff 양방향+금액 격상)

총괄 FULL-INTAKE req (원문 tail): TID diff 를 ★양방향 + **실목록 + 금액**으로. 회신은 "빠진 것 없음"이 아니라
**양쪽 개수 + 실제 TID 목록(표)**.
- **"우리 27" 재정의**: registry active 가 아니라 **7/15~28 실제 거래가 있던 TID(=DB 적재분)**. "거래 없는 단말은
  조회에 안 나옴 → 단방향 불완전" → 그래서 양방향 + 금액.
- **(a) 정방향** 우리(DB거래)→API: DB 적재 TID 중 API 목록에 없는 것 = 즉시 누락 → **금액(net) 산출**.
- **(b) 역방향** API→우리(DB거래): API 목록에만 있는 것 → **휴면 단말(foot) vs 타센터 혼입** 구분(merchant 렌즈).

### B-0. FULL-INTAKE 강화 델타 (2026-07-29)
기존(PARTIAL) 도구는 "우리" 기준을 registry active 로 썼고 금액 미산출이었다. FULL-INTAKE 로:
1. **"우리" 기준 = DB 실거래 TID**(`redpay_raw_transactions` resolved tid) — registry-vs-API 로는 은폐되던
   "RedPay 처리됐는데 우리 DB 미적재" 침묵-드롭을 DB-vs-API 축(`flow`)으로 직접 포착.
2. **금액(건수·net) 산출** — API 측·DB 측 각각 부호보존(취소 음수) net. 위험액 = foot-silent-drop(api_net) / forward-db-only(db_net).
3. **양쪽 개수 + 실 TID 목록(표)** 로 회신 형식 격상.

### B-1. 도구 — `scripts/redpay_tid_bidir_reconcile.mjs` (양방향+금액+DB-flow, self-test 24/24 PASS)
- 순수 분류기 `classifyBidir()` — 5-status:
  - `active`(등재 active+API거래) / `superseded`(구 TID 잔존거래·정상) / `absent`(등재 active·API window 무거래=휴면 후보)
    / `DB-only`(구 TID·무거래=정상 소멸) / `API-only`(registry 미등재·거래中=★역방향 침묵 미탐 후보).
- **역방향 정밀화(merchant-center 렌즈)**: bizno union(511∪457)은 센터 공유 → API-only TID 를 merchant_id 로 재분류.
  **merchant∈foot registry → foot-silent-miss(진짜 매출누락 위험)** / merchant∉foot → cross-center(타센터 정상 부재).
- read-only: registry·API 읽기만. registry SSOT 편입/변경 0.

### B-2. 라이브 census (양쪽 개수 + 금액, 2026-07-28 KST macstudio, window 14일=7/15~28, bizno 511∪457)
- registry(active) rows=**27** · superseded-tid=13종. 조회API distinct TID=**53종**(items 496) · DB 실거래 TID=**28종**(raw rows 332).

**총괄 확인용 요약 — 양쪽 개수 + net 금액:**

| 방향 | 분류 | 개수 | net 금액 |
|---|---|---|---|
| 정방향 (a) 우리DB→API | forward-db-only (DB 적재·API 무거래 = 즉시누락 후보) | **0** | ₩0 |
| 역방향 (b) API→우리DB | ★ **foot-silent-drop** (foot merchant·미적재 = 진짜 매출누락) | **1** | **₩0** |
| 역방향 (b) API→우리DB | cross-center (타센터 단말·foot 정상 부재) | 24 | ₩74,312,690 |
| 역방향 (b) API→우리DB | unknown (merchant 미상) | 0 | ₩0 |

- **정방향 (a) = 0건** — DB 적재 TID 전부 API 에도 존재 → 정방향 즉시누락 **없음**.
- **역방향 (b) foot-silent-drop = 1건, net ₩0** — 실 TID: **`1047479158`**(merchant 1777289012, terminal_label
  "풋(무선)", API 2건 net ₩0, DB 적재 0건). = **매출 누락액 ₩0(승인+취소 상쇄)** 이나, foot 단말 API 거래가 우리
  `raw_transactions` 에 **미적재**된 구조적 캡처 갭. ★DB-vs-API 렌즈가 registry-vs-API 로는 은폐되던 갭을 포착
  (registry 에는 auto-seed 로 편입됨 → 기존 registry-lens census 는 'active' 로 정상 판정했을 지점). **net ₩0 = 현재
  매출 빠지는 중 아님** 확정. 캡처 갭 자체는 planner 관찰 대상(다음 폴 사이클 재적재 예상).
- cross-center 24종 ₩74.3M — 전부 non-foot merchant(1777274/275/277/279/280/269xxx = 타센터). foot 누락 아님.
- 전수 표·머신판독 evidence: `evidence/T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE_bidir_census.md` + `_bidir_amounts.json`(supervisor 재현용).

> **결론(Axis B)**: census 를 양방향+실목록+**금액** 기준으로 격상. **정방향 forward-db-only=0(₩0) + 역방향
> foot-silent-drop=1(net ₩0)** = **매출 silent-drop 금액 0** → "지금 매출 빠지는 중 아님" 확정. 단, foot-silent-drop
> 1건(1047479158, net ₩0)은 DB 캡처 갭 관찰 대상으로 planner FOLLOWUP 통지.

---

## Axis C — 확인 순서 확정 (원문 수신 완료)
- FULL-INTAKE 로 순서 확정: **Axis B(목록 diff) 선착수 → Axis A(env-shadow) 후속**. 근거 = "지금 매출 빠지는
  중인지가 먼저". 본 evidence·census 도구 모두 이 순서 반영(§ 상단·census 실행 로그).

---

## 게이트 / 변경 파일
- **db_change=false** · no-DDL · no-data-mutation. registry SSOT·admit(filterToFootScope)·매출 split **무접촉**.
- **Axis D 무접촉**(WEBHOOK-LATENCY-REMEASURE owner) · **신규 npm 0**(SHA256=내장 crypto, fetch=내장).
- **build**: `npm run build` ✅ (FE 무변경, scripts/docs/evidence only).
- **self-test**: bidir **24/24 PASS**(금액+DB-flow 추가) · union-proof PASS(exit 0).
- 변경 파일:
  - `scripts/redpay_tid_bidir_reconcile.mjs` — 양방향에 **DB거래(우리) ↔ API 정합축(flow) + 금액(건수·net)** additive.
  - `scripts/redpay_envshadow_valuecheck.mjs` — `--union-convergence-proof` 모드(前/後 결정적 증명, PARTIAL 유지).
  - `docs/REDPAY-ALLOWLIST-RUNTIME-LOCI.md` — 허용목록 런타임 판독 지점 전수 지도 + D 미계측 표면(PARTIAL 유지).
  - `evidence/…_bidir_census.md` · `…_bidir_amounts.json` — 라이브 census(금액) evidence.

## 종합
- **Axis B(선착수)**: census 를 양방향+실목록+**금액** 기준으로 격상. 정방향 forward-db-only=0(₩0) + 역방향
  **foot-silent-drop=1(net ₩0)** → **매출 silent-drop 금액 0 = "지금 매출 빠지는 중 아님"** 확정. cross-center 24종
  ₩74.3M 는 전부 타센터(정상 부재). foot-silent-drop 1건(1047479158, ₩0)은 DB 캡처 갭 → planner FOLLOWUP.
- **Axis A(후속)**: 허용목록 런타임 판독 지점 **전수 확정(4)** + **미계측 표면 D 발견** + union 前/後 divergence
  **결정적 증명(3→0)**. poller·watchdog 각각 런타임 실 로드값(count+SHA256+정렬목록) 덤프·1:1 대조 = valuecheck 담당.
- **Axis C**: 확인 순서 B→A 확정 반영. **Axis D**: 비대상(WEBHOOK-LATENCY-REMEASURE).
- 전 축 read-only·SSOT 무접촉·additive. 부모/자매 verification deliverable 로 fold(중복 배포물 0).
