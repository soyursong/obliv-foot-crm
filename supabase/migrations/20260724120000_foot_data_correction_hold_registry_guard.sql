-- ============================================================
-- T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY
--   hold-registry SSOT 테이블 + DB-enforced BEFORE UPDATE fail-closed 트리거
--   (dummy-normalize corrective hold-aware 가드 · defense-in-depth)
--
-- SSOT(설계): db-gate/T-20260724-foot-DUMMY-NORMALIZE-OOB-HOLD-GUARD_forensics-and-design.md (commit 94da0c74)
-- DA CONSULT-REPLY(GO_CONDITIONAL): MSG-20260724-071451-fbr2
--   정본 결정: agents/docs/da_replies/DA-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY.md
--   verdict = GO_CONDITIONAL (ADDITIVE·단일 CRM foot·cross-product 충돌 0 → 대표 게이트 면제 autonomy §3.1).
--   옵션 (c)주축 + (b)(a)보강 승인 + 9개 하드닝 조건 apply 계약 바인딩(supervisor DB-GATE 집행).
-- 작성: dev-foot / 2026-07-24
-- 롤백: 20260724120000_foot_data_correction_hold_registry_guard.rollback.sql
-- 드라이런(무영속·회귀행렬 6종): 20260724120000_foot_data_correction_hold_registry_guard.dryrun.sql
-- 시드(freeze-window ROW1 등록 템플릿): 20260724120000_foot_data_correction_hold_registry_guard.seed.sql
-- 게이트: supervisor DB-GATE (DDL-diff + dry-run no-persistence[txn-strip+post-probe] + ledger 3자 대조 + 롤백 + 회귀행렬 6종).
--
-- ── 배경 (진원 pin) ─────────────────────────────────────────────────────────
--   07-18/21/22 masked→'DUMMY-'||uuid batch = 사람 operator 의 수동 OOB SQL(git·schema_migrations·pg_cron·
--   서버함수·트리거 전수 배제·READ-ONLY 실증). DA-20260709 가 승인한 것은 bounded one-shot 4행 + insert
--   write-path 뿐 — masked **반복** batch 는 DA 미승인·git 무접점. 그 corrective predicate(masked-phone)가
--   [G0-hold] 행을 인지하지 못해 07-18 sweep 시 ROW1(cleanup/forensics hold 대상) 을 접촉.
--
-- ── 왜 스키마+트리거(구조 가드)인가 ───────────────────────────────────────────
--   corrective 가 *수동·OOB* 이므로 "predicate 한 곳만 고치면 된다"는 성립하지 않음(고정 코드 지점 부재).
--   operator 선의(predicate 에 NOT IN (hold set) 을 매번 넣어주리라는 기대)에 의존하는 (a) 만으로는 불충분.
--   → operator 선의 무의존의 DB-enforced 구조 가드(c) 필요. 이는 data_correction_backfill_sop §0-2 의
--     [G0-hold] 소프트 패턴을 DB 레벨에서 내구화(fail-closed)한 것(= cross-corrective 데이터정책축 진화, DA).
--
-- ── 안전 성질 (ADDITIVE only) ─────────────────────────────────────────────────
--   · 신규 테이블 1 + 신규 함수 1 + 신규 트리거 1. 기존 스키마 변경 0 · 데이터 mutation 0 · 원장 무접점.
--   · 트리거 매치는 좁게: NEW.phone LIKE 'DUMMY-%' AND OLD.phone NOT LIKE 'DUMMY-%'(=dummy-normalize 전이)
--     ∩ active-hold(released_at IS NULL, guard_scope 일치) 교집합에만 EXCEPTION. any-UPDATE 전면 freeze 아님.
--   · early-exit: 전이조건 먼저 평가 → 매치할 때만 레지스트리 조회(customers=hot PHI, 매 UPDATE 조회 금지).
--   · 정상 편집(phone→실번호)·self_checkin(writes_phone_dummy=false)·insert-mint(BEFORE INSERT) = 매치 안 함 → 무영향.
--   · 함수 SECURITY DEFINER(owner=postgres) — 호출자 RLS 컨텍스트와 무관하게 레지스트리를 항상 조회(fail-OPEN 방지).
--   · 롤백 = DROP TRIGGER + DROP FUNCTION + DROP TABLE.
--
-- ── 정직 caveat (DA 판정2, residual) ─────────────────────────────────────────
--   BEFORE UPDATE 트리거는 session_replication_role='replica' / ALTER TABLE ... DISABLE TRIGGER 로 우회 가능.
--   본 가드는 "predicate 망각(우발) → 트리거 의식적 무력화(고의·이례)" 로 진입 장벽을 올리는 defense-in-depth
--   이지 절대 봉인이 아님. (b)ledger·런북 명문화로 보강(db-gate 문서 §(b) 참조). 트리거 disable 자체를 이례
--   이벤트로 취급(향후 audit 훅 후보).
--
-- ── (b) ledger 편입 / (a) predicate 제외 (보강 · db-gate 문서에 SOP 성문화) ──────
--   (b) 향후 masked-normalize corrective 는 committed 스크립트(SOP freeze + before-image + hold-registry
--       pre-check)로만. 수동 직접 SQL 지양을 런북/SOP 에 명문화. (라이브 확인 후 DA 가 data_correction_backfill_sop
--       신규 §(hold-registry)로 cross-CRM 승격 — 판정1 소유.)
--   (a) 그 committed corrective predicate 에 아래 hold 제외 표준 스니펫 이식(트리거와 동일 조건, 이중 방어):
--         UPDATE public.customers c SET phone='DUMMY-'||gen_random_uuid()
--          WHERE <masked predicate>
--            AND NOT EXISTS (SELECT 1 FROM public.data_correction_hold_registry h
--                             WHERE h.target_table='customers' AND h.target_pk=c.id::text
--                               AND h.clinic_id=c.clinic_id
--                               AND h.guard_scope IN ('phone_dummy_normalize','all')
--                               AND h.released_at IS NULL);
-- ============================================================

-- ── (c) hold-registry SSOT 테이블 ─────────────────────────────────────────────
--   grain: 1 row = 1 held (target_table, target_pk, guard_scope). 목적: corrective 공통 pre-check SSOT.
--   DA 개정(판정1) 전량 반영: surrogate PK / partial-unique / target_pk text / released_* / hold_ticket NOT NULL / guard_scope.
CREATE TABLE IF NOT EXISTS public.data_correction_hold_registry (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),               -- surrogate
  clinic_id      uuid NOT NULL,
  target_table   text NOT NULL,                                           -- 테이블-agnostic
  target_pk      text NOT NULL,                                           -- ★ text (cross-table 일반성; 트리거 캐스트)
  guard_scope    text NOT NULL DEFAULT 'phone_dummy_normalize',           -- ★ 가드 클래스(확장 축·over-block 방지)
  hold_ticket    text NOT NULL,                                           -- ★ NOT NULL: 모든 hold 는 티켓 근거 필수(false-freeze 금지)
  reason         text NOT NULL,                                           -- vocabulary: cleanup | forensics | legal-hold
  created_by     text NOT NULL DEFAULT current_user,                      -- best-effort(권위 아님 — caveat)
  created_at     timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz,                                             -- NULL = active hold
  released_by    text,                                                    -- ★ 신설: 해제자 감사
  release_reason text                                                     -- ★ 신설: 해제 근거
);

-- ★ active-hold 중복 방지 + 해제 이력 누적 양립 (partial-unique)
CREATE UNIQUE INDEX IF NOT EXISTS uq_hold_active
  ON public.data_correction_hold_registry (clinic_id, target_table, target_pk, guard_scope)
  WHERE released_at IS NULL;

COMMENT ON TABLE public.data_correction_hold_registry IS
  '진행 중 data-correction cleanup/forensics/legal-hold 대상행 SSOT. corrective 공통 pre-check 소스. '
  'active hold(released_at IS NULL) 행에 대한 dummy-normalize UPDATE 를 fn_data_correction_hold_guard 트리거가 fail-closed 차단. '
  '테이블=foot-local, 계약=DA 소유 cross-CRM 표준(라이브 후 data_correction_backfill_sop §hold-registry fold). '
  '[T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY / DA MSG-20260724-071451-fbr2]';
COMMENT ON COLUMN public.data_correction_hold_registry.guard_scope IS
  '가드 클래스 축. dummy-normalize 가드는 phone_dummy_normalize|all 만 매치. 향후 corrective 클래스는 자기 scope 로 등록(트리거 over-block 방지).';
COMMENT ON COLUMN public.data_correction_hold_registry.target_pk IS
  'held 행의 PK 를 text 로 저장(cross-table 일반성). customers 는 id::text.';

-- 거버넌스 테이블 — 클라이언트(anon/authenticated) 노출 금지. RLS enable(정책 0 = deny),
-- service_role/postgres(트리거 DEFINER 포함)는 RLS bypass 로 정상 접근. PHI 아님(uuid ref + 티켓 + 사유).
ALTER TABLE public.data_correction_hold_registry ENABLE ROW LEVEL SECURITY;

-- ── (c) DB-enforced BEFORE UPDATE fail-closed 가드 함수 ─────────────────────────
--   SECURITY DEFINER: 호출자 RLS 와 무관하게 레지스트리 조회(비-service 컨텍스트에서도 fail-closed 보장).
CREATE OR REPLACE FUNCTION public.fn_data_correction_hold_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hold_ticket text;
BEGIN
  -- ① early-exit(hot-path): dummy-normalize 전이(phone→DUMMY)가 아니면 레지스트리 조회 없이 통과.
  --    정상 편집/실번호/self_checkin/insert-mint = 이 조건에서 걸러짐.
  IF NEW.phone IS NULL
     OR NEW.phone NOT LIKE 'DUMMY-%'
     OR (OLD.phone IS NOT NULL AND OLD.phone LIKE 'DUMMY-%') THEN
    RETURN NEW;
  END IF;

  -- ② 전이 매치 → 이 행에 대한 active hold 를 guard_scope 범위에서 조회.
  SELECT h.hold_ticket
    INTO v_hold_ticket
    FROM public.data_correction_hold_registry h
   WHERE h.target_table = TG_TABLE_NAME
     AND h.target_pk    = OLD.id::text
     AND h.clinic_id    = OLD.clinic_id
     AND h.guard_scope  IN ('phone_dummy_normalize', 'all')
     AND h.released_at  IS NULL
   LIMIT 1;

  -- ③ active hold 존재 → fail-closed 차단(명료 EXCEPTION: hold_ticket·target_pk 포함).
  IF v_hold_ticket IS NOT NULL THEN
    RAISE EXCEPTION
      'data-correction hold active: % row under active hold is protected from phone->DUMMY normalize (target_pk=%, hold_ticket=%). Release the hold in data_correction_hold_registry before this corrective.',
      TG_TABLE_NAME, OLD.id::text, v_hold_ticket
      USING ERRCODE = 'raise_exception',
            HINT = 'UPDATE public.data_correction_hold_registry SET released_at=now(), released_by=..., release_reason=... WHERE ... AND released_at IS NULL;';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_data_correction_hold_guard() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_data_correction_hold_guard() IS
  'dummy-normalize corrective hold-aware fail-closed 가드. customers.phone→DUMMY 전이 ∩ active-hold(data_correction_hold_registry) '
  '교집합에만 RAISE EXCEPTION. early-exit(전이 먼저) · SECURITY DEFINER(fail-OPEN 방지) · defense-in-depth(절대봉인 아님, DISABLE TRIGGER 우회가능). '
  '[T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY / DA MSG-20260724-071451-fbr2 판정2]';

-- BEFORE UPDATE OF phone: phone 변경 UPDATE 에서만 발화(추가 hot-path 최적화).
DROP TRIGGER IF EXISTS trg_data_correction_hold_guard ON public.customers;
CREATE TRIGGER trg_data_correction_hold_guard
  BEFORE UPDATE OF phone ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_data_correction_hold_guard();

NOTIFY pgrst, 'reload schema';

-- ── 검증 DO 블록 (객체 생성 확인) ────────────────────────────────────────────
DO $$
BEGIN
  PERFORM 1 FROM information_schema.tables
   WHERE table_schema='public' AND table_name='data_correction_hold_registry';
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLD-GUARD 검증 실패: hold-registry 테이블 미생성'; END IF;

  PERFORM 1 FROM pg_indexes
   WHERE schemaname='public' AND indexname='uq_hold_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLD-GUARD 검증 실패: uq_hold_active partial-unique 미생성'; END IF;

  PERFORM 1 FROM pg_trigger
   WHERE tgname='trg_data_correction_hold_guard' AND NOT tgisinternal;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLD-GUARD 검증 실패: BEFORE UPDATE 트리거 미생성'; END IF;

  RAISE NOTICE 'HOLD-GUARD [c]: hold-registry 테이블 + partial-unique + fail-closed 트리거 생성 검증 통과(ADDITIVE, 데이터 mutation 0).';
END $$;
