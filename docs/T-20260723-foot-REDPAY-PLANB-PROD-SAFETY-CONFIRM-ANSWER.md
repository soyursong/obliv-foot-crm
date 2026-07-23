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

## ② "서울오리진 사업자" 질문 — 원문 절단, 답변 보류
- 현장에서 온 원 메시지(`MSG-20260723-155059-m2qv`)가 `■ ② 서울오리진 사업자`에서 **잘려서 수신**됨
  (이하 원문 없음).
- 개발 답변 대상 아님 → **원문 전체를 다시 받아야** 답할 수 있음(responder 원문 릴레이 대기).
- 추측 답변 금지.

---

## 검증
- 코드/UI/DB 변경 없음 → 빌드 산출물·Playwright E2E 비대상(`e2e_spec_exempt_reason: deps`).
- 산출물 = 본 문서(① 코드근거 현장어 답변) → responder 릴레이로 종결.

## 근거 파일·commit
- `supabase/functions/redpay-webhook/index.ts` (132-136, 191-194, 203-226, 217-220)
- `supabase/functions/redpay-webhook/verify.ts` (77-82, 189, 203-204)
- `supabase/functions/redpay-reconcile/index.ts` (54, 523-543, 718-731)
- `supabase/functions/redpay-reconcile/matcher.ts` (146-155 `isObserveRow`)
- 배포: OBSERVE-MODE `e6bc1688` / DDL-BUILD `e78ebbae` / 운영 Supabase `rxlomoozakkjesdqjtvd`
