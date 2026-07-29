# T-20260724-foot-REDPAY-DOSU-CONTAM-FIX — 파트A 실효화 evidence

- date: 2026-07-29
- agent: dev-foot
- mode: **파트A only (additive, db_change=false, CEO 게이트 불요)** — 파트B(DELETE)는 CEO 재-consent·supervisor DB-GATE 유지, **미실행**
- project(prod): rxlomoozakkjesdqjtvd (foot). clinic: `jongno-foot`(457-23-00938)
- source of truth: `redpay_raw_transactions`, `payment_reconciliation_log`, launchd, poller runtime log

---

## 1. RC 확정 — 3 가설축 전부 disconfirm, 4번째 축이 진짜 원인

planner NEW-TASK 진단축 (a)/(b)/(c) 실측 결과:

| 가설 | 판정 | 근거 |
|------|------|------|
| (a) 파트A EF(`redpay-reconcile/scope-filter.ts`) prod 미배포 | **disconfirm(무관)** | 실 라이브 적재 경로 = `scripts/redpay_macstudio_poller.mjs`(launchd), reconcile EF 아님. EF scope-filter 배포 여부는 라이브 적재에 무영향 |
| (b) DEDICATED-CHECKOUT stale 체크아웃 구코드 실행 | **disconfirm(별개 hazard)** | 본 leak 과 무관. foot 폴러는 정상 merchant-drop 동작 확증(scoped_out 로그) |
| (c) scope-filter 가 `1777275006`/BODY_MERCHANT_SET 을 drop 대상 누락 | **disconfirm** | foot 폴러 `filterToFootScope` 는 body-band 를 이미 drop(FOOT_MERCHANT_SET 미포함=drop). 문제는 drop 누락이 아님 |

**★진짜 RC (4번째 축):**
- `redpay_macstudio_poller.mjs` 는 `REDPAY_DOMAIN` env-swap 으로 **body(도수) 폴러**로도 재사용됨 (`com.obliv.foot.redpay-macstudio-poller-body.plist`, `REDPAY_DOMAIN=body`, 300s 상주, 2026-07-22 load).
- body 폴러는 body-band merchant(1777274-276, incl. `1777275006`)를 **정상 admit**(자기 도메인 스코프) 후, `REDPAY_CLINIC_SLUG` 기본값이 **foot 과 동일한 `jongno-foot`**(poller L127 `DOMAIN_CLINIC_SLUG_DEFAULTS = { foot: "jongno-foot", body: "jongno-foot" }`, seed 20260714170100)으로 해석되어, body 행을 **풋 clinic 테이블에 upsert**.
- foot reconcile(`runMatcher`)는 center 무관하게 매칭 → body raw 가 foot payment 에 매칭(07-24 +10,000 1건 정산 실침투) + recon_log flapping.
- **merchant-drop(파트A 원설계)이 이 leak 을 못 막는 이유**: body 폴러의 스코프 자체가 body admit(정상 도메인 동작). merchant-drop 은 foot 경로 leak 만 봉인 → body→foot-clinic 적재는 손대지 못함. = "파트A 미발효"의 진짜 원인.

### provenance 실측 (read-only prod probe)
body-band 행이 `clinic_id=jongno-foot` 로 적재된 실측 (07-23~28):

| kst_day | merchant_id | rows | net | 매칭 |
|---------|-------------|------|-----|------|
| 07-23 | 1777276003 (도수무선) | 2 | 0 | net0 (기존 62071914 leak) |
| 07-24 | 1777275006 (도수멀티) | 1 | +10,000 | **1건 foot payment matched** |
| 07-25 | 1777275006 | 3 | +50,150 | 0 |
| 07-27 | 1777275006 | 9 | +126,220 | 0 |
| 07-28 | 1777275006 | 12 | +4,559,200 | 0 |

- 07-24~present 도수 band 순증 = **+₩4,745,570 (non-net-0)** — AC-4.2 실증치와 정합.
- `created_at` cadence(예: 07-28 11:46:35 insert / approved 11:45:01)가 body 폴러 5분 incremental upsert 패턴과 일치 → 적재 주체 = body 폴러 확정.

---

## 2. 파트A 실효화 조치 (additive, db_change=false)

### (i) 코드 가드 — 크로스도메인 적재 봉인 (`scripts/redpay_macstudio_poller.mjs`)
불변식 **"풋 clinic(jongno-foot/songdo-foot)엔 foot-center 행만 landing"** 을 실 write 경계에 강제.
- `isCrossDomainFootWrite(domain, clinicSlug, footClinicSlugs)` 순수 술어 + `FOOT_CLINIC_SLUGS` 상수 추가.
- `pollOnce()` clinic 해석 직후: non-foot 도메인이 풋 clinic 으로 해석되면 **fail-closed**(fetch/필터/upsert 없이 즉시 return, 적재 0, 파괴/삭제 없음).
- DA Q1(ingest-drop GO / downstream REJECT) 판정을 실 write 경계에 그대로 적용 — 신규 정책 아님.
- self-test 6 assertion 추가(body→foot=차단 / foot→foot=허용 회귀가드 / body→전용clinic=허용 / fail-closed slug미지정).

**self-test 결과: 전체 PASS** (기존 + 신규 xdomain-guard 6종 포함).
```
✅ xdomain-guard: body→jongno-foot = 차단(RC: 도수 오염 실 벡터)
✅ xdomain-guard: body→songdo-foot = 차단
✅ xdomain-guard: foot→jongno-foot = 허용(foot 폴러 무영향)
✅ xdomain-guard: body→jongno-dosu(전용) = 허용(분리 후 정상)
✅ xdomain-guard: body+slug미지정 = fail-closed 차단(bizno 폴백=풋 관성)
✅ xdomain-guard: foot+slug미지정 = 허용
[redpay-macstudio][foot] ✅ self-test 전체 통과
```

**런타임 확인**:
- `REDPAY_DOMAIN=body node poller` → `[XDOMAIN-CONTAM-GUARD] domain=body ... target clinic(slug=jongno-foot)=풋 → 적재 skip(fail-closed)`, upsert 없이 exit 0.
- `REDPAY_DOMAIN=foot node poller` → 정상 `fetched=3 upserted=3`, 가드 미발화 = **foot 폴러 무영향(회귀 없음)**.

### (ii) 런타임 정지 — body 폴러 launchd unload (즉시·결정적 live-leak 정지)
코드 가드만으로도 body 폴러 write=0 이 되나, 브랜치-체크아웃 의존성(DEDICATED-CHECKOUT hazard) 제거 위해 결정적 정지 병행:
```
launchctl unload -w ~/Library/LaunchAgents/com.obliv.foot.redpay-macstudio-poller-body.plist   # rc=0
mv .../com.obliv.foot.redpay-macstudio-poller-body.plist{,.disabled-T-20260724-DOSU-CONTAM-FIX} # reversible
launchctl list | grep redpay-macstudio-poller  # → foot 폴러만 잔존, body 사라짐
```
- **foot 폴러(`com.obliv.foot.redpay-macstudio-poller`)는 intact** — 정상 가동 유지.
- 되돌리기: 심링크 복원 + `launchctl load -w` (파괴 없음).

---

## 3. live 누수 정지 검증

| 검증 | 결과 |
|------|------|
| KST 07-29 도수 band(jongno-foot) 순증 | **0행 / ₩0** (post-fix baseline 확립) |
| 최종 body-band insert (freeze cutoff) | 2026-07-28 11:46:35+00 (이후 신규 유입 0) |
| foot 폴러 회귀 | 무영향 (fetched=3 upserted=3, 가드 미발화) |

→ **live 누수(+₩4.7M band) 순증 정지 확인.** body raw 재유입 = 0.

### ⚠ 잔여 — recon_log flapping (파트A 만으로 미해소, 파트B 필요)
- body raw **재유입은 0**(source 정지)이나, **기존 27행(1777275006 25 + 1777276003 2)은 foot 테이블에 잔존**(파트B DELETE=CEO 게이트, 미실행).
- 잔존 27행이 매 reconcile 사이클마다 match_failed↔missing_in_crm **flapping 지속** → body-linked recon_log = **17,593행**(측정 시점), 현재 부분시각에도 계속 증가(11:00 KST 시간대 match_failed 88 + missing_in_crm 144).
- ⇒ **파트A 는 source(신규 유입·live $ 누수)를 정지**하나, **기존 27행의 flapping 은 파트B(27행 DELETE)로만 완전 정지 → 그때 count freeze → CEO 재-consent tractable.** planner §3 게이트 노트(parent DELETE=decisive flapping fix)와 정합.

---

## 4. 파트B 재확정 — band widen 반영 (지문기준 freeze, count-agnostic)

원 leak(approval_no 62071914 / mid 1777276003)보다 **wider**. 07-25 `dosu_contam_delete` 마이그는 `1777275006` 미커버.

**widened 지문 SET (count-agnostic, A안)**:
- `clinic_id = jongno-foot` ∧ `raw_payload->merchant->id ∈ BODY_MERCHANT_SET`
  (= `1777274001`, `1777275001-008`, `1777276001-005`; 실적재는 `1777275006`·`1777276003` 2 merchant)
- 실측(2026-07-29): 27행 (1777275006=25 / 1777276003=2), 전 distinct external_trxid.
- FK-child recon_log = body raw id 기준 17,593행(측정 시점, moving-target) → child-first archive-first DELETE.
- **CEO 재-consent·supervisor DB-GATE 순서는 기존 유지.** 파트A 실효로 source 정지 → 파트B DELETE 후 count 안정화 → CEO 재-consent 는 파트B 실행 시점 지문 재검증(순소실0)으로 처리.
- registry SSOT 무접촉 유지.

> 본 evidence 는 파트A(additive) 종결분. 파트B(DELETE)는 미실행 — CEO 재-consent 게이트 잔존.
