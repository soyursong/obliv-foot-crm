# 풋센터 redpay-reconcile 활성화 — 배포 설정 & 검증 명세 (supervisor 인계)

**Ticket:** T-20260708-foot-REDPAY-CLOSING-TAB (activation_gate, P0 · 내일 라이브 블로커)
**Dev deliverable:** EF build-ready 확인 + secrets 정확값 + pg_cron SQL 산출. **배포/secrets set/cron 생성 실행 = supervisor 게이트**(실 KRW 정산 핵심경로).
**Project:** obliv-foot-crm / Supabase `rxlomoozakkjesdqjtvd`
**작성:** dev-foot, 2026-07-10

---

## 0. 활성화 미착화 4대 원인 (CEO 조종실 실측, MSG-5xvu) ↔ 본 명세 대응

| # | 실측 결함 | 본 명세 대응 |
|---|----------|-------------|
| 1 | redpay-reconcile EF prod 미배포(레포에만 존재) | §1 EF build-ready 확인 → supervisor deploy |
| 2 | pg_cron 폴러 잡 부재(cron.job에 redpay 계열 0) | §3 migration 20260710190000 |
| 3 | secrets 미비(API_KEY만, BUSINESS_NO/TID/DRY_RUN 없음)→G4 BLOCKED+DRY_RUN기본 true | §2 secrets 3종 |
| 4 | redpay_raw_transactions 0건 / poller_state 6/15 무갱신 | §4 검증 (§1~3 실행 후 자동 해소) |

---

## 1. EF build-ready 확인 (item 1) — ✅ PASS

- **대상 경로:** `supabase/functions/redpay-reconcile/index.ts` (Deno.serve 엔트리)
- **배포 명령:** `supabase functions deploy redpay-reconcile --project-ref rxlomoozakkjesdqjtvd`
- **로컬 deps(번들 자동 포함):** `./matcher.ts` + `./__fixtures__/redpay-responses.json` — 모두 존재. `guard.ts`는 vitest 단위테스트용(런타임 미import, 배포 무관).
- **외부 dep:** `esm.sh/@supabase/supabase-js@2.49.1` (원격 resolve).
- **타입체크:** `deno check index.ts` → **Check PASS (에러 0)** (dev-foot 실행, 2026-07-10, deno 2.9.0).
- **롱레/PORT(de57287) 동치 확인:**
  - `guard.ts` (G4 빈키 가드) = 롱레와 **byte-identical**.
  - `matcher.ts` = 4-tier 매처 골격·enum(matched/missing_in_crm/missing_at_van/amount_mismatch/refund_not_in_crm) 동일. **유일 차이 = 의도된 풋 변형**: 롱레는 단일DB에 longlasting/vegas 혼재 → `source_system='longlasting'` 필터 존재. 풋CRM payments엔 source_system 컬럼 없음(단일 도메인) → Tier1/2/3의 source_system 필터 **제거**. 이 delta는 T-20260607-foot-REDPAY-PORT 이식 시 검증됨(코드 주석 명시). 로직 회귀 아님.
  - `index.ts` = 풋 라벨(`[redpay-reconcile][foot]`) + 풋 단일 클리닉 clinic 조회(business_no 기준). 폴러 파이프라인·윈도 슬라이딩·인증 동일.
- **결론:** 현행 레포 상태 그대로 **배포 가능**. 코드 수정 불요.

---

## 2. EF secrets 정확 KEY명 + 값 (item 2)

guard.ts / index.ts 가 기대하는 **정확한 env 키명**과 값. `supabase secrets set` 대상:

```
REDPAY_BUSINESS_NO   = 511-60-00988
REDPAY_TID_WHITELIST = 1047479483,1047479476,1047479477,1047479478,1047479479,1047479480,1047479481,1047479482,1047479153,1047479148,1047479155,1047479158,1047479157
REDPAY_DRY_RUN       = false
```

- **기존 유지(재set 불요):** `REDPAY_API_KEY`(이은상 팀장 등록분, merchant 1777284978) · `INTERNAL_CRON_SECRET`(cron 인증) · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY`.
- **선택(미설정 시 로그만, 알림 미발사):** `REDPAY_ALERT_CHANNEL` · `REDPAY_SLACK_BOT_TOKEN`.

### 2.1 파싱 포맷 (guard.ts / index.ts 근거)
- `REDPAY_TID_WHITELIST` = **CSV(쉼표 구분, 공백 무관)**. 코드: `.split(",").map(t=>t.trim()).filter(Boolean)` (index.ts:193/285/462, guard.ts:57). JSON 아님.
- `REDPAY_DRY_RUN` = 문자열 `"false"` 정확히. 그 외/미설정 = `true`(safe default, 실호출 차단). 코드: `(Deno.env.get("REDPAY_DRY_RUN") ?? "true") === "true"` (index.ts:52).
- `REDPAY_BUSINESS_NO` 비거나 `REDPAY_API_KEY` 비면 → **G4 BLOCKED**(status:blocked, 알림 미발사). 둘 다 채워야 폴러 진입.

### 2.2 ⚠ AC-4 공유 merchant 혼입 방지 (필수 검증)
- business_no `511-60-00988` = **공유 merchant**(롱레 8 TID + 풋 13 TID 동거, 계약 §519). business_no 단독 스코프 시 롱레 거래가 풋 탭에 섞임.
- 위 13 TID = `obliv_origin_env.md`(F0BFXCWLGQ2) '풋' 섹션 **정확 전건**(멀티 8 + 무선 5). committed migration `20260708230000_redpay_recon_daily_view.sql`(뷰 서버권위 하드코딩) + E2E spec `FOOT_TIDS` 와 **3자 일치**.
- **롱레 8 TID 교집합 = 0 검증(dev 실측):** 롱레={1047479465,455,456,143,138,144,146,145} ∩ 풋 13 = **∅**. 혼입 원천 차단.

| 풋 TID (13, whitelist 투입) | 단말 |
|---|---|
| 1047479483,1047479476,1047479477,1047479478,1047479479,1047479480,1047479481,1047479482 | 멀티(8) |
| 1047479153,1047479148,1047479155,1047479158,1047479157 | 무선(5) |

---

## 3. pg_cron 폴러 잡 (item 3)

**산출물 = committed migration** (foot 컨벤션, attendance-sync 폴러와 동일 idiom):
- `supabase/migrations/20260710190000_redpay_reconcile_cron.sql`
- rollback: `..._redpay_reconcile_cron.rollback.sql`

핵심(멱등 가드 포함):
```sql
-- 함수: EF를 net.http_post(mode=incremental) 5분 호출. URL/secret = 풋 vault 컨벤션.
CREATE OR REPLACE FUNCTION public.trigger_redpay_reconcile() ... ;  -- X-Internal-Cron = get_vault_secret('internal_cron_secret')

-- 멱등: 기존 잡 있으면 unschedule 후 재등록
DO $$ BEGIN
  PERFORM cron.unschedule('foot-redpay-reconcile')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='foot-redpay-reconcile');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('foot-redpay-reconcile', '*/5 * * * *',
  $$ SELECT public.trigger_redpay_reconcile() $$);
```
- **근거:** 롱레 `crm-notif-delivery-reconcile` 5분 폴러(20260701120000) + 풋 `foot-attendance-sync`(20260618201000) 동일 net.http_post/vault 패턴. redpay는 5분(*/5).
- **body:** `{"mode":"incremental"}` — EF가 `redpay_poller_state.last_incremental_to` 기반 슬라이딩 윈도(오버랩 2분, 최대 2h lookback) 자동 계산. 별도 window 파라미터 불요.
- **인증:** EF는 `X-Internal-Cron == INTERNAL_CRON_SECRET`(index.ts:121-123) 통과. ⚠ **vault `internal_cron_secret` 값 == EF env `INTERNAL_CRON_SECRET` 값 일치** 확인 필수.
- **DDL 성격:** ADDITIVE(함수1+cron1, 테이블/컬럼/enum 0). §S2.4 데이터정책 게이트 대상 아님 — 티켓 DA GO_WARN 봉투 내 활성화. supervisor DDL-diff만.

---

## 4. 검증 (activation_gate task#4 — verify_evidence_required)

§1~3 실행 후 supervisor 확인(순서 = 배포→secrets→cron migration apply→검증):
1. `SELECT count(*) FROM redpay_raw_transactions;` → **≥1행**(이광현 팀장 7/10 15:45~16:00 테스트 결제).
2. `SELECT last_incremental_to FROM redpay_poller_state WHERE id=1;` → **now 근처 갱신**(fetched>0).
3. `SELECT public.get_redpay_feed_freshness();` → **null/0 탈출**(non-null approved_at).
4. `SELECT DISTINCT tid FROM redpay_raw_transactions;` → **풋 13 TID 만**(롱레 8 TID 0건 혼입, AC-4).
5. 화면: `/admin/closing#payments` → '레드페이' 하위탭/대조뷰(`v_redpay_reconciliation_daily`)에 표시.

### 4.1 ⚠ supervisor precheck (실측 게이트)
- **clinic 행 존재:** `SELECT id,business_no FROM clinics WHERE business_no='511-60-00988';` → 1행이어야 EF clinic_id 조회 성공(index.ts:297-305, 부재 시 "clinic_id 조회 실패" throw). **부재 시 배포 보류 → planner FOLLOWUP.**
- **기존 검증키 라이브 동작:** REDPAY_API_KEY가 비-테스트모드로 실 API 반환하는지 1틱 확인(risk-2 '테스트모드 잠김' 우려). `SELECT public.trigger_redpay_reconcile();` 후 EF 로그 확인.
- **raw.tid 포맷:** DRY_RUN=false 첫 폴링 로그에서 실제 반환된 `raw.tid`가 `1047479…`(whitelist 정합)인지 표본 확인. 다른 네임스페이스면 → whitelist 재산정 FOLLOWUP(롱레 457 케이스 §4.2 교훈).

---

## 5. 게이트 요약

| item | dev-foot(설계+검증) | supervisor(실행) |
|------|--------------------|-----------------|
| 1 EF build-ready | ✅ deno check PASS, PORT 동치 확인 | `functions deploy redpay-reconcile` |
| 2 secrets | ✅ 정확 KEY명+값+파싱포맷+TID 정합 | `secrets set` 3종 |
| 3 pg_cron | ✅ migration 20260710190000(멱등) | migration apply |
| 4 검증 | 검증 쿼리 세트 제공 | 실행+evidence 수집 |

**db_change: ADDITIVE(function+cron only) · 신규 테이블/컬럼/enum 0 · rollback=DROP FUNCTION+unschedule(데이터 손실 0).**
