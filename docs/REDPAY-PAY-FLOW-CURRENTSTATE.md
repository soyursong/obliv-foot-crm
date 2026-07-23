# 서울오리진 풋센터 — 결제 → CRM 정산 플로우 **현행 사실기술서**

> **작성 목적**: 결제자동화(플랜 B) 설계 구체화를 위한 "지금 실제로 돌아가는" 코드/운영 기준 사실 정리.
> 요청: 최필경(풋센터 결제모듈 담당). 근거 티켓: T-20260723-foot-PAY-FLOW-CURRENTSTATE-DOC (parent: PAY-AUTOMATION-EPIC).
> **★ 기획 의도가 아니라 코드·운영 실측 기준.** 모든 항목에 파일 경로 / EF 이름 / 테이블·컬럼 / 스케줄을 명시.
> 대상: `obliv-foot-crm` (Supabase `rxlomoozakkjesdqjtvd`, prod = CF Pages `obliv-foot-crm.pages.dev`).
> 작성 시점 기준 커밋: main HEAD (2026-07-23).

---

## 0. 결론 요약 (TL;DR)

| 질문 | 현행 사실 |
|------|-----------|
| 수집 방식 | **폴링(5분)만 라이브.** 실제 폴러는 **맥스튜디오 상주 launchd 잡**이 레드페이를 직접 호출한다. 클라우드(Supabase EF / pg_net)에서의 직접 호출은 레드페이 WAF에 IP 차단(403)되어 **불가** → 코드가 아니라 발신 IP 축 문제로 맥스튜디오로 우회. |
| 웹훅 | **코드/엔드포인트는 존재하고 배포(ACTIVE)돼 있으나 실운영 비활성(INERT).** 시크릿 미설정 + `PAYMENT_AUTO_MODE` OFF → 200 no-op로 즉시 반환. 라이브 트래픽 0. |
| 대사(매칭) | 5분 폴러가 적재한 raw를 **4-Tier 매처**(Supabase Edge Function `redpay-reconcile`, `mode=match_only`)가 CRM 결제와 자동 대조. |
| CRM 표시 | 일마감 화면의 **'레드페이' 하위탭**이 read-only 뷰 `v_redpay_reconciliation_daily`만 소비해 매칭/미매칭을 표시. |

---

## 1. 전체 흐름 (End-to-End)

### 1.1 단계별 데이터 흐름 (순서대로)

```
[1] 카드 결제           [2] 레드페이            [3] 수집(pull)              [4] 저장                 [5] 대사(매칭)            [6] CRM 표시/기록
──────────────    ─────────────────    ──────────────────────    ────────────────────    ─────────────────────    ────────────────────────
카드 단말기(VAN)  →  레드페이 파트너 API  →  맥스튜디오 상주 폴러      →  redpay_raw_            →  redpay-reconcile EF     →  일마감 '레드페이' 탭
승인/취소            payments.php          (launchd, 5분)             transactions            (match_only, 4-Tier)       (v_redpay_reconciliation
                    (거래조회, 조회 전용)   한국 IP에서 직접 GET        (Supabase, upsert)        matched_payment_id 기록    _daily 뷰 read-only)
                                                                                              + payments 역기록          + payment_reconciliation_log
```

- **단방향 read-only 매칭.** 우리 → 레드페이로는 **조회(pull)만** 하며, 레드페이에 결제를 일으키거나 되돌려 쓰지 않는다.
- 시간 방향: `redpay.approved_at`(단말기 승인, 먼저) → `payments.created_at`(직원이 CRM에 입력, 나중). 매칭 윈도는 `[approved_at, approved_at + N분]` 단방향.
- **직원의 CRM 수납 입력은 지금도 100% 수기다.** 자동화는 "수기 입력된 CRM 결제 ↔ 단말기 승인"을 **사후 대조·표시**하는 데까지만 라이브다. 결제 레코드를 레드페이 데이터로 **자동 생성하지 않는다**(그 경로 = 웹훅 EF = 현재 INERT, §2).

### 1.2 각 단계 실행 위치 / 프로그램

| 단계 | 실행 위치 | 프로그램 / 아티팩트 |
|------|-----------|---------------------|
| [1] 카드 결제 | 현장 카드 단말기 (VAN) | 물리 단말기 → 레드페이(외부) |
| [2] 레드페이 | 레드페이 서버(외부) | 파트너 API `https://redpay.kr/api/partner/payments.php` (거래조회, 조회 전용) |
| [3] 수집(pull) | **맥스튜디오** (한국 일반 IP, launchd 상주) | `scripts/redpay_macstudio_poller.mjs` — 5분 주기 |
| [4] 저장 | **Supabase** (`rxlomoozakkjesdqjtvd`) | 테이블 `public.redpay_raw_transactions` (PostgREST service_role upsert) |
| [5] 대사(매칭) | **Supabase Edge Function** | `redpay-reconcile` (`supabase/functions/redpay-reconcile/`), `mode=match_only` — 레드페이 미호출, 순수 DB 매칭. 매처 엔진 = `matcher.ts` |
| [5-보조] 매처 트리거 | Supabase(pg_cron) + 맥스튜디오 | pg_cron `foot-redpay-reconcile` (`*/5`) 및 맥스튜디오 폴러의 best-effort `match_only` 호출 |
| [6] CRM 표시 | **CF Pages** (`obliv-foot-crm.pages.dev`) | FE `src/components/closing/RedpayReconcileTab.tsx` → read-only 뷰 `v_redpay_reconciliation_daily` + RPC `get_redpay_feed_freshness()` |

> **⚠ 핵심 운영 사실 — 수집 주체가 클라우드가 아니라 맥스튜디오인 이유**
> 레드페이 nginx WAF가 클라우드/데이터센터 IP 대역을 차단한다(CEO 조종실 소거실험 2026-07-11 확정).
> - Supabase EF(Deno Deploy) egress → 403 HTML
> - pg_net(AWS 서울) egress → 403 HTML
> - 맥스튜디오(한국 일반 IP) egress → 200/401 JSON (**유일 생존 경로**)
>
> 따라서 실제 레드페이 호출은 맥스튜디오 폴러가 담당하고, Supabase EF `redpay-reconcile`은 레드페이를 직접 호출하지 않는 `mode=match_only`(이미 적재된 raw만 4-Tier 매칭)로만 라이브 사용된다.
> (근거: `scripts/redpay_macstudio_poller.mjs` 헤더 주석, `redpay-reconcile/index.ts` L198~229 match_only 분기)

### 1.3 대사(매칭) 결과가 CRM에 반영되는 방식

매처(`matcher.ts`, 4-Tier)가 raw ↔ CRM 결제를 매칭하면 두 곳에 기록한다 (`redpay-reconcile/index.ts` `runMatcher`):

1. `redpay_raw_transactions` 행에 `matched_payment_id`, `match_rule` UPDATE.
2. 매칭된 `payments` 행에 `reconciled_at`(매칭 시각), `external_trxid`, `external_status` 역기록.
3. 모든 이벤트를 `payment_reconciliation_log`에 이벤트 소싱(auto_matched / match_failed / missing_in_crm / missing_at_van / amount_mismatch / refund_not_in_crm) + `center`('foot'/'body') 스탬프.

**4-Tier 매칭 우선순위** (`matcher.ts`):
- Tier 0 — Direct(보너스): 직원이 입력한 `external_approval_no` / `external_tid` 직접 일치.
- Tier 1 — Tight: TID 화이트리스트 + `method=card` + amount 일치 + `[+15분]`.
- Tier 2 — Loose: 같은 조건 + `[+30분]`, 단일 후보만.
- Tier 3 — Daily Unique: KST 같은 날짜 + amount unique.
- Tier 4 — Manual: 다중 후보/폴백 → 수동 매칭 큐.
> 설계 본질(대표 지시): "직원이 결제할 때 결제번호를 넣는 불편을 줄인다 — 시간·금액 기반 자동 매칭, 승인번호/TID 입력은 있으면 우선·없어도 매칭."

---

## 2. 데이터 수집 (레드페이 → 우리)

### 2.1 질문 3 — 폴링만인지, 웹훅도 받는지

**"코드/엔드포인트 존재 여부"와 "실제 라이브 수신 여부"를 분리해 답한다.**

#### (A) 폴링 — **라이브 (실운영 수집 경로)**
- 실 수집 주체: **맥스튜디오 launchd 폴러** `scripts/redpay_macstudio_poller.mjs`, **5분 주기**.
  1. 레드페이 `payments.php`를 한국 IP에서 직접 GET(검증된 200 경로, 인증 헤더 `X-API-KEY`).
  2. 풋 `merchant_id` 화이트리스트(1차 권위) + TID(보조)로 스크립트-레벨 스코프 필터.
  3. Supabase PostgREST(service_role)로 `redpay_raw_transactions` **멱등 upsert**.
  4. `redpay_poller_state`(id=1) `last_incremental_to` 갱신 = 적재 heartbeat.
  5. (best-effort) EF `match_only` 트리거로 4-Tier 매처 재사용(레드페이 미호출).
- 보조 스케줄: pg_cron `foot-redpay-reconcile` (`*/5 * * * *`, `supabase/migrations/20260710190000_redpay_reconcile_cron.sql`)가 EF `redpay-reconcile`를 5분마다 호출. 단, 이 EF는 클라우드 egress WAF 차단 때문에 레드페이 실 pull을 하지 못하며(`REDPAY_DRY_RUN` 기본 true = 픽스처 시뮬레이션, 또는 `match_only`), **레드페이로부터의 실 적재는 맥스튜디오 폴러가 담당**한다.
- 윈도: incremental 모드는 `redpay_poller_state.last_incremental_to` 기반 슬라이딩(2분 오버랩, 최대 2시간 lookback). 멱등키 `(external_trxid, external_status, amount)`로 재실행/중복 무해.

#### (B) 웹훅 — **코드/엔드포인트 존재·배포됨, 그러나 실운영 비활성(INERT)**
- 엔드포인트: `POST /functions/v1/redpay-webhook` (`supabase/functions/redpay-webhook/index.ts`, 배포 커밋 d461ab1e, ACTIVE).
- 검증 방식(코드상): **HMAC-SHA256**(raw body 기준, constant-time 비교), 헤더 `X-WEBHOOK-SIGNATURE`. 멱등키는 폴러와 동일한 `(external_trxid, external_status, amount)`. 취소 판별은 event_type·status 기준(금액 부호 사용 금지). merchant_id 화이트리스트로 센터 분리, business_no 방어필터.
- **왜 라이브가 아닌가 (INERT 근거, index.ts 실측):**
  - `REDPAY_WEBHOOK_SECRET` **미설정** → 서명 검증 불가로 처리 없이 `200 { status: "ignored_secret_unset" }` 즉시 반환 (index.ts L131~135).
  - 피처플래그 `PAYMENT_AUTO_MODE` **OFF(기본)** → 설령 서명 통과해도 적재 skip: `200 { status: "skipped_flag_off" }` (index.ts L186~189).
  - 즉, **엔드포인트는 200으로 응답하지만 어떤 레코드도 생성하지 않는다.** 라이브 수신·적재 = 0.
- 결론: 웹훅은 플랜 B의 수신 창구로 **미리 배포된 상태(스캐폴드 완료)**이며, 시크릿 등록 + `PAYMENT_AUTO_MODE=on` 두 스위치를 켜야 비로소 활성화된다. **현재 실운영 수집은 오직 (A) 5분 폴러.**

### 2.2 이중화 관계
폴러(pull, 백스톱) ↔ 웹훅(push, 실시간)은 **동일 테이블 `redpay_raw_transactions` + 동일 멱등키**를 공유하도록 설계돼 있어, 웹훅 활성화 시에도 이중 적재 충돌 없이 상보적으로 동작한다(웹훅은 폴러 소유 컬럼 tid/root_trxid/matched_payment_id/match_rule을 건드리지 않는 merge-safe 빌더 사용 → 폴러 매칭 결과 보존).

---

## 3. 레드페이 payload 필드 & 우리 저장 필드 (질문 4)

### 3.1 레드페이 응답 봉투 구조 (거래조회 API)

```jsonc
{
  "success": true,
  "message": "...",
  "data": {
    "items": [ /* RedpayTransaction[] */ ],
    "pagination": { "page": 1, "limit": 500, "total": N, "total_page": M }
  }
}
```

### 3.2 레드페이 거래 1건(`items[]`)이 내려주는 필드 (수신 전량)

`redpay-reconcile/index.ts`의 `RedpayTransaction` 인터페이스 및 폴러 매핑 기준 실측:

| 레드페이 필드 | 의미 |
|---------------|------|
| `trxid` | 거래 ID (매칭 최상위 키) |
| `status` | 거래 상태 `Y`(승인) / `N`(취소) / `M`(부분취소) / `X`(오류) |
| `status_name` | 상태 표시명 |
| `amount` | 금액. **취소(N/X/M)는 음수로 내려옴 → 부호 그대로 보존** |
| `approval_no` | 카드 승인번호 |
| `root_trxid` | 원거래 ID (환불/취소 시 원거래 참조) |
| `tid` | 단말기 식별자 |
| `approved_at` | 승인 일시 (KST 문자열 `YYYY-MM-DD HH:MM:SS`) |
| `cancelled_at` | 취소 일시 (KST, `0000-00-00` → NULL 정규화) |
| `order_no` | 주문번호 |
| `pg_name` / `pg_type` | PG 이름 / 유형 |
| `payment_method` | 결제 수단 |
| `merchant` | `{ id, name, member_id, member_name, tel }` — **`merchant.id`가 센터(foot/body) 도메인 경계 판정의 1차 권위** |

### 3.3 우리가 저장하는 필드 — `public.redpay_raw_transactions` 매핑

폴러/EF 공통 매핑 함수(`toRawTrxRow`) 실측. 저장 테이블 정의처: `supabase/migrations/20260607190000_pay_recon_port.sql`.

| 저장 컬럼 (`redpay_raw_transactions`) | 소스 레드페이 필드 | 비고 |
|----------------------------------------|--------------------|------|
| `external_trxid` (NOT NULL) | `trxid` | 멱등키 구성요소 |
| `external_status` (NOT NULL) | `status` | Y/N/M/X. 멱등키 구성요소 |
| `amount` (INTEGER, NOT NULL) | `amount` | 취소 음수 부호 보존. 멱등키 구성요소 |
| `approval_no` | `approval_no` | |
| `root_trxid` | `root_trxid` | 빈 문자열 → NULL 정규화 |
| `tid` | `tid` | 풋 화이트리스트 스코프 필터에 사용 |
| `approved_at` (TIMESTAMPTZ) | `approved_at` | KST→UTC 변환 저장 |
| `cancelled_at` (TIMESTAMPTZ) | `cancelled_at` | KST→UTC, `0000-…` → NULL |
| **`raw_payload` (JSONB)** | **거래 원본 item 전량** | merchant 포함 원본 JSON 통째 보관 (센터 파생·감사용) |
| `matched_payment_id` | (매처가 채움) | 매칭된 `payments.id`. NULL = 미매칭 |
| `match_rule` | (매처가 채움) | 4-Tier 규칙명 |
| `clinic_id` | (slug `jongno-foot` 해석) | 테넌트 스코프 |

- **멱등성 제약**: `UNIQUE (external_trxid, external_status, amount)` — 폴러·웹훅 공통. 동일 거래 중복 upsert 무해.

#### 매칭 시 `payments` 테이블 역기록 컬럼 (`20260607190000_pay_recon_port.sql`)
매처가 CRM 결제와 매칭에 성공하면 `payments`에 다음을 씀: `reconciled_at`(매칭 시각, NULL=미매칭), `external_trxid`, `external_status`(Y/N/M/X 거울값). (그 외 `external_approval_no` / `external_tid` / `external_root_trxid` 컬럼도 존재 — Tier 0 직접 입력/환불 추적용.)

#### 대사 표시 뷰 — `v_redpay_reconciliation_daily` (read-only, `20260708230000_redpay_recon_daily_view.sql`)
- grain: 레드페이 승인 1건 = 1행(redpay-anchored) + CRM만 있는 건(missing_at_van, crm-anchored).
- `recon_status` 파생: `matched` / `missing_in_crm` / `missing_at_van` / `amount_mismatch` / `refund_not_in_crm`.
- 서버-권위 스코프: `raw_payload->merchant->>id IN (풋 merchant_id 26종)` 1차 + TID 보조 + clinic RLS = 삼중 방어(도수/피부/롱레 merchant 대역 밖 → 구조적 자동배제).
- FE(`RedpayReconcileTab.tsx`)는 이 뷰만 소비하고 **FE에서 매칭 재계산·조인 금지**(매처 진실원천 이중화 방지).

---

## 4. 자격증명(시크릿) 저장 위치·형태 — **실값 비노출**

문서에 평문 노출 금지 항목은 저장 위치·형태만 기술:

| 자격증명 | 저장 위치 / 형태 | 소비처 |
|----------|------------------|--------|
| 레드페이 API 키 | 맥스튜디오 `~/.env.redpay-foot`(gitignore) 또는 `process.env`. 로그엔 마스킹. EF 측은 Supabase Function Secret `REDPAY_API_KEY` | 폴러 `X-API-KEY` 헤더 / EF |
| 풋 사업자번호 | EF/폴러 env `REDPAY_BUSINESS_NO` (레드페이 조회 스코프 param) | 마스터 키 사업자 스코프 필터 |
| clinic 안정키 | env `REDPAY_CLINIC_SLUG`(기본 `jongno-foot`) — business_no는 세무 cert 정정으로 mutable이라 clinic 해석은 slug 우선 | clinic_id 해석 |
| 단말기(TID)·merchant 화이트리스트 | DB 테이블 `redpay_terminal_registry`(SSOT) + env override(`REDPAY_TID_WHITELIST`/`REDPAY_MERCHANT_WHITELIST`) + 하드코딩 fail-safe DEFAULT | 스코프 narrowing |
| 웹훅 서명 시크릿 | Supabase Function Secret `REDPAY_WEBHOOK_SECRET` (현재 **미설정** → 웹훅 INERT) | 웹훅 HMAC 검증 |
| 웹훅 피처플래그 | Function Secret `PAYMENT_AUTO_MODE` (현재 **OFF**) | 웹훅 적재 on/off |
| 내부 cron 시크릿 | EF env `INTERNAL_CRON_SECRET` = Supabase Vault `internal_cron_secret` | pg_cron→EF 인증 |
| Slack 알림 | env `REDPAY_ALERT_CHANNEL` / `REDPAY_SLACK_BOT_TOKEN`(장쳰봇) | 정산 불일치 알림 |

- SSOT 문서: `memory/1_Projects/201_메디빌더_AI도입/redpay_foot_terminal_registry.md` §2(단말/merchant 권위 목록).

---

## 5. 플랜 B 설계 시 유의점 (현행에서 도출된 사실 근거)

1. **클라우드 직접 호출 불가**: 레드페이 WAF가 클라우드 IP 403 차단. 웹훅(레드페이→우리 push)은 방향이 반대이므로 이 문제에서 자유롭지만, 우리→레드페이 조회(pull)는 계속 맥스튜디오(한국 IP) 경유가 필요.
2. **웹훅 활성화 스위치는 2개**: `REDPAY_WEBHOOK_SECRET` 등록 + `PAYMENT_AUTO_MODE=on`. 둘 다 켜야 라이브. 기존 수기 입력 흐름은 절대 제거 금지(피처플래그로 상보 운영).
3. **저장·멱등은 이미 통일**: 폴러·웹훅 모두 `redpay_raw_transactions` + 동일 멱등키 → 이중화 안전. 플랜 B는 "적재된 raw → 환자/차트 배정 → 결제 레코드 자동 생성" UI를 얹는 방향이 자연스럽다(현재 그 배정 UI는 미구현, 웹훅 AC-3 주석상 별도 스펙).
4. **매칭 엔진은 재사용 가능**: 4-Tier 매처(`matcher.ts`)는 순수 함수·레드페이 비의존 → 웹훅 적재분에도 그대로 적용 가능.

---

## 부록 — 참조 코드/마이그레이션 실체 목록

| 구분 | 경로 |
|------|------|
| 실 폴러(라이브 수집) | `scripts/redpay_macstudio_poller.mjs` |
| 대사 EF(4-Tier 매처) | `supabase/functions/redpay-reconcile/index.ts`, `matcher.ts` |
| 레드페이 엔드포인트 SSOT | `supabase/functions/_shared/redpay-config.ts` |
| 웹훅 수신 EF(INERT) | `supabase/functions/redpay-webhook/index.ts`, `verify.ts` |
| 웹훅 merchant 유틸 | `supabase/functions/_shared/redpay-foot-merchants.ts` |
| 저장 스키마 | `supabase/migrations/20260607190000_pay_recon_port.sql` |
| 5분 폴러 cron | `supabase/migrations/20260710190000_redpay_reconcile_cron.sql` |
| 대사 표시 뷰/freshness | `supabase/migrations/20260708230000_redpay_recon_daily_view.sql` |
| CRM 표시 FE | `src/components/closing/RedpayReconcileTab.tsx` |
| 단말 레지스트리 | `supabase/migrations/20260711140000_redpay_terminal_registry_ssot.sql` + 확장 `20260720170000_redpay_foot_registry_expand_26.sql` |

*작성: dev-foot · T-20260723-foot-PAY-FLOW-CURRENTSTATE-DOC · 코드/운영 실측 기준(추정 배제).*
