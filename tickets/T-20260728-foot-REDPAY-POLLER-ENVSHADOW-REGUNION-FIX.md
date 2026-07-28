---
id: T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: "ef_only — scripts/redpay_macstudio_poller.mjs --self-test (24/24 PASS; 신규 union 5-case + foot-scope 보존 1-case 포함. 폴러=macstudio launchd, FE E2E 무관 → self-test 대체)"
summary: "레드페이 폴러 resolveWhitelists() env-shadow RC 근본봉인 + 8-loci env catch-up. RC(236-FALSENEG): 구 resolveWhitelists()는 env override(merchant+tid 양쪽 설정) 시 DB registry(SSOT)를 완전 shadow(early-return, DB 미조회) → env 가 stale 이면 registry 에 이미 배포된 TID(231/235/236/237/241/245 등)가 tidWhitelist 에 미로드 → filterToFootScope 가 '미등록 신 TID'로 drift 오탐(236류 false drift alarm). [AC-2 구조] merchant(admit 권위·매출 안전)=env override 우선 무변경(union 미적용 → admit surface 불변·cross-tenant 미확대), TID(belt-and-suspenders·drift 표면화·admit 아님)=env ∪ registry(SSOT) UNION. reg=null(DB 미가용)=env/DEFAULT fail-safe. 순수 함수 resolveWhitelistSources() 추출 → self-test 대상화. [AC-1 즉효] ~/.env.redpay-foot REDPAY_TID_WHITELIST 에 이미-배포 538 TID 6종(231/235/236/237/241/245) 추가(239/246 제외 — 0728GAP 8-loci 동기 소유). ADDITIVE·no-DDL·no-data. merchant admit 경로 무변경."
created: 2026-07-28
reporter: planner
parent: T-20260726-foot-REDPAY-CLOSING-236-FALSENEG
commit: PENDING_SUPERVISOR_MERGE
risk_verdict: GO
risk_reason: "변경 격리 = scripts/redpay_macstudio_poller.mjs 1파일(FE·DB·EF 무접촉) + tickets/*.md. ADDITIVE — merchant admit 판정(filterToFootScope, merchant_id 권위)은 코드·데이터 전부 무변경 → 적재/매출 정확도 회귀 0. 구 early-return(양쪽 env → DB 미조회) 제거해 registry 를 항상 조회하나, loadRegistryFromDb 는 try/catch → 실패 시 null 반환 → initializer(env/DEFAULT) fail-safe 유지(정전/네트워크 생존 무회귀). TID union 은 belt-and-suspenders·drift 표면화 surface 만 확장(admit 아님) → 매출 무영향. registry 조회는 domain=eq.foot 필터 → foot-scoped only → cross-tenant admit surface 미확대(457/511 shared registry 무오염). db-change=false(신규 컬럼·테이블·enum 0 → DA CONSULT 불요). 대표 게이트 면제(planner spinoff 결정문). --self-test 24/24 PASS(union env-only/registry-only/양쪽/dedup + foot-scope 보존 오탐0 재현). supervisor 게이트만."
option_decision: "AC-2 구조안 채택 — merchant admit 무변경(union 미적용) + TID-only union. AC-3 cross-tenant 확대검사 통과(admit=merchant_id 불변, registry domain=foot 필터) → DA CONSULT fail-safe 미트립."
---

# T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX

부모 T-20260726-foot-REDPAY-CLOSING-236-FALSENEG AC-3 RC spinoff.
진단 MSG-20260728-163458-dytm 확정 RC의 별건 fix.

## RC (236-FALSENEG)
구 `resolveWhitelists()`(L268 경로)는 env override 가 **merchant+tid 양쪽** 설정되어 있으면
`if (envMerchant && envTid) { ...; return; }` 로 **DB registry(SSOT) 를 조회하지 않고 early-return**했다.
→ env(`~/.env.redpay-foot` `REDPAY_TID_WHITELIST`)가 stale 하면 registry 에 이미 배포·등록된
TID(538 band: 231/235/236/237/241/245 등)가 `tidWhitelist` 에 로드되지 않음
→ `filterToFootScope` 가 해당 TID 를 `merchantOk && !tidOk` = **drift(미등록 신 TID)** 로 오판
→ 236류 false drift alarm(오탐).

## AC-1 — 8-loci env catch-up (즉효, supervisor prod-apply)
`~/.env.redpay-foot` `REDPAY_TID_WHITELIST` 에 이미-배포 538 TID **6종 추가**:

| merchant 별칭 | 신 TID(538 band) | 배포경위 |
|---|---|---|
| 231 | `1047538231` | 0724GAP deployed |
| 235 | `1047538235` | 0725GAP deployed |
| 236 | `1047538236` | 0724GAP deployed |
| 237 | `1047538237` | 0724GAP deployed |
| 241 | `1047538241` | 0724GAP deployed |
| 245 | `1047538245` | 0725GAP deployed |

⛔ **`1047538239`(239) / `1047538246`(246) 는 제외** — 0728GAP(registry seed DA-gate 중) 8-loci 동기가 소유. 중복/재정의 금지.

### supervisor 적용용 — 완성된 REDPAY_TID_WHITELIST 라인 (~/.env.redpay-foot L6 교체)
현 env(538xxx 0건 = stale 확증)에 6종 append:

```
REDPAY_TID_WHITELIST="1047479255,1047479254,1047479261,1047479268,1047479262,1047479263,1047479264,1047479469,1047479471,1047479472,1047479473,1047479474,1047479475,1047479483,1047479476,1047479477,1047479478,1047479479,1047479480,1047479481,1047479482,1047479153,1047479148,1047479155,1047479158,1047479157,1047535845,1047535843,1047535842,1047535837,1047535835,1047535797,1047538231,1047538235,1047538236,1047538237,1047538241,1047538245"
```

(REDPAY_MERCHANT_WHITELIST L9 = 무변경. env merchant 이미 완전 → admit 경로 불변.)

## AC-2 — 구조·근본봉인 (코드, 본 커밋)
`resolveWhitelistSources()`(순수·self-test 대상) 추출 + `resolveWhitelists()` 재작성:
- **merchant(admit 권위, 매출 안전)**: env override 우선 **무변경**(union 미적용) → admit surface 불변.
- **TID(belt-and-suspenders·drift 표면화, admit 아님)**: `env ∪ registry(SSOT)` **UNION** → env stale 여도 registry TID 항상 포함 → 오탐 봉인.
- **reg=null(DB 미가용)**: initializer(env/DEFAULT) 유지 → fail-safe.
- 구 `if (envMerchant && envTid) return;` **shadow early-return 제거** → registry 항상 조회(TID union 위함).

※ AC-2 만으로도 registry 가 SSOT TID(538)를 이미 보유하므로 오탐이 구조적으로 봉인됨. AC-1(env catch-up)은 belt-and-suspenders(8-loci 정합).

## AC-3 — 검증 (evidence)
`scripts/redpay_macstudio_poller.mjs --self-test` **24/24 PASS**:
- union env-only(reg=null fail-safe) / registry-only(env 없음, 종전 semantic) / 양쪽(stale env + registry) / 겹침 dedup 4-case.
- **foot-scope 보존**: registry TID union → 구 오탐되던 236류 TID 가 `selectRealtimeTidAlarms`=0건(오탐 재발0). admit=merchant_id 권위 무변경 evidence.
- **cross-tenant admit surface 미확대**: merchant admit union 미적용(env override 무변경) + registry 조회 `domain=eq.foot` 필터 → 457/511 shared registry 무오염 → **union 이 admit surface 를 넓히지 않음** → DA CONSULT fail-safe **미트립**(db_change=false·DA 불요·대표게이트 면제).

## 게이트
dev-foot → deploy-ready(본) → **supervisor**:
1. 코드리뷰 no-DDL·no-data 확인
2. env 8-loci audit(239/246 제외 확인)
3. prod env apply(위 AC-1 라인)
4. poller 재기동(launchd `com.obliv.foot.redpay-macstudio-poller`)
5. 236류 drift 오탐 재발0 재확인
