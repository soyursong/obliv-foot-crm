# T-20260806-derm-REDPAY-MONITOR-ISOLATED-PIPE — census(L vs W) + Q4 fail-closed guard evidence

- **assignee**: dev-foot (BLOCKER-2 재라우팅, poller repo=obliv-foot-crm-redpay-poller/FOOT)
- **정본(SSOT)**: `agents/docs/da_replies/da_decision_derm_redpay_monitor_xcenter_isolated_pipe_20260806.md` (DA, commit c789d93ad7f · §CONSULT-2 RESOLUTION)
- **change-class**: ADDITIVE / no-DDL / §3.1 CEO 게이트 면제 YES(Q4 guard 강제 조건부)
- **date**: 2026-08-07

---

## 1. 착수 1순위 — 경로 census (L vs W) : **경로 L (READ-ONLY recon) 확정**

DA Q1 이 dev census(monitoring scope)에 위임한 판정. 코드 실측으로 **경로 L** 확정.

### 근거 사슬 (전부 실측)
1. **derm CRM landing-write = 0** (dev-derm 인계 자산): `obliv-derm-crm` 전수 grep(redpay/band/watchdog/1777277~1777281)=0건 → derm CRM 측 오염 벡터 구조적 부재.
2. **write-path 폴러가 derm 를 구조적으로 이미 fail-closed**: `redpay_macstudio_poller.mjs` `runPoller()` 는 raw 를 `clinics`(foot slug jongno-foot/songdo-foot) 테이블에 upsert 하는데,
   - derm 는 `DOMAIN_CLINIC_SLUG_DEFAULTS` 에 entry 없음 → `REDPAY_CLINIC_SLUG=""` → business_no 폴백 → foot clinic 해석 →
   - 기존 `isCrossDomainFootWrite(REDPAY_DOMAIN, slug, FOOT_CLINIC_SLUGS)` (L1391) 가 non-foot→foot-clinic 을 **skip(fail-closed)** → derm write 이미 구조적 차단.
3. **watchdog 는 이미 non-foot 센터를 read-only 로 취급**: `redpay_terminal_watchdog.mjs` ② = "가맹점명 '풋' → 슬랙 긴급 / **타 센터명(도수/피부) → 정보성 로그(저소음)**", `redpay_raw_transactions` 에 write 하지 않음(db_change=false). 피부(derm) 확장 대비 read-only 브랜치가 이미 존재.
4. **monitoring 실need = feed↔registry↔payments 대사**(누락·이상거래 감지), landing-write 아님. 오염 벡터(잘못된 write-target)가 **구조적으로 부재** → DA Q1 정의상 **경로 L**.

### 함의
- body full-build(전용 landing 테이블/slug/band) **불요**.
- 경로 L 잔여 landing 자산 = ① registry `domain='derm'` seed(데이터 INSERT, no-DDL) ② derm-scoped recon probe(`~/ops/etl/recon/`) ③ Q4 fail-closed guard(본 커밋에서 구현·아래 §3).
- ①②는 **live RedPay feed census(A10 seed-authority-gate: guess band 금지) + prod registry INSERT(증적 동반)** 필요 → 아래 §4 잔여 landing 로 분리(운영/게이트 단계). guessed band seed 미커밋.

---

## 2. DA verify-gate (a) — registry `domain` free-text 재확인

- `supabase/migrations/20260711140000_redpay_terminal_registry_ssot.sql` L34: `domain text NOT NULL` — **CHECK 없음·enum 아님**. 주석 L34 = `foot | body | derm | longre`, L29 = "향후 도수/피부/롱레 seed 흡수 가능"(cross-domain designed-for).
- body seed 이미 다중값 실증(`domain='body'` 14-band DEFAULT + registry). ⇒ `domain='derm'` seed = **순수 데이터 INSERT·CHECK-widen 아님·enum ADD VALUE 아님·롤백=derm행 DELETE**.
- ⚠ prod out-of-band CHECK 추가 여부 최종 재확인 = supervisor DDL-diff 항목(마이그 소스는 free-text 확정).

---

## 3. Q4 fail-closed guard 구현 (HARD 선결 · §3.1 면제의 load-bearing precondition)

DA §Q4(L72-77) domain-consistency assertion 구현. **본 커밋의 핵심 산출.**

### 봉인 대상 RC (live 재현됨)
`MERCHANT_DEFAULT_FOR_DOMAIN = (DOMAIN_MERCHANT_DEFAULTS[REDPAY_DOMAIN] ?? FOOT_MERCHANT_WHITELIST_DEFAULT)` 의 `?? FOOT_...` 폴백 →
`REDPAY_DOMAIN=derm` 기동 시 registry derm 미seed + 도메인 env 없음 + 자기 DEFAULT 없음 → **foot band(merchant=27) 를 silent 로드** = derm 감시가 foot 명단으로 오작동 = DA-20260729 DOSU-CONTAM(+₩4.7M) 동일 사고 클래스.

### 구현
- 순수 술어 `detectDomainMerchantFallback({domain, hasOwnMerchantDefault, merchantResolveSource, envMerchant})` (self-test 대상).
- `main()` 에서 `resolveWhitelists()` 직후 평가 → mismatch(foot 폴백) 시 **loud startup abort `process.exit(3)`** (write 0·파괴 없음). silent wrong-fallback → loud abort.
- **일반화**: resolved merchant band 의 domain == REDPAY_DOMAIN. registry 실 로드 / 도메인 env override / 자기 DEFAULT 중 하나라도 있으면 정합, 셋 다 없으면 foot 폴백 = abort.

### foot/body 무접촉 (순수 ADDITIVE) — 회귀 실증
- **foot**: 네이티브 도메인 → 술어 즉시 null. 라이브 `--introspect-whitelist` exit=0, abort 없음(registry domain=foot merchant=27 정상 로드).
- **body**: `DOMAIN_MERCHANT_DEFAULTS` 자기 entry 보유 → 술어 null. (body→foot-clinic slug 오염은 기존 `isCrossDomainFootWrite` 가 별도 봉인 — 본 guard 는 band 축만 추가.)
- **derm**: 미구성 → 술어 mismatch → abort.

### 검증 결과
| 검증 | 결과 |
|------|------|
| `node --check` | SYNTAX OK |
| `--self-test` (network 無) | 전체 통과 (domain-guard A~F 6종 + xdomain-guard 6종 + 기존 전체) |
| live `REDPAY_DOMAIN=derm` 기동 | **exit=3 abort** — `[DOMAIN-CONSISTENCY-GUARD] domain=derm ... foot DEFAULT 로 silent-폴백 ... 기동 abort`. write 0. |
| live `REDPAY_DOMAIN=foot --introspect-whitelist` | **exit=0**, abort 없음(회귀 clean, foot registry 정상 로드) |

supervisor code-review 검증항목 = fail-closed guard 실재 assert → 본 술어 + main() 호출 + exit(3) + self-test A(derm abort)·D(foot 허용)·E(body 허용)로 assert 가능.

---

## 4. 잔여 landing (경로 L) — 운영/게이트 단계 (본 커밋 범위 밖 · guessed seed 미커밋)

DA A10 seed-authority-gate(guess band 금지) 준수 — 아래는 live RedPay feed census + prod write 증적 동반 필요:
1. **derm band feed-authority census**: RedPay 정본 GET, merchant-name `오블리브-서울오리진점 피부(...)` 필터 → exact merchant_id set + active/inactive + TID full. band anchor `1777277 / 1777279 / 1777280 / 1777281*`(열거형·278 skip) = 시작 가설/교차확인 anchor(full census 대체 아님).
2. **registry `domain='derm'` seed**: census 결과로 순수 INSERT(멱등 ON CONFLICT(merchant_id)). 롤백 = derm행 DELETE. 이 seed 착지 시 §3 guard 가 자동으로 derm 기동 허용(registry 소스) → guard 는 seed 강제 장치이자 belt-and-suspenders.
3. **derm-scoped recon probe**(`~/ops/etl/recon/`, A11/A12 derm arm): feed[derm band] vs registry[domain='derm'] vs derm CRM payments read-only 대사.

### 재-CONSULT 트리거 (census 중 발생 시 DA 재-CONSULT)
- derm band feed census 가 foot band 와 overlap(exact merchant_id 충돌)
- 'doAI reference' 가 RedPay feed 아닌 별도 authoritative source 의도
- 경로 W + derm landing 이 cross-fork 공유 계약자산·원장 축 접촉
- 신규 anon surface·PHI-egress 도입
