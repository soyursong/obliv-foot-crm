-- ============================================================================
-- T-20260610-foot-SMS-OPTIN-BACKFILL-REJECT  ·  data-backfill SQL
-- ----------------------------------------------------------------------------
-- TARGET DB : foot prod  rxlomoozakkjesdqjtvd  ·  table: public.customers
--
-- *** GATE — DO NOT EXECUTE ***
--   순서(불변): dev-foot dry-run+package(완료) → supervisor DB게이트가
--               dry-run count 를 김주연/대표에게 제시·확인(AC1) → supervisor 단독 GO
--               → 실행 → AC4 검증. dev-foot 자동 실행 금지(티켓 risk_verdict=BLOCK).
--   supervisor DB 게이트 통과·count 확인 전 어떤 mutation 도 금지. 본 파일은 설계 산출물.
--
-- 목적(polarity 갭 정합):
--   OLD 차트에서 단일선택 '문자수신거부'(sms_reject=true) 처리된 기존 고객은
--   sms_opt_in 이 NULL 로 남음. 자동발송 Edge Fn(send-notification)은
--   sms_opt_in === false 일 때만 SKIP → NULL 은 필터에 안 걸려 과거 거부고객이
--   여전히 자동발송 대상. 이 갭을 sms_opt_in=false 로 일괄 보정해 발송 제외.
--   (부모: T-20260609-foot-CHART-CONSENT-ALIGN-SMS — 신규/차트편집분은 이미 정합)
--
-- 근거:
--   · 자동발송 Edge Fn: supabase/functions/send-notification/index.ts L760-769
--       → `if (cust.sms_opt_in === false) { SKIP }` (sms_opt_in_at 미참조)
--   · 부모 티켓 risk_reason 4/5: 과거데이터 일괄변환을 본 spinoff 로 위임
--   · 정보통신망법(수신거부자 발송 금지) 부합 — 발송 차단 방향, compliance positive
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- AC5 — sms_opt_in_at 채움 정책 = NULL (NOT now())  ★ dev-foot 확정
-- ----------------------------------------------------------------------------
-- 대조 결과:
--  (1) 발송 제외 판정 영향: 없음. Edge Fn 은 sms_opt_in===false 만 읽고
--      sms_opt_in_at 은 참조 안 함(grep 전수 확인: send-notification 에 sms_opt_in_at 0건).
--      → "발송 제외 판정에 영향 없으면 now() 허용" 조건은 형식상 충족.
--  (2) 그러나 코드베이스 불변식(T-20260602-foot-CONSENT-TIMESTAMP-COLS 계약)은
--      "동의(true) → 시각 기록 / 미동의(false) → NULL". 전(全) write 사이트가 강제:
--        · CustomerChartPage.tsx L2950  : sms_opt_in_at = newVal ? now() : null
--        · SelfCheckIn.tsx     L1213/1236: sms_opt_in_at = smsOptIn ? now() : null
--      sms_opt_in_at 의 의미 = "수신 '동의' 시각". false(거부) 행에 now() 를 채우면
--      어떤 UI/토글도 만들 수 없는 모순 상태 → 불변식 파손.
--  → 결론: 백필도 false 행이므로 sms_opt_in_at = NULL 로 두어 불변식 유지.
--    (대상 행은 애초에 sms_opt_in_at IS NULL 이므로 명시 SET NULL 은 방어적 no-op.)
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- DRY-RUN (READ-ONLY) — 영향 row count 선확정. supervisor 가 이 값을 김주연/대표에게 제시(AC1).
--   ※ 본 SELECT 는 mutation 아님 — 게이트 제시용으로 먼저 단독 실행.
-- ───────────────────────────────────────────────────────────────────────────
-- SELECT count(*) AS affected_rows
--   FROM public.customers
--  WHERE sms_reject = true AND sms_opt_in IS NULL;
--   → 이 count 를 dry_run_report.md 의 [affected_rows] 칸에 기입 후 게이트 확인.

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — BACKUP (역연산 스냅샷). mutation 이전 반드시 실행(AC3 rollback 전제).
--   변경 대상 id + 원본 sms_opt_in/sms_opt_in_at 값을 백업 테이블에 보존.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._datafix_bk_T20260610_sms_optin_reject (
  id            uuid PRIMARY KEY,
  sms_opt_in    boolean,
  sms_opt_in_at timestamptz,
  sms_reject    boolean,
  captured_at   timestamptz DEFAULT now()
);

INSERT INTO public._datafix_bk_T20260610_sms_optin_reject (id, sms_opt_in, sms_opt_in_at, sms_reject)
SELECT id, sms_opt_in, sms_opt_in_at, sms_reject
  FROM public.customers
 WHERE sms_reject = true AND sms_opt_in IS NULL
ON CONFLICT (id) DO NOTHING;
-- 기대: dry-run count 와 동일한 row 수 백업(원본 sms_opt_in=NULL 보존).
-- 검증(백업 행수 = dry-run count 일치 확인):
--   SELECT count(*) FROM public._datafix_bk_T20260610_sms_optin_reject;

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- BACKFILL — 과거 수신거부 고객 자동발송 제외 정합
--   조건: sms_reject=true AND sms_opt_in IS NULL  (AC2: 이 조건 외 row 미변경)
--   SET  : sms_opt_in=false (발송 제외 판정 핵심) + sms_opt_in_at=NULL (AC5 불변식 유지)
--   가드 : sms_opt_in IS NULL 재확인으로 이미 false/true 인 행 보존(AC2 멱등).
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.customers
   SET sms_opt_in    = false,
       sms_opt_in_at = NULL
 WHERE sms_reject = true
   AND sms_opt_in IS NULL;
-- 기대: dry-run count 와 동일한 row UPDATE.
--   (행수 불일치 시 → 즉시 ROLLBACK 후 재검토. dry-run 과 백필 사이 데이터 변동 의심.)

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- AC4 — 실행 후 검증 (supervisor GO·실행 후)
--   ① polarity 갭 0 확인:
--      SELECT count(*) FROM public.customers
--       WHERE sms_reject=true AND sms_opt_in IS NULL;     -- 기대: 0
--   ② 보정된 행이 모두 false 인지:
--      SELECT count(*) FROM public.customers
--       WHERE sms_reject=true AND sms_opt_in IS DISTINCT FROM false; -- 기대: 0
--   ③ AC2 비변경 보존 — 백필 대상 외(이미 false/true) 행수 불변(스냅샷 대조).
--   ④ 자동발송 Edge Fn 제외 확인: 보정 고객 customer_id 로 send-notification 호출 시
--      `{ "skipped": "sms_opt_in=false" }` 응답(L766) — 운영 검증은 supervisor.
-- ───────────────────────────────────────────────────────────────────────────

-- 백업 테이블 정리는 롤백 불요 확정(소크 후) 시 별도 수행:
--   DROP TABLE IF EXISTS public._datafix_bk_T20260610_sms_optin_reject;
-- ============================================================================
