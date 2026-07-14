-- ══════════════════════════════════════════════════════════════════
-- T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT — body 일마감 레드페이 탭 cross-CRM READ 기전
--   (foot DB read-path: sibling 뷰 + 전용 read-only role) — ADDITIVE
-- ══════════════════════════════════════════════════════════════════
-- 정본: memory/1_Projects/201_메디빌더_AI도입/da_decision_body_redpay_read_mechanism_20260714.md
--   (DA CONSULT-REPLY GO, MSG-20260714-185604-e5vf). 부모결정=da_decision_body_redpay_center_column.
--
-- 배경: payment_reconciliation_log = obliv-foot-crm 소유 단일 물리테이블. center 컬럼(부모결정,
--   commit ca8d1d40 POLLER 마이그 20260714170000)으로 foot/body 행을 단일 테이블에서 구분. body
--   일마감 레드페이 탭(obliv-body-crm)이 center='body' 행을 cross-CRM READ 로 소비해야 하나, body
--   세션은 foot GoTrue 계정 부재 + foot RLS(clinic 스코프) + body-facing 뷰 부재로 구조적 도달 불가.
--   DA 확정 기전 = 옵션(a): foot DB에 center='body' 하드코딩 필터 sibling 뷰 + 전용 read-only role,
--   body 는 서버사이드 홉(body Edge Function BFF)으로만 소비(크리덴셜 FE 번들 미노출).
--
-- ── 본 마이그 산출물 (foot DB 대상 — ⚠ body DB 아님. 둘 다 신규·ADDITIVE) ──────────────────
--   1. VIEW  public.v_redpay_reconciliation_body  (security_barrier=true, owner-rights)
--        · WHERE center='body' 하드코딩 리터럴(⛔파라미터 금지 — 조작 시 cross-tenant 유출).
--        · 노출 = recon 필드 화이트리스트(거래일시·금액·trxid·merchant·승인/취소상태). center 컬럼 미노출.
--        · 부모결정 foot 뷰(v_redpay_reconciliation_daily = 풋 merchant_id 17 하드필터)와 대칭 쌍:
--          서로 다른 필터의 독립 두 뷰(파라미터 공유 금지). center='foot' 행은 이 뷰 표면에서 구조적 미도달.
--   2. ROLE  body_recon_ro  (LOGIN·NOSUPERUSER·NOCREATE*·NOBYPASSRLS, default_transaction_read_only=on)
--        · SELECT ON v_redpay_reconciliation_body 만. base 테이블/foot 뷰 grant 0.
--        · scalp doai_ext_readonly SOP 재사용(단 내부용 → BYPASSRLS·k5억제·집계 shape 불요).
--        · ⚠ 패스워드(크리덴셜) 생성 + body EF secret 안전 전달 = supervisor(vault). 본 마이그는
--          role 객체 + grant 까지. 패스워드 미설정 → 전달 전까지 로그인 불가(안전).
--
-- ── 격리 3중 구조 (center='foot' 절대 미노출 — supervisor deploy-precheck 4점 대상) ──────────
--   (1) 뷰 하드필터: WHERE center='body' 리터럴 + security_barrier → foot 행 구조적 진입 불가.
--   (2) role grant 제한: body_recon_ro = 이 뷰 SELECT only. base/foot뷰 grant 0 → 크리덴셜 탈취
--       상한 = center='body' 뿐. center 컬럼 raw 도 미노출.
--   (3) 크리덴셜 서버사이드 봉인: body EF secret 만 존재, FE 번들 0 (dev-body side 검증).
--
-- ── 배포 순서 (★엄수, da_decision §배포순서 + 티켓 deploy_order_note) ────────────────────────
--   1) T-20260711-foot-REDPAY-TERMINAL-REGISTRY deployed
--   2) T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER(center DDL 20260714170000 + 폴러, ca8d1d40) deployed
--      = payment_reconciliation_log.center 실존 + center='body' 행 실존
--   3) ★본 마이그 deployed★  (center 컬럼 없으면 뷰 생성 실패 — 선결 필수)
--   4) supervisor 크리덴셜 생성 + body EF secret 전달
--   5) dev-body EF BFF + FE 실데이터 배선
--   → 본 뷰/role 은 부모결정 POLLER center DDL 과 1 deploy unit 권고(DA §Q3 L85).
--
-- risk: GO_WARN(DA) — ADDITIVE(신규 뷰/role/grant, DROP·타입변경·enum제거 0). 대표 게이트 면제
--   (autonomy §3.1, ADDITIVE + DA CONSULT GO) → supervisor DDL-diff + deploy-precheck 4점 격리 실측.
-- MIG-GATE: db_change=true. mig_files/mig_dryrun/mig_ledger_check/mig_rollback 4필드 deploy-ready 전 기입.
-- Rollback: 20260714210000_redpay_body_recon_view_grant.rollback.sql (DROP VIEW + DROP ROLE, 전량 가역).
-- ══════════════════════════════════════════════════════════════════

-- ── 1. 전용 read-only role body_recon_ro (멱등: 존재 체크) ──────────────────────────
--   LOGIN(EF 직접 접속용) + 최소권한. 패스워드 미설정(supervisor 서브스텝). NOBYPASSRLS(내부용).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'body_recon_ro') THEN
    CREATE ROLE body_recon_ro
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END$$;

-- read-only 강제: 세션 기본 트랜잭션 read-only(쓰기 시도 자체 차단). 멱등(ALTER SET).
ALTER ROLE body_recon_ro SET default_transaction_read_only = on;

COMMENT ON ROLE body_recon_ro IS
  'T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT: body 일마감 레드페이 탭 cross-CRM READ 전용 role. '
  'SELECT ON v_redpay_reconciliation_body 만(base/foot뷰 grant 0). 내부 동일법인(obliv-origin) row-level '
  '소비. 패스워드=supervisor(vault) 서브스텝. body EF secret 서버사이드 봉인(FE 번들 0).';

-- ── 2. sibling 뷰 v_redpay_reconciliation_body (center='body' 하드필터 + security_barrier) ──────
--   owner-rights(security_invoker 미지정=owner) — body_recon_ro 는 GoTrue/clinic RLS 컨텍스트 부재이므로
--   호출자 RLS 가 아닌 뷰 소유자 권한으로 center='body' 전량을 표면화(격리는 WHERE 리터럴 + role grant).
--   security_barrier=true → 호출자 술어가 WHERE center='body' 이전에 평가되어 filtered-out 행 누출 차단.
--   ⛔ SELECT * 금지 — 명시 화이트리스트만. ⛔ center 컬럼 미노출.
CREATE OR REPLACE VIEW public.v_redpay_reconciliation_body
WITH (security_barrier = true) AS
SELECT
  l.id                                                          AS row_id,
  l.clinic_id                                                   AS clinic_id,
  (COALESCE(r.approved_at, l.created_at) AT TIME ZONE 'Asia/Seoul')::date  AS close_date,
  r.approved_at                                                 AS approved_at,      -- 거래일시(승인)
  r.cancelled_at                                                AS cancelled_at,     -- 취소 일시
  l.external_trxid                                              AS external_trxid,   -- trxid
  COALESCE(r.external_status, l.raw_payload->>'external_status') AS external_status, -- 승인/취소 상태 Y/N/M/X
  r.tid                                                         AS tid,
  COALESCE(r.raw_payload->'merchant'->>'id',
           l.raw_payload->'merchant'->>'id')                    AS merchant_id,      -- merchant
  COALESCE(r.raw_payload->'merchant'->>'name',
           l.raw_payload->'merchant'->>'name')                  AS merchant_name,
  l.external_amount::numeric                                    AS van_amount,       -- 금액(VAN)
  l.crm_amount::numeric                                         AS crm_amount,       -- 금액(CRM)
  p.method                                                      AS crm_method,
  l.event_type                                                  AS recon_status,     -- recon 이벤트/상태
  l.match_rule                                                  AS match_rule,
  l.mismatch_reason                                             AS mismatch_reason,
  l.created_at                                                  AS logged_at
FROM public.payment_reconciliation_log l
LEFT JOIN public.redpay_raw_transactions r ON r.id = l.raw_transaction_id
LEFT JOIN public.payments               p ON p.id = l.payment_id
WHERE l.center = 'body';   -- ★하드코딩 리터럴★ (파라미터 아님 — 호출자 조작 불가, center='foot' 구조적 미도달)

COMMENT ON VIEW public.v_redpay_reconciliation_body IS
  'T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT: body 일마감 레드페이 탭 cross-CRM READ 전용 뷰. '
  'payment_reconciliation_log WHERE center=''body'' 하드필터(리터럴) + security_barrier. '
  '노출=recon 화이트리스트(거래일시·금액·trxid·merchant·승인/취소상태). center 컬럼·center=''foot'' 행 미노출. '
  '부모결정 foot 뷰(v_redpay_reconciliation_daily=풋 merchant_id 17 하드필터)와 대칭 쌍(파라미터 공유 금지). '
  'body_recon_ro(전용 read-only role)만 SELECT — body EF BFF 서버사이드 홉으로 소비.';

-- ── 3. GRANT — 뷰 SELECT-only, base 테이블·foot 뷰 grant 0 (격리 (2)) ──────────────────────
--   default-deny 재확인: 내부 role(PUBLIC/anon/authenticated)에서 이 뷰 회수 → foot 세션 도달 0.
REVOKE ALL ON public.v_redpay_reconciliation_body FROM PUBLIC;
REVOKE ALL ON public.v_redpay_reconciliation_body FROM anon;
REVOKE ALL ON public.v_redpay_reconciliation_body FROM authenticated;

-- body_recon_ro 에만 뷰 SELECT + 스키마 USAGE(뷰 참조 최소 요건). base 테이블 grant 절대 부여 안 함.
GRANT USAGE  ON SCHEMA public                       TO body_recon_ro;
GRANT SELECT ON public.v_redpay_reconciliation_body TO body_recon_ro;

-- ── 4. 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시) ──────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260714210000', 'redpay_body_recon_view_grant')
ON CONFLICT (version) DO NOTHING;

-- ── 적용 검증 쿼리 (참고 — supervisor deploy-precheck 4점) ──────────────────────────────────
-- (i)   뷰 리터럴+미노출: SELECT pg_get_viewdef('public.v_redpay_reconciliation_body'::regclass);  -- WHERE l.center = 'body' 확인
--       SELECT count(*) FROM information_schema.columns
--         WHERE table_schema='public' AND table_name='v_redpay_reconciliation_body' AND column_name='center';  -- MUST 0
-- (ii)  role grant=0: SELECT has_table_privilege('body_recon_ro','public.payment_reconciliation_log','SELECT');  -- MUST false
--       SELECT has_table_privilege('body_recon_ro','public.v_redpay_reconciliation_daily','SELECT');            -- MUST false
--       SELECT has_table_privilege('body_recon_ro','public.v_redpay_reconciliation_body','SELECT');             -- MUST true
-- (iii) FE 번들 크리덴셜 0 = dev-body side (body 레포 grep) — 본 foot 마이그 범위 밖.
-- (iv)  foot 대칭뷰 동시존재: SELECT to_regclass('public.v_redpay_reconciliation_daily');  -- NOT NULL (풋 merchant 하드필터 뷰)
