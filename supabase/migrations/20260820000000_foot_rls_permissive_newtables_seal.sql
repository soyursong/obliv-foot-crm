-- ============================================================================
-- T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (leg2) · UP
--   §C-3 named-7 밖 신규 PHI/금융 5테이블(Q1) + config/reference (A)/(C)(Q2)
--   RESTRICTIVE clinic-gate / anon-deny SEAL. 부모 named-7 SEAL(20260819230000)의
--   자매 leg — distinct 테이블(stomp 없음).
--
--   DA SSOT: da_decision_foot_rls_permissive_newtables_clinicgate_seal_20260819.md
--            (부모 da_decision_xcrm_rls_permissive_clinicgate_seal_20260723.md §A/§C)
--   census : _artifacts/T-20260819-foot-RLS-NEWTABLES-SEAL_census_evidence.md
--            (러너 scripts/T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL_census.mjs, 2026-08-20 prod)
--
--   change-class = exposure-REDUCING ADDITIVE(§A canonical):
--     permissive DROP 0 → RESTRICTIVE 신설으로 cross-clinic/anon 도달 AND-차단.
--     데이터 mutation 0 · DDL=CREATE POLICY only · 완전가역(DROP 1줄/정책).
--     → CEO 파괴게이트 §3.1 면제(exposure 축소·mutation0·신규 컬럼/타입/enum/테이블 0).
--
-- ── 게이트 (db_change=true) ────────────────────────────────────────────────────
--   Gate-B(DA CONSULT-REPLY MSG-20260819-232851-tcs9: Q1 WITHIN-ENVELOPE GO / Q2
--     3-way partition) GO ≠ apply 허가.
--   ⚠ CREATE POLICY = DDL → DDL-0 carve 아님 → supervisor DB-GATE(DDL-diff + GO-token)
--     물리 선행 필수(AC-1 불변, apply-gate=supervisor NOT DA). GO-token 前 prod DDL
--     선집행 금지(apply_before_go, deploy-precheck C20). 부모 named-7 SEAL 과 동일 foot RLS
--     lane → supervisor 가 GO-token 발행 순서 조정.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- ★ per-table READ-ONLY census 확정 (2026-08-20 prod, WRITE0/DDL0)
--   [clinics] jongno-foot=data-bearing(2517/70) · songdo-foot=LATENT(0/0)
--     → 실 cross-tenant read 대상 부재 = P0 미충족·forward-protective·회귀0(effective 단일 active).
--
--   ── Q1 신규 PHI/금융 5테이블 (direct clinic_id anchor·§A-3 캐노니컬) ──
--     ① health_maintenance_balances 금융잔액 · auth_all ALL true · clinic_id NOT NULL 0/0 · ALL
--     ② payment_audit_logs         결제감사 · payment_audit_logs_open ALL true · clinic_id nullable 0NULL/10(jongno)
--          → ★SELECT read-seal: SECDEF trigger 부재(G_pal census=[]) + FE INSERT `clinic_id: payment.clinic_id ?? null`
--            (nullable) → ALL WITH CHECK 시 정당 감사 INSERT 파손(H3 REJECT) → read 누수만 봉쇄(DA 옵션).
--     ③ receipt_ocr_results        영수증OCR · auth_all ALL true · clinic_id nullable 0/0 · ALL
--          (write-path `if(!clinicId) return`+stamp·non-fatal catch → WITH CHECK 안전)
--     ④ claim_diagnoses            보험PHI청구 · claim_diagnoses_auth_all ALL true · clinic_id nullable 0/0 · ALL
--          (client write-path 0 · EF service_role=BYPASSRLS → WITH CHECK 무영향)
--     ⑤ handover_notes             임상인계 · handover_notes_select SELECT true(+INSERT check=true write-open)
--                                  · clinic_id NOT NULL 0/41(jongno) · ALL (consultation_notes 동형)
--
--   ── Q2 (A) config seal (per-clinic 운영/임상 config · clinic_id NOT NULL 0 NULL) ──
--     ⑥ diagnosis_folders  · write ALL true → ALL · NOT NULL 0/2(distinct1)
--     ⑦ diagnosis_sets     · write ALL true → ALL · NOT NULL 0/1
--     ⑧ notices            · write open(insert clinic-gate·update/delete true) → ALL · NOT NULL 0/1(per-clinic insert gate)
--     ⑨ room_role_mapping  · write 이미 clinic-gate·SELECT-only universal → SELECT · NOT NULL 0/4 (anon 旣봉인)
--
--   ── Q2 (C) anon 즉시봉쇄 (anon-도달 + 기존 anon_deny 부재 + legit anon 소비자 0) ──
--     ⑩ code_availability              · {anon,authenticated} SELECT true · anon 소비자 0(hooks=authed·RPC=SECDEF)
--     ⑪ redpay_unregistered_line_seen  · {public} SELECT true · 소비자 0(dead) · NULL clinic=1(clinic-gate=(B) 제외, anon만 봉쇄)
--          foot 캐노니컬 anon-deny 패턴(form_templates_anon_deny/package_tiers_anon_deny 동형) 재사용.
--
--   ── EXCLUDE (본 SEAL 밖·census evidence 기록) ──
--     (B) carve-out: redpay_terminal_registry(NULL18 org-global·anon旣봉인) · package_tiers(shared catalog·anon旣봉인)
--     governance(planner FOLLOWUP): form_templates(org-std vs per-clinic) · treatment_sets · quick_rx_buttons
--                                   · code_availability authenticated축 · timer_records(clinic_id TEXT type anomaly)
--     lane b: waiting_board(LEGIT anon 공개대기판 Waiting.tsx:120 → blanket 봉쇄 시 파손·T-20260810 HOLD)
--
-- ── clinic-anchor predicate (§A-3 캐노니컬 byte-identical) ──────────────────────
--   `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()`
--   ⚠️ admin bypass = is_admin_or_manager()(foot 캐노니컬) · crm get_user_role()='admin' 미사용.
--
-- ── RESTRICTIVE 의미(왜 안전) ─────────────────────────────────────────────────
--   PG RLS: RESTRICTIVE 는 TO 명시 롤에만 적용 · permissive 와 AND.
--     clinic-gate(TO authenticated): SELECT permissive(true) AND restrictive(own|admin) → 타clinic 0-row.
--       ALL: write permissive(role) AND restrictive(own|admin, USING+CHECK) → 타clinic write 차단.
--     anon-deny(TO anon, false): anon permissive(true) AND restrictive(false) → anon 차단.
--   anon(clinic-gate 정책) / authenticated(anon-deny 정책) = TO 롤 미포함 → 무영향.
--   service_role=BYPASSRLS · SECURITY DEFINER RPC=definer 컨텍스트 → 무영향.
--   permissive 전량 존치(ADDITIVE) → rollback = DROP restrictive 1줄/정책.
--
--   down    : 20260820000000_foot_rls_permissive_newtables_seal.rollback.sql
--   dryrun  : 20260820000000_foot_rls_permissive_newtables_seal.dryrun.mjs (무영속·post-probe)
-- 작성: dev-foot / 2026-08-20
-- ============================================================================

-- ── (0) PREFLIGHT: 대상 실재 + RLS ENABLE + helper 실재 + H3 NULL 0 + 멱등 ────────
DO $preflight$
DECLARE
  v_tbl       text;
  v_null_rows bigint;
  -- clinic-gate 대상(NULL clinic_id 잔존 0 이어야 하는 테이블): Q1 5 + Q2(A) 4
  v_gate_tbls text[] := ARRAY['health_maintenance_balances','payment_audit_logs','receipt_ocr_results',
                              'claim_diagnoses','handover_notes',
                              'diagnosis_folders','diagnosis_sets','notices','room_role_mapping'];
  -- 전 대상(anon-deny 2 포함): 실재/RLS 확인용
  v_all_tbls  text[] := ARRAY['health_maintenance_balances','payment_audit_logs','receipt_ocr_results',
                              'claim_diagnoses','handover_notes',
                              'diagnosis_folders','diagnosis_sets','notices','room_role_mapping',
                              'code_availability','redpay_unregistered_line_seen'];
BEGIN
  -- 대상 11테이블 실재 (wrong-DB 오적용 방지)
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY(v_all_tbls)) <> 11 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 11테이블 중 일부 부재 — wrong DB?';
  END IF;
  -- RLS ENABLE 전제 (restrictive 는 RLS ON 에서만 유효)
  IF (SELECT count(*) FROM pg_class
        WHERE relnamespace='public'::regnamespace
          AND relname = ANY(v_all_tbls) AND relrowsecurity) <> 11 THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 대상 중 RLS 미활성 테이블 존재 — restrictive 무효';
  END IF;
  -- canonical resolver 실재 (clinic-gate 술어 의존)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — 술어 해소 불가';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_admin_or_manager') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_admin_or_manager() 부재 — admin bypass 해소 불가';
  END IF;
  -- ★ H3 재확인(apply 시점 drift 가드): clinic-gate 대상 각 테이블 clinic_id IS NULL 잔존 0.
  --   (silent lockout 금지 — NULL 발생 시 백필/재census 선행 후 재적용)
  FOREACH v_tbl IN ARRAY v_gate_tbls LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE clinic_id IS NULL', v_tbl)
      INTO v_null_rows;
    IF v_null_rows <> 0 THEN
      RAISE EXCEPTION 'PREFLIGHT_FAIL: %.clinic_id IS NULL = % (>0) — 백필/재census 선행 필요, SEAL 금지(H3 게이트)', v_tbl, v_null_rows;
    END IF;
  END LOOP;
  -- 멱등/재실행 안전: 신설 정책 이미 존재 시 abort (중복 CREATE 방지)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
               AND policyname IN ('health_maintenance_balances_clinic_gate_restrict',
                                  'payment_audit_logs_clinic_read_restrict',
                                  'receipt_ocr_results_clinic_gate_restrict',
                                  'claim_diagnoses_clinic_gate_restrict',
                                  'handover_notes_clinic_gate_restrict',
                                  'diagnosis_folders_clinic_gate_restrict',
                                  'diagnosis_sets_clinic_gate_restrict',
                                  'notices_clinic_gate_restrict',
                                  'room_role_mapping_clinic_read_restrict',
                                  'code_availability_anon_deny',
                                  'redpay_unregistered_line_seen_anon_deny')) THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: 신설 정책 이미 존재 — 재적용 abort';
  END IF;
END $preflight$;

-- ══════════════════════════════════════════════════════════════════════════════
-- Q1 — 신규 PHI/금융 5테이블 (direct clinic_id anchor §A-3)
-- ══════════════════════════════════════════════════════════════════════════════

-- ① health_maintenance_balances (금융 잔액) : RESTRICTIVE ALL clinic-gate
CREATE POLICY "health_maintenance_balances_clinic_gate_restrict" ON public.health_maintenance_balances
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "health_maintenance_balances_clinic_gate_restrict" ON public.health_maintenance_balances IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2): cross-clinic 금융잔액 격리(ADDITIVE RESTRICTIVE §A). '
  'auth_all(true) AND-차단(own-clinic|admin read+write). clinic_id NOT NULL. anon/service_role/SECDEF 무영향. rollback=DROP 1줄.';

-- ② payment_audit_logs (결제 감사) : RESTRICTIVE SELECT read-seal (audit immutability)
--    ★WITH CHECK 미부여 — SECDEF trigger 부재 + FE INSERT clinic_id nullable(?? null) → ALL 시 감사 INSERT 파손(H3).
--    read 누수만 봉쇄(DA "SELECT read-seal 로 충분" 옵션). INSERT 경로 무영향.
CREATE POLICY "payment_audit_logs_clinic_read_restrict" ON public.payment_audit_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "payment_audit_logs_clinic_read_restrict" ON public.payment_audit_logs IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2): cross-clinic 감사로그 read 격리(ADDITIVE RESTRICTIVE SELECT §A-2). '
  'audit immutability: WITH CHECK 미부여(clinic_id nullable INSERT `?? null` 파손 회피·SECDEF trigger 부재). '
  'payment_audit_logs_open(true) AND-차단(read only). INSERT/UPDATE/DELETE 무영향. rollback=DROP 1줄.';

-- ③ receipt_ocr_results (영수증 OCR) : RESTRICTIVE ALL clinic-gate
CREATE POLICY "receipt_ocr_results_clinic_gate_restrict" ON public.receipt_ocr_results
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "receipt_ocr_results_clinic_gate_restrict" ON public.receipt_ocr_results IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2): cross-clinic 영수증OCR 격리(ADDITIVE RESTRICTIVE §A). '
  'auth_all(true) AND-차단. write-path clinic_id stamp(if(!clinicId) return)+non-fatal catch. anon/service_role/SECDEF 무영향. rollback=DROP 1줄.';

-- ④ claim_diagnoses (보험 PHI 청구진단) : RESTRICTIVE ALL clinic-gate
CREATE POLICY "claim_diagnoses_clinic_gate_restrict" ON public.claim_diagnoses
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "claim_diagnoses_clinic_gate_restrict" ON public.claim_diagnoses IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2): cross-clinic 보험PHI청구진단 격리(ADDITIVE RESTRICTIVE §A). '
  'claim_diagnoses_auth_all(true) AND-차단. client write-path 0(EF service_role=BYPASSRLS). anon/SECDEF 무영향. rollback=DROP 1줄.';

-- ⑤ handover_notes (임상 인계) : RESTRICTIVE ALL clinic-gate
CREATE POLICY "handover_notes_clinic_gate_restrict" ON public.handover_notes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "handover_notes_clinic_gate_restrict" ON public.handover_notes IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2): cross-clinic 임상인계 격리(ADDITIVE RESTRICTIVE §A). '
  'handover_notes_select(true) AND-차단(author_id write-gate 존치·clinic-gate 상위 AND). clinic_id NOT NULL. rollback=DROP 1줄.';

-- ══════════════════════════════════════════════════════════════════════════════
-- Q2 (A) — config/reference per-clinic seal
-- ══════════════════════════════════════════════════════════════════════════════

-- ⑥ diagnosis_folders : RESTRICTIVE ALL clinic-gate (write ALL true → ALL)
CREATE POLICY "diagnosis_folders_clinic_gate_restrict" ON public.diagnosis_folders
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "diagnosis_folders_clinic_gate_restrict" ON public.diagnosis_folders IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2·Q2-A): per-clinic 진단폴더 격리(ADDITIVE RESTRICTIVE §A). '
  'clinic_id NOT NULL. permissive 존치·AND-차단. rollback=DROP 1줄.';

-- ⑦ diagnosis_sets : RESTRICTIVE ALL clinic-gate
CREATE POLICY "diagnosis_sets_clinic_gate_restrict" ON public.diagnosis_sets
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "diagnosis_sets_clinic_gate_restrict" ON public.diagnosis_sets IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2·Q2-A): per-clinic 진단세트 격리(ADDITIVE RESTRICTIVE §A). '
  'clinic_id NOT NULL. permissive 존치·AND-차단. rollback=DROP 1줄.';

-- ⑧ notices : RESTRICTIVE ALL clinic-gate (write open → ALL·per-clinic insert gate 존치)
CREATE POLICY "notices_clinic_gate_restrict" ON public.notices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager())
  WITH CHECK ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "notices_clinic_gate_restrict" ON public.notices IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2·Q2-A): per-clinic 공지 격리(ADDITIVE RESTRICTIVE §A). '
  'clinic_id NOT NULL·per-clinic insert gate 존치. anon SELECT 부재. rollback=DROP 1줄.';

-- ⑨ room_role_mapping : RESTRICTIVE SELECT clinic-gate (write 이미 clinic-gate → SELECT-only)
CREATE POLICY "room_role_mapping_clinic_read_restrict" ON public.room_role_mapping
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());
COMMENT ON POLICY "room_role_mapping_clinic_read_restrict" ON public.room_role_mapping IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2·Q2-A): per-clinic room-role read 격리(ADDITIVE RESTRICTIVE SELECT §A-2). '
  'room_role_read(true) AND-차단. write=room_role_write(旣 clinic-gate)→SELECT-only grain. anon=旣 anon_deny. clinic_id NOT NULL. rollback=DROP 1줄.';

-- ══════════════════════════════════════════════════════════════════════════════
-- Q2 (C) — anon 즉시봉쇄 (foot 캐노니컬 anon-deny 패턴 재사용)
--   authenticated read 보존 · anon 만 차단(미인증 누수). isolation-intent(A vs B) 독립.
-- ══════════════════════════════════════════════════════════════════════════════

-- ⑩ code_availability : anon-deny (legit anon 소비자 0 — hooks=authed·RPC=SECDEF)
CREATE POLICY "code_availability_anon_deny" ON public.code_availability
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMENT ON POLICY "code_availability_anon_deny" ON public.code_availability IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2·Q2-C): anon 미인증 누수 봉쇄(ADDITIVE RESTRICTIVE §C-4). '
  'code_availability_select({anon,auth} true) 中 anon 만 AND-차단. authenticated read 보존. legit anon 소비자 0. rollback=DROP 1줄.';

-- ⑪ redpay_unregistered_line_seen : anon-deny (소비자 0·NULL clinic → clinic-gate=(B) 제외, anon만 봉쇄)
CREATE POLICY "redpay_unregistered_line_seen_anon_deny" ON public.redpay_unregistered_line_seen
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMENT ON POLICY "redpay_unregistered_line_seen_anon_deny" ON public.redpay_unregistered_line_seen IS
  'T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL(leg2·Q2-C): anon 미인증 누수 봉쇄(ADDITIVE RESTRICTIVE §C-4). '
  'redpay_unregistered_line_seen_read_all({public} true) 中 anon 만 AND-차단. clinic-gate=(B) org-global 제외(NULL clinic_id). rollback=DROP 1줄.';

-- ── (VERIFY) 착지 상태 실증 (실패 시 abort — 무영속) ──────────────────────────────
DO $verify$
DECLARE
  v_all_cnt    int;  -- ALL-grain clinic-gate restrictive
  v_sel_cnt    int;  -- SELECT-grain clinic-gate restrictive
  v_anon_cnt   int;  -- anon-deny restrictive
  v_permissive int;  -- ADDITIVE 불변식(offending permissive 존치)
BEGIN
  -- (1) ALL-grain 7건: RESTRICTIVE + authenticated + ALL + USING & WITH CHECK canonical
  SELECT count(*) INTO v_all_cnt FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
   WHERE pp.schemaname='public'
     AND pp.policyname IN ('health_maintenance_balances_clinic_gate_restrict',
                           'receipt_ocr_results_clinic_gate_restrict',
                           'claim_diagnoses_clinic_gate_restrict',
                           'handover_notes_clinic_gate_restrict',
                           'diagnosis_folders_clinic_gate_restrict',
                           'diagnosis_sets_clinic_gate_restrict',
                           'notices_clinic_gate_restrict')
     AND pp.permissive='RESTRICTIVE' AND pp.roles::text='{authenticated}' AND pp.cmd='ALL'
     AND po.polqual IS NOT NULL AND po.polwithcheck IS NOT NULL
     AND pg_get_expr(po.polqual,po.polrelid)      LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polqual,po.polrelid)      LIKE '%is_admin_or_manager()%'
     AND pg_get_expr(po.polwithcheck,po.polrelid) LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polwithcheck,po.polrelid) LIKE '%is_admin_or_manager()%';
  IF v_all_cnt <> 7 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ALL-grain restrictive 7건 canonical 매칭 실패 (count=%)', v_all_cnt;
  END IF;

  -- (2) SELECT-grain 2건(payment_audit_logs·room_role_mapping): RESTRICTIVE + authenticated + SELECT + USING canonical
  SELECT count(*) INTO v_sel_cnt FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
   WHERE pp.schemaname='public'
     AND pp.policyname IN ('payment_audit_logs_clinic_read_restrict','room_role_mapping_clinic_read_restrict')
     AND pp.permissive='RESTRICTIVE' AND pp.roles::text='{authenticated}' AND pp.cmd='SELECT'
     AND pg_get_expr(po.polqual,po.polrelid) LIKE '%current_user_clinic_id()%'
     AND pg_get_expr(po.polqual,po.polrelid) LIKE '%is_admin_or_manager()%';
  IF v_sel_cnt <> 2 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: SELECT-grain restrictive 2건 canonical 매칭 실패 (count=%)', v_sel_cnt;
  END IF;

  -- (3) anon-deny 2건(code_availability·redpay_unregistered_line_seen): RESTRICTIVE + anon + ALL + false
  SELECT count(*) INTO v_anon_cnt FROM pg_policies pp
    JOIN pg_policy po ON po.polname=pp.policyname
    JOIN pg_class c ON c.oid=po.polrelid AND c.relname=pp.tablename
   WHERE pp.schemaname='public'
     AND pp.policyname IN ('code_availability_anon_deny','redpay_unregistered_line_seen_anon_deny')
     AND pp.permissive='RESTRICTIVE' AND pp.roles::text='{anon}' AND pp.cmd='ALL'
     AND btrim(lower(pg_get_expr(po.polqual,po.polrelid)))='false';
  IF v_anon_cnt <> 2 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: anon-deny restrictive 2건 canonical 매칭 실패 (count=%)', v_anon_cnt;
  END IF;

  -- (4) ADDITIVE 불변식: 봉쇄대상 offending permissive universal-true 정책 존치(DROP 0)
  SELECT count(*) INTO v_permissive FROM pg_policies
   WHERE schemaname='public'
     AND ( (tablename='health_maintenance_balances'  AND policyname='auth_all')
        OR (tablename='payment_audit_logs'           AND policyname='payment_audit_logs_open')
        OR (tablename='receipt_ocr_results'          AND policyname='auth_all')
        OR (tablename='claim_diagnoses'              AND policyname='claim_diagnoses_auth_all')
        OR (tablename='handover_notes'               AND policyname='handover_notes_select')
        OR (tablename='diagnosis_folders'            AND policyname='diagnosis_folders_read_all')
        OR (tablename='diagnosis_sets'               AND policyname='diagnosis_sets_read_all')
        OR (tablename='notices'                      AND policyname='notices_select_for_authenticated')
        OR (tablename='room_role_mapping'            AND policyname='room_role_read')
        OR (tablename='code_availability'            AND policyname='code_availability_select')
        OR (tablename='redpay_unregistered_line_seen' AND policyname='redpay_unregistered_line_seen_read_all') );
  IF v_permissive <> 11 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: ADDITIVE 위반 — permissive 정책 DROP됨 (count=%, 기대 11)', v_permissive;
  END IF;

  RAISE NOTICE 'VERIFY OK: RESTRICTIVE ALL=7 + SELECT=2 + anon-deny=2 신설(canonical) + offending permissive 11종 존치(ADDITIVE).';
END $verify$;
