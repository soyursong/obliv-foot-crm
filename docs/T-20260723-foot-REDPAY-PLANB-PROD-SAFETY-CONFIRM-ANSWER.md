# T-20260723-foot-REDPAY-PLANB-PROD-SAFETY-CONFIRM — secret 전달 前 운영안전 확인 답변

> 성격: EXPLAINER. 코드/DB/배포 변경 0. 이미 배포·검증된 관측모드(OBSERVE-MODE, deploy `e6bc1688`)·
> ADDITIVE 마이그(DDL-BUILD, `e78ebbae`)의 안전성을 **실코드/실배포 근거로 재확인**한 답변.
> 현장(최필경, C0ATE5P6JTH) secret 전달 + 웹훅 주소 등록 착수 前 확인 질문 2문 대상.
> ①=답변 완료(아래). ②=원문 절단으로 보류(responder 원문 릴레이 대기).

---

## ① 운영/개발 환경 + 0영향 + 킬스위치 — **답변 가능, 코드근거 확인 완료**

### 1) "지금 관측 설정이 올라간 곳" = 운영(프로덕션)입니다. 별도 개발서버 아님.
- 관측모드가 배포된 곳 = **운영(프로덕션) Supabase 프로젝트 `rxlomoozakkjesdqjtvd`**
  - Edge Function `redpay-webhook`(deploy commit `e6bc1688`), `redpay-reconcile`(폴러)
  - 마이그(신규 표 `pending_payment` + `received_at` 칸) commit `e78ebbae`, 운영 적용 완료
  - 화면(CF Pages 앱 번들)은 **한 줄도 안 바뀜**(ef_only — 서버 함수·표만 준비).
- **단, 지금은 "켜져도 아무 일도 안 하는" 대기 상태입니다.**
  - 레드페이 비밀키(`REDPAY_WEBHOOK_SECRET`) 미설정 → 웹훅이 들어와도 **아무 처리 없이 그냥 200(무시)** 반환
    (`redpay-webhook/index.ts:132-136` `if (!REDPAY_WEBHOOK_SECRET) → status: "ignored_secret_unset"`).
  - 자동화 스위치(`PAYMENT_AUTO_MODE`) 미설정 → 코드가 `off`로 해석 → **적재조차 안 함**
    (`verify.ts:77-82` `resolvePaymentMode("") → "off"`, `index.ts:191-194` `off → skipped_flag_off`).
  - 레드페이에 풋 주소(URL) 미등록 → **실 웹훅 유입 자체가 0건.**
  - ⇒ 배포는 됐지만 **현행 동작에 지금 이 순간 아무 영향 없음**(behavior-neutral).

### 2) 0영향 — 화면뿐 아니라 그 아래 DB·폴러·사후 대사까지 확인
현장 우려("화면 말고 그 밑의 결제·수납·정산 흐름까지 정말 안 건드리나")에 대한 코드근거:

- **기존 결제 흐름(수기입력·off/on 경로) 불변**
  - 관측모드 자체가 `db_change=false` 순수 스위치 분기. 기존 `off`/`on` 경로는 그대로.
  - QA Green(supervisor): 스위치 미설정 → 현행과 100% 동일(회귀 0).

- **DB(표) = 새로 "추가"만, 기존 표 손대지 않음**
  - 마이그(`e78ebbae`) = **ADDITIVE 전용**: 신규 표 `pending_payment` 추가 + `redpay_raw_transactions`에
    `received_at`(수신시각) 칸 신설. **기존 결제·수납·정산 표/제약은 미접촉**(데이터 담당 판정 GO_ADDITIVE).
  - `received_at` 기입도 안전장치: 칸이 있을 때만 기록(`verify.ts:203-204` "값이 주어질 때만 세팅") →
    구환경에서도 깨지지 않음.

- **자동으로 대사하러 가는 폴러(redpay-reconcile) = 관측행을 이중으로 제외**
  - 관측으로 쌓인 행은 표식(`_mode='observe'`)이 붙습니다(`verify.ts:189`).
  - 폴러는 이 행을 (1) DB 조회 단계에서 걸러내고(`redpay-reconcile/index.ts:54` `OBSERVE_EXCLUDE_FILTER`),
    (2) 코드 단계에서 한 번 더 걸러냅니다(`index.ts:539-540, 727-728` `isObserveRow`).
  - ⇒ **관측행이 실제 매출(payments)로 승격되는 경로가 이중 차단**됨.

- **실 결제(payments) 자동생성 0건 — 코드가 스스로 감시**
  - 관측모드에서 웹훅은 payments/pending_payment에 **쓰기(write)를 절대 하지 않음.**
  - 혹시라도 매칭 소유 칸이 섞이면 **즉시 적재 중단(500)** 하는 자기검증이 박혀 있음
    (`redpay-webhook/index.ts:217-220` `observe_safety_violation`).
  - ⇒ 관측은 "받은 원문을 그대로 쌓아 두고 보기만" 하는 동작. 매출·수납·정산 숫자에 손대지 않음.

### 3) 킬스위치(문제 시 즉시 끄기) — 있습니다.
- 스위치 하나로 즉시 원복: `PAYMENT_AUTO_MODE`를 `observe` → `off`(또는 값 제거)로 바꾸면
  **그 즉시 현행 100%로 복귀.**
- 관측행은 원문을 쌓아 두기만 한 것이라, 끄면 유입만 멈추고 기존 흐름엔 영향 없음.
- 게다가 지금은 **주소(URL) 미등록 상태 = 실 유입 자체가 0** → 켜기 전에는 위험이 성립하지 않음.

### 핵심 요약 (한 줄)
> "관측 설정은 운영에 올라가 있지만, 비밀키·주소가 아직 없어서 **지금은 켜져도 아무 일도 안 하는 대기 상태**입니다.
> 켠 뒤에도 관측은 **받은 내역을 쌓아 두고 보기만** 할 뿐, 결제·수납·정산 숫자(화면 밑 표·자동 대사까지)엔
> 손대지 않도록 코드에 이중 안전장치가 걸려 있고, **문제가 생기면 스위치 하나로 즉시 원래대로** 돌립니다."

---

## ② 서울오리진 사업자번호 457 변경 — 필터가 511만인가 457인가 (관측 0건 위험?) — **답변 완료, prod 실값 근거**

> 원문 복원(responder `MSG-20260723-160011-pg3p`): 레드페이 회신이 서울오리진을 457-23-00938로 명시.
> 그동안 우리 실측은 511. "웹훅/폴러 필터가 511이면 457 웹훅이 전량 걸러져 관측 0건" 우려.
> 아래는 **운영(prod) 실 설정값** 근거(추측 아님). 실값은 `supabase secrets list` digest(솔트 없는 SHA-256)에
> 후보 문자열 해시를 대조해 확인 — 평문 미노출·비파괴 조회. (CRON_SECRET↔INTERNAL_CRON_SECRET 동일 digest로 무솔트 입증)

### 1) 현재 필터 실값 (수신부·폴러 각각)

| 항목 | env | prod 실값 | 성격 |
|------|-----|-----------|------|
| **웹훅 수신부**(redpay-webhook) | `REDPAY_WEBHOOK_BUSINESS_NO_ALLOW` | **`457-23-00938,511-60-00988`** (둘 다) | 들어온 웹훅의 사업자번호 방어 drop 필터 |
| **폴러**(redpay-reconcile) | `REDPAY_BUSINESS_NO` | **`511-60-00988`** (511) | 레드페이 API **조회 스코프 파라미터**(drop 필터 아님) |
| (참고) 자동화 토글 | `PAYMENT_AUTO_MODE` | **`observe`** (관측 ON) | |
| (참고) 웹훅 시크릿 | `REDPAY_WEBHOOK_SECRET` | 설정됨(비어있지 않음, 2026-07-23 07:12) | 값 미확인·미노출 |

- **수신부 = 이미 457·511 둘 다 허용**. `isAllowedBusinessNo`가 CSV를 콤마 분할 후 숫자만 정규화(하이픈 제거)해
  멤버십 검사 → 457-23-00938(→4572300938)·511-60-00988(→5116000988) **양쪽 PASS**
  (`_shared/redpay-foot-merchants.ts:64-74`, `redpay-webhook/index.ts:55-56,160-162`).
- **폴러의 511은 웹훅을 거르는 값이 아님.** 레드페이 마스터키로 API를 **당겨올 때 보내는 사업자 스코프**이고
  (`redpay-reconcile/index.ts:110,943`), 실제 풋 좁히기는 **단말기(TID) 화이트리스트 13개**가 담당
  (`index.ts:934-949`). 즉 폴러는 웹훅 수신과 별개의 "끌어오기" 경로.
- 수신부의 **1차 센터 분리는 사업자번호가 아니라 단말기ID 26-set 화이트리스트**(`index.ts:166`)라
  사업자번호 필터는 보조 방어일 뿐. 457/511 어느 쪽이 와도 단말기ID가 풋 26-set이면 관측됨.

### 2) 457·511 both 관측 세팅 — **가능하고, 이미 되어 있음**
- 현장 권장(관측 초기 both 수용 후 실측 확정) = **수신부에 이미 반영 완료**
  (`REDPAY_WEBHOOK_BUSINESS_NO_ALLOW=457-23-00938,511-60-00988`, 2026-07-23 07:12 설정).
- 코드 변경 불필요 — env(secret) 값만으로 동작(코드는 이미 CSV 복수값 지원). 이번 건 **코드/DB/배포 변경 0**.
- ⚠ 주의: 이 값을 **비우면** 코드가 `REDPAY_BUSINESS_NO`(=511)로 fallback → **457이 drop**됨
  (`index.ts:55-56`). 그러니 "미설정 전체통과"로 두지 말고 **지금처럼 둘 다 명시**가 정답. (현재 상태 유지 권장)

### 3) 관측 0건 리스크 판정 — **현재 세팅이면 457 웹훅은 관측됨 (0건 위험 없음)**
- 현장 지적("511만 필터면 457 전량 drop → 관측 0건")은 **원리적으로 정확**. 다만 **실제 현재 prod는 이미 both**라
  그 위험은 사전 차단된 상태. 457 웹훅이 와도 사업자번호 필터에서 안 걸림.
- 지금 관측을 막는 유일한 남은 조건 = **레드페이에 풋 웹훅 주소(URL) 미등록 → 유입 자체가 0**(=최필경 착수 예정분).
  URL 등록되면 457 웹훅은 정상 관측됨.
- (2차 참고) **폴러 쪽**은 API 스코프가 511. 레드페이가 마스터키 조회에서 457로 스코프를 바꿔 요구한다면
  511 스코프 pull이 빈 결과일 수 있음 — 단 코드 주석은 "물리 merchant 사업자번호는 511 불변"으로 명시
  (`index.ts:112-113`). 관측은 **웹훅 경로가 주(主)**이고 폴러는 사후 대사 보조라 관측 0건과 직접 관련은 낮음.
  실측 후 폴러 스코프 511↔457 확정 필요 시 별도 확인 권장(레드페이 API가 어느 사업자번호를 스코프로 받는지).

### ② 핵심 요약 (한 줄)
> "수신부 필터는 **이미 457·511 둘 다** 받도록 설정돼 있어(2026-07-23 07:12), **457로 와도 안 걸리고 관측됩니다.**
> 폴러의 511은 웹훅을 거르는 값이 아니라 레드페이에서 **끌어올 때 쓰는 조회 범위**라 관측과 무관.
> 지금 관측이 0건인 이유는 필터가 아니라 **아직 레드페이에 풋 주소가 등록 안 돼서**이고, 주소 등록되면 관측 시작됩니다.
> 현장 지적은 원리상 맞고, 그 위험은 이미 both 설정으로 막아둔 상태입니다."

---

## 검증
- 코드/UI/DB 변경 없음 → 빌드 산출물·Playwright E2E 비대상(`e2e_spec_exempt_reason: deps`).
- ② prod 실값 = `supabase secrets list` digest(무솔트 SHA-256) ↔ 후보 문자열 해시 대조로 확인(평문 미노출·비파괴).
  - `REDPAY_WEBHOOK_BUSINESS_NO_ALLOW` digest `ef861764…` = `457-23-00938,511-60-00988`
  - `REDPAY_BUSINESS_NO` digest `6ac63968…` = `511-60-00988`
  - `PAYMENT_AUTO_MODE` digest `74e892c9…` = `observe`
- 산출물 = 본 문서(①·② 코드근거 현장어 답변) → responder 릴레이로 종결.

## 근거 파일·commit
- ① `supabase/functions/redpay-webhook/index.ts` (132-136, 191-194, 203-226, 217-220)
- ① `supabase/functions/redpay-webhook/verify.ts` (77-82, 189, 203-204)
- ① `supabase/functions/redpay-reconcile/index.ts` (54, 523-543, 718-731)
- ① `supabase/functions/redpay-reconcile/matcher.ts` (146-155 `isObserveRow`)
- ② `supabase/functions/_shared/redpay-foot-merchants.ts` (44-50 centerForMerchant, 52-74 isAllowedBusinessNo)
- ② `supabase/functions/redpay-webhook/index.ts` (55-56 ALLOW env+fallback, 159-163 drop 필터, 165-166 merchant 26-set 센터분리)
- ② `supabase/functions/redpay-reconcile/index.ts` (110 REDPAY_BUSINESS_NO, 112-113 511 불변 주석, 934-949 API 스코프+TID narrowing)
- 배포: OBSERVE-MODE `e6bc1688` / DDL-BUILD `e78ebbae` / 운영 Supabase `rxlomoozakkjesdqjtvd`
