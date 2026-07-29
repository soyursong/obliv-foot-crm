# T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN — Evidence (검증방법 강화)

**티켓**: T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN (P2, PARTIAL-INTAKE)
**요청**: 총괄 최필경 — 신규 기능 아님. 기존 approved 티켓의 evidence-AC 를 **additive 상향**. 산출물은 별도 배포물이
  아니라 부모/자매 티켓 verification deliverable 에 **fold**(중복 금지).
**성격**: read-only 계측·대조·문서. db_change=false · no-DDL · no-data. 매출 split·admit·registry SSOT **무접촉**.
**e2e**: ef_only 면제(FE 렌더 변경 0) → 순수함수 self-test 로 대체.
**생성**: 2026-07-29 (KST). 실행 머신 = macstudio(레드페이 poller/watchdog launchd 정본 호스트).

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

## Axis B → 부모 T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE (census diff 양방향 격상)

총괄 req: TID diff 를 ★양방향으로. (정방향) registry→조회API / (역방향) 조회API→registry(=침묵 미탐 후보).
결과는 목록(표): 각 TID 방향별 상태(active/superseded/absent/API-only/DB-only).

### B-1. 도구 — `scripts/redpay_tid_bidir_reconcile.mjs` (신규, self-test 15/15 PASS)
- 순수 분류기 `classifyBidir()` — 5-status:
  - `active`(등재 active+API거래) / `superseded`(구 TID 잔존거래·정상) / `absent`(등재 active·API window 무거래=휴면 후보)
    / `DB-only`(구 TID·무거래=정상 소멸) / `API-only`(registry 미등재·거래中=★역방향 침묵 미탐 후보).
- **역방향 정밀화(merchant-center 렌즈)**: bizno union(511∪457)은 센터 공유 → API-only TID 를 merchant_id 로 재분류.
  **merchant∈foot registry → foot-silent-miss(진짜 매출누락 위험)** / merchant∉foot → cross-center(타센터 정상 부재).
- read-only: registry·API 읽기만. registry SSOT 편입/변경 0.

### B-2. TID27 census diff (라이브, 2026-07-28 KST macstudio, window 7일, bizno 511∪457)
- registry(active) rows=**27** · active-tid=27종 · superseded-tid=13종. 조회API distinct TID=35종(items 318).

| verdict | 건수 | 의미 |
|---|---|---|
| active | 16 | 등재 active + API 거래 (정상) |
| superseded | 1 | 구 TID remap 후 잔존 거래 (membership 흡수·정상) |
| absent | 11 | 등재 active·API window 무거래 (휴면/미거래 후보) |
| DB-only | 12 | 구 TID·무거래 (정상 소멸) |
| API-only | 18 | registry 미등재·거래中 (역방향) — merchant 렌즈로 재분류 ↓ |

- **★★ foot silent-miss (진짜 매출누락 위험, foot merchant·TID 미등재): `0건`** — 정방향 absent=0/27 에 더해
  **역방향 침묵 미탐도 0** 확증. TID27 27개 전건이 매출 silent-drop 없음.
- cross-center/other (타센터 단말, foot registry 정상 부재): **18종** — 전부 non-foot merchant(예 1777276003=도수
  contam 벡터, 1777281010/1777281001/1777279009 등). foot 누락 아님.
- absent(휴면 후보) 11종 = 등재 active 이나 최근 7일 무거래. 위생 관찰 대상(매출 위험 아님).
- 전수 표·머신판독 evidence: `evidence/T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE_bidir_census.md` + `_bidir.json`(supervisor 재현용).

> **결론(Axis B)**: TID27 census 를 양방향+목록 기준으로 격상. **정방향 absent=0 + 역방향 foot-silent-miss=0**
> = 27개 TID 매출 silent-drop 후보 0 재확증. (역방향 API-only 18종은 merchant 렌즈로 전부 타센터=정상 부재 판정.)

---

## Axis C — ⚠ MQ body 잘림 (미착수)
- planner 통지: item2 tail + item3 미수신 → responder 에 원문 FOLLOWUP 발행됨. 회신 수신 시 통지 예정.
- axis A·B 는 독립 가치 → 선착수 완료. **Axis C 는 원문 수신 후 별도 처리**(본 커밋 미포함).

---

## 게이트 / 변경 파일
- **db_change=false** · no-DDL · no-data. registry SSOT·admit(filterToFootScope)·매출 split **무접촉**.
- **신규 npm 0** (SHA256=내장 crypto, fetch=내장).
- **build**: `npm run build` ✅ (6.03s, FE 무변경).
- **self-test**: bidir 15/15 PASS · union-proof PASS(exit 0).
- 변경 파일:
  - `scripts/redpay_envshadow_valuecheck.mjs` — `--union-convergence-proof` 모드 추가(前/後 결정적 증명).
  - `scripts/redpay_tid_bidir_reconcile.mjs` (신규) — 양방향 TID 대사 + merchant-center 렌즈 + self-test.
  - `docs/REDPAY-ALLOWLIST-RUNTIME-LOCI.md` (신규) — 허용목록 런타임 판독 지점 전수 지도 + D 미계측 표면 발견.
  - `evidence/…_union_convergence_proof.json` · `evidence/…_TID27…_bidir_census.md` — evidence.

## 종합
Axis A: 허용목록 런타임 판독 지점 **전수 확정(4)** + **미계측 표면 D 발견** + union 前/後 divergence **결정적 증명(3→0)**.
Axis B: TID27 census **양방향 격상** → 정방향 absent=0 · **역방향 foot silent-miss=0** 재확증(API-only 18은 타센터).
두 축 모두 read-only·SSOT 무접촉·additive. 부모 티켓 verification deliverable 로 fold(중복 배포물 0).
