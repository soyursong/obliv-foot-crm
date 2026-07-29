# T-20260728-foot-REDPAY-WEBHOOK-ALLOWLIST-RUNTIME-ALIGN — A안 evidence

**dev-foot / 2026-07-29 / obliv-foot-crm / redpay-webhook EF**
착수 인가: planner NEW-TASK MSG-20260729-081857-8pb0 (human_pending RESOLVED, 최필경 총괄 MSG-w07j).

---

## 전환방식 선택 — **A안 채택** (런타임 registry 조회), B안 기각

| | A안 (런타임 registry 조회) | B안 (SOP 재배포 동기 문서) |
|---|---|---|
| code-shadow 구조적 해소 | ✅ 소스 자체를 registry SSOT 로 정렬 | ❌ 운영규약(사람이 재배포 기억)에 의존 |
| 폴러/워치독과 소스 통일 | ✅ 3소스 → 1 SSOT(redpay_terminal_registry) | ❌ 웹훅만 컴파일타임 잔존 |
| 검증된 이식 패턴 | ✅ 폴러 `loadRegistryFromDb`(scripts/…poller.mjs L283) 직접 이식 | — |
| 콜드스타트/지연 리스크 | 완화됨: 60s TTL 캐시 + 성공분만 캐시 + last-known-good | 없음(문서) |
| fail-open 안전 | ✅ registry 미가용 → FOOT_MERCHANT_SET graceful fallback | — |

**선택 근거**: hard precondition(payload merchant_id 실 라이브 반영, 28/28)이 YES 확정 → admit 키(merchant_id) 매칭 가능 → A안 실효 성립. 폴러/워치독이 이미 동일 registry 를 런타임 read 중이라 웹훅 정렬은 검증된 패턴 이식 + fail-open 으로 저위험. B안은 구조적 해소가 아니므로 폴백으로만 보류.

---

## AC-1 — 소스 코드경로 확정 + code-shadow delta 실측

### admit 판정 코드경로 (redpay-webhook/index.ts)
- L210 `isAllowedBusinessNo(data.business_no, env)` — env 방어필터(미설정 시 pass-through, 실 게이트 아님).
- **★L216(전) `centerForMerchant(data.merchant_id)`** = code-shadow 핵심. `_shared/redpay-foot-merchants.ts` FOOT_MERCHANT_SET 27-set **컴파일타임 상수만** 참조, DB registry 런타임 미조회.
- unknown → Slack 알림 + 미적재(status `unknown_merchant_alerted`). body → drop. foot → 적재.
- **admit 권위 키 = `merchant_id` (NOT tid)**. registry 는 UNIQUE(merchant_id) 보유.

### code-shadow delta 실측 (2026-07-29, 라이브 registry 조회)
```
static_count   = 27   (FOOT_MERCHANT_SET, 컴파일타임)
registry_count = 27   (redpay_terminal_registry, domain=foot active)
registry_NEW (registry − static) = []   ← code-shadow 실현분
static_ONLY  (static − registry) = []
=> merchant_id grain code-shadow delta = 0
```
**결론**: merchant_id grain 에서 **현재 실현된 code-shadow = 0** (registry 27 == static 27, 완전 동치).
code-shadow 는 **잠재(latent)** — registry 에 신규 foot merchant 가 seed 되는 순간 실현. 기존 TID 드리프트(239/246 등)는 **TID grain**(기존 merchant 소속)이라 웹훅 admit(merchant-keyed)과 무관.

⇒ **A안 배포는 현 시점 admit 대상 merchant 0건의 동작을 바꾸지 않음** (union of identical sets = same set). 순수 소스 정렬 — over/under-admit 회귀 0. 가치 = 미래 registry divergence 시점의 code-shadow 예방(재배포 없이 신규 foot merchant 자동 admit).

---

## AC-2 — 구현 (A안, fail-open)

**변경 파일** (EF-only, src/ 무접촉):
1. `_shared/redpay-foot-merchants.ts` (+56): `deriveFootMerchantSet()`(순수, union+fail-open), `centerForMerchantWithSet()`(런타임 set 주입판), `centerForMerchant()`=위임(하위호환).
2. `redpay-webhook/index.ts` (+85): `loadFootMerchantsFromRegistry()`(supabase read, 실패→null), `resolveFootMerchantSet(nowMs)`(60s TTL 캐시 + 성공분만 캐시 + last-known-good fail-open), admit 경로 L216 런타임 전환, introspect 지문 runtime 반영.
3. `_shared/redpay-foot-merchants.test.ts` (신규): 8 assert.

**fail-open 계약** (risk_verdict GO_WARN 의무):
- registry read 실패/타임아웃/빈결과 → `deriveFootMerchantSet(null|[])` → `FOOT_MERCHANT_SET` 반환(source=`fallback-static`). admit 전면차단 금지.
- union = registry ∪ **static floor** → static 절대 축소 없음 → registry 부분결과여도 under-admit 0.
- registry 성공분만 캐시, 실패 시 직전 성공 캐시(last-known-good) 유지 → fail-open 강화.
- domain=foot 쿼리만 → cross-domain(body/511) registry read 미도입 → 도메인 격리·DA CONSULT 면제 보존. body drop 은 컴파일타임 BODY_MERCHANT_SET 유지(admit 아닌 노이즈억제).

**★sub-Q (최필경 진단 redirect — merchant_id 추출·소비 확인)**:
- 정적: admit 키 = `data.merchant_id`. `validateEnvelope`(verify.ts L241)는 merchant_id **optional**(RedpayWebhookData 전 필드 `?`) — event_id/data.trxid/amount 만 필수. `data` 를 admit 에 전달 → `centerForMerchantWithSet(data.merchant_id, footSet)` 가 그 값을 그대로 소비. merchant_id 부재('' /null) → `unknown` → 전량 미적재(status `unknown_merchant_alerted`) 경로 발화 확인.
- 런타임(단위재현): test `centerForMerchantWithSet — merchant_id 부재 → unknown` PASS. merchant_id 부재→unknown→미적재 경로 재현.
- ※ merchant_id 부재로 인한 **unscopable-quarantine 강화**는 SILENT-PATH-HARDEN(경로A) 소관 — 본건은 admit 소스 정렬만(DISJOINT code-path). 경계 조율: 본건은 L216 `center` 산출 소스만 변경, unknown 분기 **동작 불변**.

---

## AC-3 — 검증 (registry-신규 TID 적재 성공 재현)

**단위 재현** (`deno test _shared/redpay-foot-merchants.test.ts` → 8/8 PASS):
- `centerForMerchantWithSet — registry-신규 merchant admit(foot) 재현`: 합성 registry-신규 merchant `1777289099` = static-only set 에선 `unknown`(drop) → registry 정렬 후 `foot`(admit). **더 이상 '미등록' drop 아님**.
- fail-open: registry null/빈배열 → static floor 동치(source=fallback-static, admit surface 불변).
- 회귀: body/unknown 불변, `centerForMerchant`(레거시) == `centerForMerchantWithSet(static)` 동치, over-admit 가드.

**라이브 재현 한계 (정직 기록)**: 현 registry merchant_id delta=0 이라 **라이브 registry-신규 merchant 표본이 없음** → 실 웹훅 유입 라이브 적재 재현은 (a) 합성 단위테스트로 대체 + (b) 배포 후 introspect 라우트(`GET ?introspect=whitelist`)로 `merchant_resolution_source=registry-union` 확인 = post-deploy 검증창(supervisor 게이트). 실 웹훅 유입 적재는 registry 에 신규 foot merchant seed 발생 시 자연 재현.

**fingerprint (canonical, registry-union == static-floor, delta=0)**:
```
merchant_count = 27
merchant_sha256 = cc86c311bda6e4b0159249ac95036e020a75c6f0e2484716b98fa2490dbd5601
```

**탐지 안전망 cross-ref**: 미전환 잔여분은 MEMBERSHIP-BLIND-RECONCILE(delta1/delta2)가 count-delta 로 표면화 — 예방(본건)+탐지(RECONCILE) 이원 유지.

---

## 게이트 상태
- db_change=false · no-DDL · e2e ef_only 면제 · DA CONSULT 면제(registry read 재사용, cross-domain semantics 미도입).
- deno check(index.ts / shared) PASS. deno test: 신규 8 + verify.test 21 + scope-filter.regress 10 = **39/39 PASS, 회귀 0**.
- bundle_hash: N/A (supabase/functions EF only, src/ FE 무접촉).
- ★착수순서: SILENT-PATH-HARDEN(P1)은 별도 approved 티켓(본 세션 미디스패치·미commit). 본 admit-소스 변경은 SILENT-PATH-HARDEN webhook quarantine 과 **DISJOINT code-path**(conflict_detail 확정) → 순서 merge hazard 없음. planner 통지.
