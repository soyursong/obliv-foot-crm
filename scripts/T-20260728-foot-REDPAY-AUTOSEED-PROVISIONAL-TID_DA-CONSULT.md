# DA CONSULT (1차 게이트) — T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID

**from**: dev-foot · **to**: data-architect · **priority**: P1
**ticket**: T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID (approved, db_change=true, da_consult_required=true)
**registry canon**: redpay_foot_terminal_registry.md §10 (DA-owned SSOT)
**gate**: 본 CONSULT = 티켓 1차 게이트. DA GO(ADDITIVE) 前 dev-foot 착수 금지(§5 금지·autonomy §3.1). 코드/마이그 미착수, 본 판정 요청만 발행.

---

## 0. 요청 요약 (최필경 총괄, ch C0ATE5P6JTH)

기등록 active foot merchant 아래에서 **신 TID 거래 감지 시** → registry에 `provisional=true`로 자동 seed + 슬랙 사후알림("가맹점 [name] 아래 신 TID [xxx] 자동 등록됨, 오탐이면 비활성 처리"). 목표 = 0723/0724/0725/0728 **수동 seed 루프 종식**(매 세대 dev-foot가 CONSULT→superseded-remap 마이그를 수동 발행). 신규/미등록 merchant는 기존 fail-closed + `[UNCLASSIFIED-MERCHANT]` warn 유지(자동 seed 금지, cross-tenant 격리).

## 1. 코드 실측 — 판정을 가르는 핵심 발견 (deployed 스키마 vs 티켓 "INSERT" 표현의 충돌)

READ-ONLY로 poller(`scripts/redpay_macstudio_poller.mjs`) + 마이그(`20260711140000_..._ssot.sql`, `20260724170000_..._optbprime.sql`, `20260728170000_..._0728gap_remap.sql`) 실측:

1. **registry 제약 = `UNIQUE(merchant_id)` (`redpay_terminal_registry_merchant_uk`)** — merchant당 정확히 1행. `superseded_tids text[]`는 Opt-B′(20260724170000)로 旣배포. 소비뷰 tid-membership = `tid ∪ unnest(superseded_tids)` UNION.
2. **`provisional` 컬럼 없음** (현 컬럼: id·clinic_id·domain·merchant_id·tid·terminal_label·active·source·verified_at·created_at·updated_at·superseded_tids).
3. **write = service_role 전용** (RLS: authenticated read-all / write는 service_role). 폴러는 이미 `SERVICE_ROLE_KEY`로 raw upsert 中 → registry write 경로 물리적 가능.
4. **★핵심 충돌**: 자동 seed 트리거(AC-1) = "merchant ∈ registry(domain=foot,active) **AND** 그 TID 미등록". 이 트리거가 발화하는 merchant는 **정의상 이미 registry 행 보유**(UNIQUE per merchant). 따라서 티켓 문구 "provisional=true로 **1행 자동 INSERT**"를 문자 그대로 실행하면 → `ON CONFLICT(merchant_id) DO NOTHING` = **no-op silent-fail** (cross_crm_write_rowcheck_standard 위반 지문, §9.4/§11.2에서 이미 지적된 함정).
5. **∴ 자동화 대상인 "수동 seed 루프"의 실체 = superseded-remap UPDATE** (tid=신, 구 tid→superseded_tids append), plain INSERT 아님. 0723/0724/0725/0728 GAP 마이그가 전부 UPDATE-remap이었음(§9.4/§11.2 verbatim). 즉 이 티켓은 **"매 세대 수동 발행하던 remap-UPDATE 마이그를 폴러 런타임이 자동 수행 + provisional 표식"**으로 재해석되어야 함.
6. **순수 신규 merchant(레지스트리 부재) 경우 = 트리거 대상 아님** (AC-3 fail-closed). 즉 자동 seed는 항상 remap-UPDATE 케이스이고, plain-INSERT-신규행 케이스는 구조적으로 발생 안 함(신규 merchant는 [UNCLASSIFIED] warn만).

## 2. 판정 요청 (Q1~Q3 + AC-6/7 semantic)

### Q1 — provisional 스키마 canon (ADDITIVE)
`provisional` 상태 표현을 어떤 스키마로 canon화? 후보:

- **W1 (권고, ADDITIVE-min)**: 기존 1행/merchant 모델 유지. `provisional boolean NOT NULL DEFAULT false` + seed 메타(`seed_source text`, `seed_at timestamptz`, 예: source='poller-autoseed') 컬럼 ADDITIVE 추가. 자동 seed = **remap-UPDATE**가 `provisional=true` + 메타를 함께 set. `active`는 **true 유지**(뷰 UNION 소급표면화 위해 필수) → provisional은 `active`와 직교한 "자동수집·사람검토 대기" 표식일 뿐 집계 제외 아님(AC-6 정합). `UNIQUE(merchant_id)`·`ON CONFLICT(merchant_id)`·PK·RLS 무접촉 → §3.1 ADDITIVE, supervisor DDL-diff만.
- **W2 (파괴적, 게이트 유발)**: (merchant,tid) 당 별도 provisional 행 → `DROP UNIQUE(merchant_id)` 필요 = §3.1 열거 파괴("UNIQUE 제거"). §8.3 Opt-B가 정확히 이 이유로 REJECT/CEO 게이트 판정. → dev-foot는 W2를 자율 채택 불가.

요청: W1 canon 승인 여부 + 컬럼명/타입/기본값 확정. superseded_tids·active와의 상호작용, 뷰 tid-membership 소급표면화 무붕괴 확인. (W2 선호 시 CEO 게이트 필요 판정.)

### Q2 — 자동-write 모델 canon (신규 write 경로)
- 폴러 런타임이 registry(DA-owned SSOT)에 **remap-UPDATE(provisional=true)** 수행하는 신규 write 경로 승인 여부.
- 트리거 predicate canon 확인: `merchant_id ∈ registry(domain='foot' AND active=true) DISTINCT set` (exact merchant-keyed, **band-prefix 금지** — §10.2) **AND** `extractTid(COALESCE(col_tid,data.tid)) ∉ (tid ∪ superseded_tids)`. (현 폴러 `allDriftItems`/`selectRealtimeTidAlarms` 재사용 — 이미 이 조건으로 drift 계산 中.)
- mechanic canon: superseded-remap UPDATE (tid=신 + 구 tid를 `superseded_tids` DISTINCT append, `e<>new_tid` 가드 = 멱등). §11.2 verbatim.
- **멱등(AC-2)**: 같은 신 TID가 여러 폴링 사이클(300s) 재감지 시 → 재실행 시 tid 이미=신 TID → superseded append no-op → 중복 0. 확인.
- **race(AC-2)**: 폴러 단일 인스턴스(launchd 300s, 중첩 없음 전제) + 동일 사이클 내 다중 페이지 중복 TID → dedup. remap-UPDATE는 rows-affected 검증(GET DIAGNOSTICS 또는 REST `Prefer: return=representation` count)으로 DID-IT-PERSIST 확증 권고 — DA가 요구하는 검증 강도?
- write 경로 형태 canon: (a) 폴러가 REST PATCH(service_role)로 직접 UPDATE vs (b) SECURITY DEFINER RPC(`fn_redpay_autoseed_remap`)로 atomic rows-affected assert. DA 선호?

### Q3 — cross-tenant 격리 불변식
- 자동 seed = **기등록 active foot merchant 아래 TID 한정**. 신규/미등록 merchant → fail-closed + `[UNCLASSIFIED-MERCHANT]` warn 유지, 자동 seed **금지**. (§10.2 3중 격리 — bizno scope + exact merchant set + fail-closed 계승.)
- obliv-origin 공유법인(457-23-00938) 내 도수(1777274-276*)/피부(1777277/279-281*)/롱레(1777282/284*) merchant_id는 foot set 밖 → 자동 seed 표면 **0** 확인.
- A11 일일 정합감사(§11.7, `redpay_registry_reconcile_probe.py`)·`v_redpay_unclassified_merchants`와 write 경로 정합: 자동 seed가 NEW-TID DRIFT를 런타임 해소하면 A11이 즉시 covered로 resolve 예상 — 정합 확인. POLLER-ENVSHADOW-REGUNION(approved, resolveWhitelists union)와 write 대상(registry SSOT) 정합 확인.

### AC-6 / AC-7 semantic (W1 채택 시 확정 필요)
- **AC-6 (매출 산식 무접촉)**: provisional=true 행의 TID 매출도 정식 TID와 동일 집계(active=true 유지 → 뷰 UNION 그대로). provisional은 집계 필터에 미개입 = 순수 검토표식. 확정?
- **AC-7 (오탐 되돌림)**: ★semantic 결정 필요. 오탐(신 TID가 실제로 타 tenant/merchant 소속인 잘못된 remap)의 되돌림 경로 =
  - (a) `active=false`? → **merchant 행 전체(구 legit historical 포함) 비활성** = 과잉. remap 모델에서 부적합.
  - (b) **remap 역전**(tid←구 superseded 복원 + 신 TID를 superseded에서 제거, = 0728gap.rollback.sql 패턴)? → 정확한 되돌림.
  - dev-foot 권고 = (b). DA canon 요청. (티켓 문구 "비활성 처리"는 (a)를 시사하나 remap 모델과 불정합 → DA 확정 필요.)

## 3. 게이트·후속
- DA GO(ADDITIVE·W1) 수신 → dev-foot: MIG-GATE 5필드(provisional/seed-meta 컬럼 마이그 + dryrun no-persist + post-probe + ledger + rollback) 채움 → 폴러 자동-seed(remap-UPDATE+provisional) 구현 + self-test 확장(멱등·race·cross-tenant) → supervisor DDL-diff+evidence → deploy-ready → soak(§Fold-in 4 merchant 코호트 실측).
- DA가 (a) W2 선호/파괴변경 또는 (b) cross-product 충돌 판정 時에만 대표 게이트 승격(autonomy §3.1). ADDITIVE+W1 GO면 대표 미게이트.
- e2e = ef_only(폴러 백엔드 self-test, UI 클릭 없음).

**dev-foot 상태**: 코드/마이그 미착수. 본 CONSULT 판정 대기 中.
