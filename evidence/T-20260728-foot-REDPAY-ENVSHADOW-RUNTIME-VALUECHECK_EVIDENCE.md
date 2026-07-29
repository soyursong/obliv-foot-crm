# T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK — Evidence

**티켓**: T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK (P1)
**총괄 req1** (최필경 U05L6HE7QF6, C0ATE5P6JTH thread 1784708681.507149): 정적 코드 대조에 **런타임 실 로드값 대조** 추가.
**성격**: read-only introspection 계측 (db_change=false, no-DDL, no-data-mutation, 신규 npm 0 = SHA256 내장 crypto).
**생성**: 2026-07-28 (KST). 실행 머신 = macstudio (레드페이 poller/watchdog launchd 정본 호스트).

---

## 0. 선행 게이트 (총괄 처리순서 #3)

- 규약: **TID27-REGISTRY-RECONCILE 회신 완료 후 착수** (누락확정 先 → 구조원인확인 後).
- 확인: TID27 진행로그 2026-07-28 19:27 — **AC-1 방향(a) census 완료: absent=0/27** (27개 전건 등재 active20·superseded7, 매출 silent-drop 후보 0건). = "누락확정(TID diff) 先"의 실질 충족.
- 잔여(TID27 AC-5 (b)방향: 타센터 혼입/휴면 위생 sweep)는 env-shadow 축과 **직교** → 본건 read-only 준비·계측·대조 착수 가능. **단 최종 현장 relay 순서는 planner가 TID27 최종회신과 조율**(FOLLOWUP 통지).

---

## 1. 런타임 토폴로지 (실측 확정 — 추측대입 금지)

launchd 등록 + 코드 소스 실측으로 확정한 "허용목록 읽는 실행주체":

| # | 실행주체 | 기동 | 허용목록 소스 | admission/drift 판정 |
|---|----------|------|---------------|----------------------|
| A | **poller** `scripts/redpay_macstudio_poller.mjs` | launchd `com.obliv.foot.redpay-macstudio-poller` | env `REDPAY_TID_WHITELIST` **∪** DB registry (REGUNION-FIX 적용) + merchant env-override | filterToFootScope (merchant_id 권위) |
| B | **watchdog** `scripts/redpay_terminal_watchdog.mjs` | launchd `com.obliv.foot.redpay-terminal-watchdog` | DB registry(active) membership = `tid ∪ unnest(superseded_tids)` (R3 불변식) | 미분류 TID 감지 |
| C | **webhook EF** `supabase/functions/redpay-webhook` | Supabase serverless (push 수신) | 정적 모듈 `_shared/redpay-foot-merchants.ts` (FOOT_MERCHANT_SET, merchant 27-set) | centerForMerchant |

- **핵심 env-shadow 축 = A(env) ↔ B(registry)** — 서로 다른 소스를 읽는 쌍. 236-FALSENEG(closed) 확정 RC = env-override-shadows-registry. 본 대조의 1차 표적.
- C는 정적 git-committed 모듈 → env-shadow 불가(code-deploy-shadow만 가능). 부가 대조로 포함.

---

## 2. AC-1 — 각 주체 런타임 실 로드값 지문 노출 (introspection 계측)

각 주체에 `--introspect-whitelist` 플래그(read-only: 실 로드경로만 태우고 폴링/대사/적재/DB write 미진입) + 기동 `[WL-FINGERPRINT]` 로그 라인 추가. 지문 = **(a) count + (b) 정렬목록 + SHA256** + **소스 라벨**.

- 노출면 = **내부 전용** (CLI 플래그 stdout / launchd 기동 로그). 미인증 공개 표면 0.
- 웹훅 EF = authed GET `?introspect=whitelist` + `Authorization: Bearer <SERVICE_ROLE_KEY>` (미인증 401). 결제 POST 경로와 top early-return 완전 격리.
- 지문 canonical = 공유 모듈 `scripts/lib/redpay_wl_fingerprint.mjs` (양측 동일 알고리즘 강제 = 대조 유효성 불변식). EF는 CANON_SPEC 미러.
- SHA256 = node:crypto / Deno Web Crypto **내장** (신규 npm 0).

### 실측 지문 (2026-07-28 KST, macstudio)

```
[poller]   source(merchant=env-override  tid=env∪registry)                 merchant(count=27 sha256=cc86c311bda6e4b0…)  tid(count=40 sha256=aa74b84d03ddf561…)
[watchdog] source(merchant=registry      tid=registry(membership=tid∪superseded)) merchant(count=27 sha256=cc86c311bda6e4b0…)  tid(count=40 sha256=aa74b84d03ddf561…)
[webhook-ef] 배포 대기 — 현재 배포본은 GET introspect 라우트 미보유(응답 method_not_allowed). 본 커밋 배포 후 대조 가능.
```

- 상세 정렬목록·전체 해시 = `evidence/T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK_ac2ac3.json`.

---

## 3. AC-2 (핵심) — 실값 1:1 대조 + env-shadow 직접 판정

probe `scripts/redpay_envshadow_valuecheck.mjs` 로 poller ↔ watchdog 지문 1:1 대조.

| 축 | poller | watchdog | SHA256 | 판정 |
|----|--------|----------|--------|------|
| TID | 40 | 40 | **일치** (aa74b84d03ddf561…) | ✅ |
| merchant | 27 | 27 | **일치** (cc86c311bda6e4b0…) | ✅ |

- `registry(watchdog) − poller` 누락 TID = **0** (poller stale 없음).
- `poller − watchdog` env-only 잔여 = **0**.

### ▶ env-shadow 판정: **NO_ENV_SHADOW** (env-shadow 없음 **직접 증거**)
두 실행주체가 런타임에 실제 로드한 허용목록이 count·정렬목록·SHA256 **완전 일치**. 코드 대조 '동일'이 런타임에서도 성립함을 실값으로 확증.

### ▶ 매출 silent-drop 위험: **없음**
diff TID 0건 → admit 누락 없음. TID27 census(absent=0/27, 매출 silent-drop 후보 0)와 교차 정합. **P0 승격 대상 아님.**

---

## 4. AC-3 — REGUNION-FIX(env∪DB union) 실효 검증

- REGUNION-FIX 코드(`resolveWhitelistSources`: tid = env∪registry union) origin/main 반영 확인.
- 검증: **registry(watchdog membership) ⊆ poller 로드값** → **성립 ✅**.
- 해석: registry 항목 전건이 poller 로드값에 포함 = union 이 registry TID 를 항상 admit → **구 env 가 registry 를 shadow 하는 silent-drop 경로 봉인 = fix 실효**. 두 주체 실값 수렴 확인.

---

## 5. 게이트 / 리스크

- **db_change=false** — DDL/스키마/데이터 mutation 0. registry/env 읽기만.
- **read-only 불변식**: admission(filterToFootScope) · drift 판정 로직 **무변경**. "읽은 값" 노출만 추가.
- **foot-scope 무붕괴**: merchant_id 권위 admit 경로 무접촉. self-test(poller/watchdog) 전건 PASS.
- **신규 npm 0**: SHA256 = 런타임 내장 crypto.
- **introspection 노출면**: CLI/기동로그(내부) + EF authed GET(Bearer service_role, 미인증 401). 미인증 공개 표면 0.
- **E2E**: ef_only 면제 (사용자 클릭 동선/UI 렌더 변경 0). 검증 = 두 주체 실값 대조 evidence.
- **build**: `npm run build` ✅ (6.26s). **deno check** redpay-webhook ✅.

## 6. 변경 파일

- `scripts/lib/redpay_wl_fingerprint.mjs` (신규) — canonical 지문 모듈.
- `scripts/redpay_macstudio_poller.mjs` — `--introspect-whitelist` + 기동 지문 로그 + 소스 메타 캡처.
- `scripts/redpay_terminal_watchdog.mjs` — `--introspect-whitelist` + 기동 지문 로그.
- `supabase/functions/redpay-webhook/index.ts` — authed GET introspection(격리) + 지문 헬퍼.
- `scripts/redpay_envshadow_valuecheck.mjs` (신규) — 대조 probe.
- `evidence/…_ac2ac3.json` — 대조 원시 evidence.

## 7. 종합

**NO_ENV_SHADOW** (두 주체 실값 완전 일치) · 매출 silent-drop 위험 **없음** · **REGUNION-FIX 실효(수렴)** 확인. 최근 반복된 "이미 등록됐는데 미등록 알림" 우려를 코드가 아닌 **런타임 실값**으로 검증 = env-shadow 부재 직접 증거 확보. 웹훅 EF(Subject C) 실측은 본 커밋 배포 후 `--ef` 로 보강 가능(code-deploy-shadow 부가 확인).
