# 레드페이 플랜B — 관측모드 착수 전 코드확인 5문 (Q1~Q5)

- **티켓**: T-20260722-foot-REDPAY-WEBHOOK-PLANB (EXPLAINER, 코드/DB/UI 변경 0)
- **요청**: 최필경(풋센터 결제모듈, C0ATE5P6JTH)
- **답변 근거**: 현행 배포 실코드 — `redpay-webhook` EF (배포본 commit `d461ab1e`, redpay-webhook v1 ACTIVE·`verify_jwt=false`)
  - 확인 결과 `supabase/functions/redpay-webhook/` 는 `d461ab1e` 이후 **변경 없음** → 배포본 = 현행 코드 동일. 문서(RECV-EF 티켓/DA CONSULT-REPLY)와 코드 divergence 없음(모두 코드로 재확인).
- **성격**: 코드를 읽어 사실만 답하는 확인 작업. 시스템은 바뀌지 않음.

---

## 요약 (현장용 한눈)

| 질문 | 한 줄 답 |
|------|----------|
| Q1 관측 전용 모드 | **지금은 없습니다.** 지금 스위치를 "끔(OFF)"으로 두면 원본조차 저장 안 되고 0건입니다(최필경님 인식이 정확). "켬(ON)"으로 두면 **원본만 저장**하고 매칭·결제생성은 안 합니다. 원본만 조용히 쌓는 전용 스위치는 새로 만들 수 있고, **난이도 낮음(약 0.5일, 별도 작업 티켓으로 분리)**. |
| Q2 받은 시각 칸 | 전용 `received_at` 칸은 **없습니다.** 대신 `created_at`(저장된 시각, 자동 기록) 칸이 이미 있어 **받은 시각으로 그대로 쓸 수 있습니다.** 지연 측정 가능(단서 1개 아래). |
| Q3 켰을 때 범위 | **(a) 원본 저장만.** 매칭도(b), 결제 레코드 자동생성도(c) **안 합니다.** |
| Q4 비밀키 | 이름 `REDPAY_WEBHOOK_SECRET`, 넣는 곳 = Supabase 프로젝트(rxlomoozakkjesdqjtvd)의 Edge Function Secrets. 지금 미설정 → 코드는 아무 처리 없이 200으로 무시. |
| Q5 로그인토큰 없이 수신 | **네, 받습니다.** 로그인토큰(JWT) 관문이 꺼져 있어(`verify_jwt=false`) 서명헤더만으로 막힘 없이 들어옵니다. |

---

## Q1. 관측 전용 모드(원본 저장 + 받은시각만, 매칭·결제자동생성 OFF) — 현행 유무 + feasibility

**결론: 그런 이름의 전용 모드는 현재 코드에 없습니다.** 지금 스위치(`PAYMENT_AUTO_MODE`)는 두 가지 상태뿐입니다.

- **OFF(기본값)** — `index.ts:186-189`
  - 서명검증까지 하고 정상 200 응답은 주지만, **원본 저장(upsert) 자체를 건너뜁니다.** (upsert 코드는 191번째 줄 이후인데 그 전에 `return` 함.)
  - → **최필경님 인식("raw 적재 자체 skip, 레코드 0건")이 코드와 정확히 일치합니다.**
- **ON** — `index.ts:191-232`
  - `redpay_raw_transactions` 테이블에 **원본만 저장**(upsert). 매칭(redpay-reconcile) 호출 없음, payments 결제 레코드 생성 없음(`matched_payment_id`는 비워둠).
  - → 즉, 지금의 **ON 동작 자체가 이미 "원본만 쌓고 매칭·결제생성은 안 함"** = 관측 모드에 근접합니다. (단, 별도의 매칭 폴러 redpay-reconcile가 백그라운드에서 돌면 나중에 매칭될 여지는 있음 — 웹훅 EF와는 별개 프로그램.)

**관측 전용 스위치(예: `PAYMENT_OBSERVE_MODE=on`) 신설 feasibility**
- 난이도: **낮음(LOW)**. `index.ts:186` 앞에 분기 하나 추가(OFF=아무것도 안함 / OBSERVE=원본+받은시각만 저장, 매칭·결제 확실히 차단 / ON=현행) + 매칭 폴러가 웹훅 유래 행은 건드리지 않도록 가드 한 줄.
- 공수: **약 0.5일**(설계+구현+테스트). 설계 제안 수준이며 실구현은 아님.
- 후속: "만들자"로 확정되면 별도 BUILD 티켓 분리(risk 게이트 재수행).

> 참고: 지금 ON도 이 EF에서는 원본만 저장하므로, "원본은 쌓되 매칭/결제는 확실히 끈다"를 이름으로 보장하고 싶은 것이 관측모드의 핵심 요구입니다. 폴러 가드까지 포함하면 LOW~MEDIUM.

---

## Q2. `received_at`(우리 서버 수신 시각) 컬럼 존재 여부

**전용 `received_at` 컬럼은 없습니다.** 대신 `created_at`이 그 역할을 합니다.

- 테이블 `redpay_raw_transactions` 정의 (migration `20260607190000_pay_recon_port.sql:77`):
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` — 행이 저장되는 순간 자동으로 서버 시각이 찍힘.
- ON 상태에서 웹훅을 받아 저장(upsert)하면 `created_at` = **우리 서버가 저장한 시각** = 사실상 수신 시각. → DA CONSULT-REPLY(`received_at = created_at` 매핑, 별도 컬럼 불요)와 **코드 일치**.
- 지연 측정: 레드페이가 준 `occurred_at`(거래 발생 시각) vs 우리 `created_at`(저장 시각) 차이로 측정 가능.

> ⚠ **단서 1개(정확도용):** `created_at`은 **최초 저장 시각**입니다. 만약 매칭 폴러(redpay-reconcile)가 같은 거래를 웹훅보다 **먼저** 저장했다면, 그 행의 `created_at`은 "폴러가 저장한 시각"이 되어 "웹훅 수신 시각"과 다를 수 있습니다(재전송·중복 시 같은 행에 합쳐지고 `created_at`은 최초값 유지, 갱신은 `updated_at`에 찍힘). 순수 "웹훅 수신 지연"을 정밀 측정하려면 별도 `received_at` 컬럼(웹훅 저장 시점 전용)을 두는 편이 정확 — 관측모드 신설 시 함께 검토 권장(ADDITIVE, DB 게이트 별도).

---

## Q3. `PAYMENT_AUTO_MODE=on`일 때 정확한 동작 범위 ★코드경로

**결론: (a) 원본(raw_transactions) 저장만. (b)·(c) 안 함.**

- **(a) 원본 저장만 — YES**: `index.ts:207-212` — `supabase.from("redpay_raw_transactions").upsert(row, {...})`. 저장하는 행은 `buildWebhookRawRow()`(`verify.ts:143-180`)가 만들며, 매칭 관련 컬럼(`matched_payment_id`, `match_rule`, `tid`, `root_trxid` = 폴러 소유)은 **일부러 제외**(클로버 방지). → 저장된 행의 `matched_payment_id`는 NULL(미매칭 상태).
- **(b) redpay-reconcile(매처) 호출 — NO**: `index.ts` 전체에 redpay-reconcile 호출·매칭 로직 **없음**. 매칭은 별도 폴러 EF(redpay-reconcile)가 독립적으로 수행.
- **(c) payments 결제 레코드 자동생성 — NO**: `payments` 테이블 INSERT 코드 **없음**. longre 정본(match-first, payments 직접 INSERT 안 함) 패턴 그대로 이식됨.

> 즉 이 웹훅 EF는 ON이어도 "원본 한 줄 저장"에서 끝납니다. 매칭/결제생성은 이 EF의 책임이 아님.

---

## Q4. `REDPAY_WEBHOOK_SECRET` 등록 위치·키명

- **키 이름: `REDPAY_WEBHOOK_SECRET`** — 코드가 이 이름으로 읽음 (`index.ts:51` `Deno.env.get("REDPAY_WEBHOOK_SECRET")`).
- **넣는 곳**: Supabase 프로젝트 **rxlomoozakkjesdqjtvd**의 Edge Function 환경변수(Secrets).
  - Dashboard 경로: Project Settings > Edge Functions > Secrets 에 `REDPAY_WEBHOOK_SECRET` = (레드페이가 준 값) 추가.
  - (또는 CLI: `supabase secrets set REDPAY_WEBHOOK_SECRET=...`) — **평문 git 커밋 금지.**
- **현재 상태**: 미설정. 코드는 secret이 비어 있으면 아무 처리 없이 200 응답으로 무시(`index.ts:131-135`, `status: ignored_secret_unset`). → 값을 넣어야 비로소 서명검증·처리가 시작됨.
- **누가 등록?**: 개발(dev)은 "이 값이 어디에 어떤 이름으로 들어가야 코드가 읽는다"까지 확정. **실제 등록 실행 주체(최필경님 직접 / supervisor / dev)는 planner가 라우팅 판단.**

---

## Q5. 로그인토큰(JWT) 없이 서명헤더만으로 외부 POST 수신 가능?

**결론: 네, 받습니다(JWT 불요).**

- 배포 설정 (`config.toml:66-67`): `[functions.redpay-webhook]` `verify_jwt = false`.
  - → Supabase 게이트웨이의 JWT(로그인토큰) 검사가 **꺼져 있음.** 레드페이가 `X-WEBHOOK-SIGNATURE` 서명헤더만 보내고 JWT를 안 보내도 **게이트웨이 401 없이 EF 코드까지 도달**합니다.
- 인증은 게이트웨이가 아니라 **EF 코드 내부 서명검증**이 담당: `verify.ts:verifySignature` — HMAC-SHA256(원문 바디, secret) constant-time 비교. 서명 불일치면 EF가 스스로 401 거부(`index.ts:136-140`). → 서명검증이 인증의 단일 관문이므로 무인증 구멍 없음.
- 형제 EF(redpay-reconcile / dopamine-callback / reservation-ingest 등)도 동일 컨벤션(`verify_jwt=false` + 헤더 자체검증).

> 즉 "레드페이는 서명헤더만 보낸다"는 전제가 지금 코드/배포와 정확히 맞습니다. secret만 등록하면 곧바로 수신·검증됩니다.

---

## AC 대조

- **AC1** Q1~Q5 전부 현행 실코드(d461ab1e) 근거 답변 — 충족(파일:라인 명시).
- **AC2** Q3 코드경로 파일:라인·함수명 명시, (a)만 배선 단정 — 충족.
- **AC3** Q1 관측모드 현행 유무 단정(없음) + PAYMENT_OBSERVE_MODE feasibility(LOW, ~0.5일) + "OFF=raw skip 확정" — 충족.
- **AC4** 문서-코드 divergence: 없음(코드가 문서값 재확인). Q2 `received_at`=`created_at` 매핑도 코드 확인. → planner flag 불요.
- **AC5** 현장 친화 언어 요약(상단) + 기술 근거(하단) — responder 릴레이 가능 형태. Q4 등록 실행주체는 planner 라우팅.

> 후속: Q1이 "만들자"로 확정되면 → 별도 BUILD 티켓(`PAYMENT_OBSERVE_MODE` 구현) 분리, risk 게이트 재수행.
