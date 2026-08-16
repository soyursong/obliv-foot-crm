# LEG-1 forward 생성경로 census — 풋 package_payments 팬텀 자기상쇄쌍 (foot=공통 조상 검증)

- ticket: `T-20260815-foot-PKGPAY-PHANTOM-SELFOFFSET-CENSUS-LEG1` (P1, LEG-1 · **READ-ONLY**)
- 배경: CEO TICKET-UPDATE MSG-20260815-174941-r9k3 — body(도수) 팬텀 자기상쇄쌍이 body 고유가 아님이 실측됨. foot=공통 조상(body·scalp2 하드포크 상류) → foot 기준 실측이 곧 shared-upstream root-cause 검증.
- 부모: body LEG-1 verdict `obliv-body-crm/docs/diagnosis/T-20260815-body-PKGPAY-PHANTOM-SELFOFFSET-AUG-RECUR-LEG1.md`
- 모드: **READ-ONLY census — SELECT/introspection only. prod write/DDL/정정 0건.**
- 실측: prod `rxlomoozakkjesdqjtvd` (Management API = postgres, RLS 미적용, silent 0-row 회피). auth-context 확인: `current_user=postgres`.
- evidence: `scripts/_evidence/T-20260815-foot-PKGPAY-PHANTOM-SELFOFFSET_census_raw_part1.txt` · `_part2.txt`
- census scripts: `scripts/PKGPAY-PHANTOM-SELFOFFSET_census_readonly_T-20260815.mjs` · `_census2_readonly_T-20260815.mjs`

> ★핵심 지시(CEO): body LEG-1 forward-seal 을 foot 에 **자동 상속 금지**. body 8월 쌍=정오 타임스탬프=composeProcessedAt UI 아티팩트. foot 8월 쌍=33초 즉시상쇄=자동 롤백/재시도 시그니처에 더 가까움 → 축1·축2를 foot 에서 **반드시 재검증**. → 본 census 는 body 결론 재사용 없이 foot 코드·prod 로 독립 실측.

---

## 0. 대상 재확인 (CEO 수치 == prod 실재)

CEO 접수 8/10 쌍(2,960,000 payment/refund, 33초):

| 행 | id | payment_type | created_at (UTC) | amount | **is_test** | is_simulation |
|---|---|---|---|---|---|---|
| pay | `c9cc7a86…` | payment | 2026-08-10 23:20:08.856 | 2,960,000 | **TRUE** | false |
| refund | `8e05684d…` | refund | 2026-08-10 23:20:41.121 | 2,960,000 | **TRUE** | false |

- **Δt = 32.27초** (CEO "33초" 확증). 두 행 모두 **서브초 정밀 타임스탬프 = 진짜 INSERT 시각**(body 처럼 정오 고정 아님).
- ★**결정적 발견: 고객 = 박민석 `is_test = TRUE`** (is_simulation=false). CEO 필터 `is_simulation IS NOT TRUE` 가 이 행을 **배제하지 못한 이유** = is_simulation(샌드박스 금액 1001~1006 격리축)은 실금액(2,960,000)을 태그하지 않기 때문. **is_test 플래그가 이 행을 테스트로 정확히 마킹**함.
- 8월 MTD package_payments(is_simulation IS NOT TRUE): pay 123건/312,438,000 · refund 15건/39,950,000 · net 272,488,000.

---

## 1. 8/10 쌍 생성경로 지문 (계보·주체·트리거·코드경로)

| 지문 축 | payment `c9cc7a86` | refund `8e05684d` | 판정 |
|---|---|---|---|
| parent_payment_id | NULL | **NULL** | RPC 미경유(refund_package_payment 는 항상 set) |
| created_by | NULL | **NULL** | auth.uid() 미캡처 = RPC refund 아님 |
| payment_attempt_id | `c5d7d178…` | `fab604f3…` | **CAT-origin(cband_payment_attempts FK)** |
| external_approval_no | 46226270 | **46226270 (동일)** | CAT 취소전문 ORI_AUTHNO=원거래 AUTHNO |
| external_tid | 1047479470 | **1047479470 (동일)** | 동일 물리 단말기(TID) |
| method | card | card | 단말기 직결 |

**→ 33초 origin 코드경로 = 코밴 CAT 단말기 [단말기 취소](플랜A) 경로**, 자동/시스템 생성 아님:
- 결제: 단말기 승인 → `paymentFlow.approve` → APPROVED 분기 → `supabaseAttemptStore.recordCardPayment` INSERT payment 행(external_* + payment_attempt_id 3-way canon 착지).
- 취소: `CbandTerminalCancelButton`(실장 클릭) → `paymentFlow.cancel`(S1/0430 전문, ORI_AUTHNO=원거래 AUTHNO 동일) → 성공 시 `payment_type='refund'` 행 INSERT(external_approval_no=취소AUTHNO=원거래 AUTHNO, **parent_payment_id 미설정** — external_approval_no 로 링크). 재취소 가드(AC-5) = 원거래 AUTHNO 링크된 refund 존재 시 전문 미전송.
- **박민석(is_test) + 동일 단말기(TID 1047479470) + 승인 후 33초 즉시 취소 = 물리 CAT 단말기 기능 테스트**(과금→즉시 취소). 데이터 오염이 아니라 단말기 동작 확인 흔적.

---

## 축별 판정 (티켓 LEG-1 축1~4 · foot 독립 재검증)

### 축1 — 결제 실패 후 자동 롤백이 payment+refund 두 행으로 물질화되는가 → **FALSIFIED (해당 없음)**
foot 결제경로(`src/lib/cband/paymentFlow.ts` runPaymentFlow) 실측:
- **APPROVED**: `recordCardPayment` 로 **payment 행만** INSERT. 이후 자동 `cancel()` 호출 **없음**.
- **FAIL**: `updateAttempt(status='failed')` 만 — **payment 행 미생성**("과금 미발생 확정"). 보상 refund 없음.
- **ATTENTION**(무응답/타임아웃): payment 행 미생성, "확인 필요 정지, **자동 재시도 금지**". 보상 refund 없음.
- 승인 후 DB INSERT 실패 시에도 예외 상위 전파일 뿐 **단말기 자동 취소(보상 refund) 경로 부재**.
- foot 은 body 의 `fn_body_sell_package` 같은 서버 원자 판매 RPC 도 없음(payment=클라이언트 INSERT) → 트랜잭션 롤백-보상 refund 물질화 경로 **구조적 부재**.
→ **자동 롤백이 pay+refund 쌍을 만드는 코드경로 없음.**

### 축2 — UI 재시도/이중제출이 pay→refund 쌍을 남기는가 → **FALSIFIED (해당 없음)**
- 이중제출 방어 = insert-first `UNIQUE(clinic_id, msg_trace)`[L1] + `payment_attempt_id` partial UNIQUE[L2] + 동일환자 in-flight 잠금(CbandConcurrentPaymentError→ATTENTION, 미전송). 중복 승인콜백 INSERT=23505 → 멱등 skip.
- 이중제출은 최대 **payment 2행**(dedup)만 남길 뿐 **pay→refund 쌍을 만들지 않음**. refund 는 명시적 `TRANTYPE_CANCEL`(단말기 취소 버튼) 없이는 생성 불가.
→ **재시도/이중제출이 자기상쇄쌍을 만드는 코드경로 없음.**

### 축3 — 계보로 쌍을 식별 가능한가 → **YES (2축 계보)**
- foot package_payments 계보 컬럼 = **`parent_payment_id`**(refund→payment 하드링크, RPC 경로) + **`external_approval_no`/`payment_attempt_id`**(CAT 취소 경로). body 의 `refund_of` 는 foot 에 **없음**(스키마 실재 §0 확인).
- Class A(CAT 취소): parent_payment_id=NULL 이나 `external_approval_no`+`package_id`+`amount` 로 원결제 정밀 매칭(8/10 쌍 delta 32.27s 확인).
- Class B(스태프 RPC 환불): parent_payment_id 직접 링크 + created_by(실 스태프).

### 축4 — 공통 조상 forward 벡터가 foot 상류에 살아있는가 → **ABSENT (falsified)**
- foot 8월 33초 쌍 = **CAT 단말기 취소(플랜A, foot 고유)** — 수동 트리거. body 8월 쌍 = **스태프 bundle 전액환불**(RefundMiniWindow→process_pkgpayment_refund_bundle, 정오 composeProcessedAt UI 아티팩트). **두 CRM 의 메커니즘이 서로 다름.**
- foot 결제 RPC/롤백/재시도 경로에 **payment+refund 를 자동 물질화하는 forward 벡터 부재**(축1·2 실증). body 도 LEG-1 에서 동일 축 FALSIFIED.
- **→ 세 CRM 공통 auto-generation root-cause 없음.** 자기상쇄쌍은 코드버그가 아니라 **append-only offsetting 의 정상 클래스**(단말기 테스트 취소 + 스태프 정당 환불). 공통 상류(결제 RPC/재시도/롤백)가 팬텀을 생성한다는 가설은 foot 실측으로 **기각**.

---

## body(정오 UI 아티팩트) ↔ foot(33초) 대조표

| 축 | body 8월 | foot 8월 |
|---|---|---|
| 메커니즘 | 스태프 bundle 전액환불(process_pkgpayment_refund_bundle) | CAT 단말기 취소(박민석 test) |
| 타임스탬프 시그니처 | refund=03:00:00 정오KST(composeProcessedAt UI 고정), 23분 갭 | 서브초 실 now(), **33초** 갭 |
| 계보 링크 | `refund_of` | `parent_payment_id`(RPC) / `external_approval_no`(CAT) |
| created_by | 실 스태프 | **NULL**(CAT 테스트) |
| 고객 | 실 고객(is_test=false) | **박민석 is_test=TRUE** |
| RC | 스태프 전액환불(정당취소 vs 오입력=per-row 의도) | **CAT 단말기 기능 테스트**(과금+즉시취소) — 오염 아님 |
| 축1(자동롤백) | FALSIFIED | **FALSIFIED** |
| 축2(재시도) | FALSIFIED | **FALSIFIED** |
| forward 자동생성 벡터 | 부재 | **부재** |

**공통점**: 두 CRM 모두 자동생성 벡터(축1·2) 부재. **차이점**: 관측된 net=0 쌍의 물질화 경로가 CRM별로 상이(bundle-refund vs CAT-cancel). **공통 조상 판정**: shared-upstream 에 살아있는 forward 벡터 없음 — body LEG-1 forward-seal 을 foot 에 그대로 상속할 필요/근거 모두 부재이나, foot 독립 실측 결과 **결론(자동생성 부재)은 수렴**.

---

## foot self-offset 쌍 전수 landscape (전기간, is_simulation IS NOT TRUE)

package_payments refund 클래스 분류:

| Class | 정의 | n | is_test | 기간 | 성격 |
|---|---|---|---|---|---|
| **A** CAT 단말기 취소 | parent_payment_id NULL + payment_attempt_id NOT NULL | **2** | **2/2** | 08-10~08-11 | 물리 단말기 테스트(박민석) |
| **B** 스태프 RPC 환불 | parent_payment_id + created_by(실스태프) | 20 | 1 | 07-27~08-14 | 정당 append-only offsetting |
| **C** 레거시 환불 | parent_payment_id, created_by NULL | 9 | 0 | 07-15~07-23 | pre-created_by 하드닝 정당 환불 |

- **Class A = 전기간 단 2건, 전건 is_test=TRUE(박민석), 전건 CAT 33초.** production Class-A 팬텀 **0건**.
- 8월 net=0 exact self-offset 패키지 8건: **2건=Class A(박민석 test, any_cat=true)**, 6건=Class B 스태프 전액환불(any_actor=true, is_test=false, 정당 고객 환불 후보 — LEG-2 per-row 의도 확인 영역).
- payments(비패키지) 8월: refund 47건 중 CAT-origin 6건 — 동일 클래스 존재하나 본 티켓 스코프 밖(package_payments 우선).

---

## forward 차단안 (foot-scoped forward-seal)

**축1·2 = 이미 차단됨/애초 부재 실증** → **결제 RPC/롤백/UI 코드 forward-fix 대상 없음.**

1. **자동-생성 벡터(축1·2)는 live 아님** — 실패시 payment 행 미생성, 승인 후 자동취소 부재, 재시도 dedup·자동재시도 금지. refund 는 명시 CAT 취소 없이 생성 불가. → 코드 forward-block **불필요**.
2. **관측된 33초 쌍 = 박민석(is_test) CAT 단말기 기능 테스트** — 정상 동작. "막을" 버그 아님.
3. **실제 갭 = 리포팅 필터 축**: CEO 가 쓴 `is_simulation IS NOT TRUE` 는 is_test 고객을 배제하지 못함. Class A 2건은 **is_test 필터로 매출/census 에서 제외**되어야 함(is_simulation ⊥ is_test — 별개 축). 이는 **payment 코드 forward-fix 가 아니라 매출집계/리포팅 필터**(DA/Silver 소관) 문제.

### 선택적 하드닝 (SPEC only · 본 LEG 미구현 · READ-ONLY)
> 아래는 net=0 의 원인이 아니라 coherence/위생 개선 후보. 착수 시 별도 티켓.
- (S1) 매출/self-offset census 쿼리에 `AND c.is_test IS NOT TRUE` 병기(is_simulation 단독 필터 부족 봉합) — DA/dev-sales 리포팅 축, payment 코드 무접촉.
- (S2) CAT 단말기 테스트를 is_test 고객으로 수행 시 payment 행에 test 신호 전파(현재 payments.is_simulation BEFORE INSERT 트리거는 test 고객 승격 로직 존재하나 CAT 실금액은 미승격) — DA CONSULT 필요, 본 LEG 무발주.

---

## 결론 (LEG-1)

- **CEO 8/10 쌍 확증**: 박민석 **is_test=TRUE** 고객의 **CAT 단말기 취소(33초)** = 물리 단말기 기능 테스트. is_simulation 필터 미배제이나 is_test 로 정확히 마킹됨. net=0 이며 **데이터 오염이 아니라 테스트 흔적**.
- **축1(자동롤백)·축2(재시도) foot 독립 재검증 = FALSIFIED** — body 결론 자동상속 아님, foot 코드/prod 실측으로 재확인. 팬텀 자동생성 코드경로 **부재**. → **코드 forward-block 불필요**.
- **축4 공통 조상 판정 = forward 벡터 ABSENT** — foot 상류(결제 RPC/롤백/재시도)에 살아있는 auto-generation 벡터 없음. 세 CRM 공통 원인 **미확정(기각)**. body·foot 의 net=0 쌍은 메커니즘 상이하나 모두 의도-설명가능(단말기 테스트 / 스태프 정당환불) — append-only offsetting 정상 클래스.
- **landscape**: Class A(CAT test) 2건 전건 is_test, Class B/C 정당 환불. production 팬텀 0건.
- **판정 주의 준수(mechanism ≠ intent)**: 동액·33초만으로 오염 단정 안 함. 구조화 provenance(is_test·payment_attempt_id·external_approval_no·created_by)로 판별. Class B 6건 전액환불 net=0 = 정당취소 여부는 **행별 의도 확인(LEG-2)** 영역 — 본 LEG 무발주.
- **LEG-2(오염 정리)**: 본 티켓 무발주. body/scalp2 자매 CLEANUP 봉투 landing 후 별건. 단 foot 은 Class A=is_test 필터로 배제 가능(정리 대상 아님), Class B=per-row 의도 확인이라 blanket UPDATE 금지.
- **RC-first 준수**: green build/spec 를 종결근거로 쓰지 않음. 본 산출=READ-ONLY prod 실측 지문.
