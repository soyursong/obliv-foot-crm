# RedPay 허용목록(allowlist) 런타임 판독 지점 전수 지도 (Runtime Loci Map)

**티켓**: T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN (Axis A item2) — 총괄 최필경(C0ATE5P6JTH) 검증방법 강화 req.
**성격**: read-only 코드/launchd 실측 문서. db_change=false · no-DDL · no-data. 별도 배포물 아님 — 부모
  T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX / T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK
  의 verification deliverable 로 fold.
**생성**: 2026-07-29 (KST). 근거 = 코드 grep 실측(추측대입 금지).

---

## 0. 왜 이 문서가 필요한가 (총괄 req 정합)

총괄 req: **"'수집 EF/워치독 EF' 용어를 실제 런타임 컴포넌트로 매핑 + allowlist 를 런타임에 읽는 모든 지점 덤프."**
env-shadow 는 정적 코드대조로 안 잡힌다(컴포넌트별 배포·기동 → 런타임 env divergence). 대조가 유효하려면
**"허용목록을 읽는 실행주체를 하나도 빠짐없이" 열거**해야 하며, 한 지점이라도 누락하면 그 지점의 stale env 가
침묵 미탐(silent env-shadow)으로 남는다. 본 문서는 loose 용어("수집 EF"·"워치독 EF")를 실 컴포넌트로 확정하고,
**허용목록을 런타임에 읽는 전 지점을 전수 열거**한다.

---

## 1. 용어 매핑 (loose term → 실 런타임 컴포넌트)

| 문서/MQ 용어 | 실 런타임 컴포넌트 | 파일 |
|---|---|---|
| "수집 EF" / "수집" / "폴러" | **poller** (macstudio launchd 프로세스, EF 아님) | `scripts/redpay_macstudio_poller.mjs` |
| "워치독 EF" / "워치독" | **watchdog** (macstudio launchd 프로세스, EF 아님) | `scripts/redpay_terminal_watchdog.mjs` |
| "웹훅 수신 EF" | **redpay-webhook** (Supabase serverless EF) | `supabase/functions/redpay-webhook/index.ts` |
| "대사 EF" / "reconcile" | **redpay-reconcile** (Supabase serverless EF) | `supabase/functions/redpay-reconcile/index.ts` |

> ⚠ "수집 EF / 워치독 EF" 는 통칭일 뿐 실제로는 **EF 가 아니라 macstudio launchd .mjs 프로세스**다.
> `~/.redpay-watchdog-foot-state.json` 은 **워치독의 dedup 상태파일**이며 **허용목록 소스가 아니다**(§3 참조).

---

## 2. 허용목록을 런타임에 읽는 전 지점 (전수)

| # | 실행주체 | 기동/배포 단위 | merchant 허용목록 소스 | TID 허용목록 소스 | env-shadow 노출 | 런타임 지문 덤프 |
|---|---|---|---|---|---|---|
| A | **poller** | macstudio launchd `com.obliv.foot.redpay-macstudio-poller` | env `REDPAY_MERCHANT_WHITELIST` override 우선 → registry | **env `REDPAY_TID_WHITELIST` ∪ registry** (REGUNION-FIX) | ★있음(env) — 단 TID union 으로 봉인 | ✅ `--introspect-whitelist` |
| B | **watchdog** | macstudio launchd `com.obliv.foot.redpay-terminal-watchdog` | registry(active) | registry membership `tid ∪ unnest(superseded_tids)` | 없음(registry-only) | ✅ `--introspect-whitelist` |
| C | **redpay-webhook EF** | Supabase serverless (별도 배포·콜드스타트) | 정적 모듈 `_shared/redpay-foot-merchants.ts` `FOOT_MERCHANT_SET` | (TID 미사용 — merchant 판정만) | code-deploy-shadow 만(env 아님) | ✅ authed GET `?introspect=whitelist` |
| D | **redpay-reconcile EF** | Supabase serverless (별도 배포·콜드스타트) | 정적 모듈 `scope-filter.ts` `FOOT_MERCHANT_SET`(=C 미러) | **env `Deno.env REDPAY_TID_WHITELIST`** (index.ts L94/L280) | ★있음(env) — **현행 미계측** | ❌ **introspection 라우트 없음** |

실측 근거(grep):
- A: `scripts/redpay_macstudio_poller.mjs` `resolveWhitelistSources()` (env∪registry union) + `--introspect-whitelist` emit.
- B: `scripts/redpay_terminal_watchdog.mjs` `loadRegistry()` `buildMembershipTids()` + `--introspect-whitelist` emit.
- C: `supabase/functions/redpay-webhook/index.ts` L153-162 authed introspection + `_shared/redpay-foot-merchants.ts`.
- D: `supabase/functions/redpay-reconcile/index.ts` L94 `Deno.env.get("REDPAY_TID_WHITELIST")`, L280 split → TID set. merchant = `scope-filter.ts` `FOOT_MERCHANT_SET`.

---

## 3. 허용목록 소스가 **아닌** 인접 상태 (오분류 방지)

전수성 주장을 위해, 허용목록처럼 보이지만 소스가 아닌 지점을 명시 배제한다:

| 지점 | 실제 역할 | 허용목록 소스 아님 근거 |
|---|---|---|
| `~/.redpay-watchdog-foot-state.json` (`STATE_PATH`) | 워치독 **dedup 알림 상태**(alerted_merchants / alerted_tids) | watchdog L451-468 `loadState/saveState` — 알림 중복억제용. 허용목록 판정에 미투입(허용목록은 §2-B registry). |
| `redpay_poller_state` (singleton id=1) | poller **incremental 윈도 heartbeat** | poller 윈도 슬라이딩 from 계산용. 허용목록 아님. |
| `redpay_raw_transactions` | 적재 원장(raw) | 대사/raw-presence 조회 대상. 허용목록 판정 소스 아님. |

---

## 4. 완결성 판정 + 신규 발견 (완전성 비평)

- **A·B·C 는 런타임 실 로드값 지문(count+정렬목록+SHA256) 을 각각 덤프** → `scripts/redpay_envshadow_valuecheck.mjs`
  로 1:1 대조. 이 3자 대조는 T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK evidence §2-3 에서 완료
  (NO_ENV_SHADOW, 두 주체 실값 완전 일치).
- **★ 신규 발견(D)**: **redpay-reconcile EF 도 `REDPAY_TID_WHITELIST` 를 env 에서 읽는다**(index.ts L94/L280).
  기존 런타임 valuecheck 토폴로지(A/B/C)는 이 지점을 **누락**했다 → D 의 stale env 는 **현재 미계측 env-shadow 표면**.
  - 완화 정황: reconcile EF 는 기본 `REDPAY_DRY_RUN=true`(index.ts 헤더 G5 launchd hard-lock) → 실 API 호출/적재
    차단 posture. 라이브 ingest 정본은 macstudio poller(A). 따라서 D 의 env-shadow 는 현행 **inert 가능성 높음**.
  - merchant 축은 D 도 정적 `FOOT_MERCHANT_SET`(=C 미러, `scope-filter.regress.test.ts` drift-assert 봉인) → env-shadow 불가.
    노출은 **TID env 축에 한정**.
- **권고(folded follow-up, 본 티켓 additive 범위 밖 코드변경 회피)**: D 에 webhook EF(C)와 동일한 authed GET
  `?introspect=whitelist` 라우트를 미러 추가 → valuecheck `--ef` 4주체 대조로 격상. admit(filterToFootScope)·
  적재 로직 **무접촉**(read-only introspection 라우트만). D 의 실 배포/활성 여부는 supervisor env 실측 후 확정.

> 본 티켓(P2 verification-method-harden)은 admit·registry SSOT 무접촉 규약을 지키기 위해 D 코드변경을 하지 않고
> **loci 전수 지도 + 미계측 표면(D) 명시**로 완결성을 닫는다. D introspection 추가는 별도 티켓/supervisor 게이트.

---

## 5. 요약

- 용어 확정: 수집=poller(.mjs), 워치독=watchdog(.mjs), 둘 다 EF 아님(macstudio launchd). 웹훅 EF·대사 EF 만 실제 serverless.
- 허용목록 런타임 판독 지점 = **4개(A poller / B watchdog / C webhook EF / D reconcile EF)**.
- env 를 읽어 env-shadow 노출 = **A(TID, union 봉인) · D(TID, 미계측·DRY_RUN inert 추정)**. B·C 는 env 무관(registry/정적).
- 상태파일 `~/.redpay-watchdog-foot-state.json` = dedup 상태 ≠ 허용목록(오분류 방지 명시).
- A·B·C 3자 실값 대조 = NO_ENV_SHADOW 완료. **D = 신규 미계측 표면 → folded follow-up 권고**.
