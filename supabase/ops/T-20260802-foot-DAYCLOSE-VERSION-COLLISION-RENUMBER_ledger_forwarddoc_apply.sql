-- FORWARD-DOC (record-only) — T-20260802-foot-DAYCLOSE-VERSION-COLLISION-RENUMBER
--   DAYCLOSE confirmed-edit 마이그 version-collision disentangle 종결용 ledger row 등재.
--   SSOT: da_decision_foot_pmw_oob_rejectedbody_migledger_reconcile_20260802.md §7 (MSG-20260802-115534-r93z)
--
-- ★ EXEC-LANE = supervisor 전속 (DA §7 처분 line 149 + ★refinement line 151, §1.5 원장 write lane).
--   dev-foot 는 본 record-step 아티팩트 '준비'만 — 물리 INSERT 는 supervisor 가 집행한다.
--
-- ★ record-only · prod 재-apply 금지:
--   objects(closing_edit_log·closing_confirmed_edit) 는 이미 prod-LIVE
--   (supervisor 2026-08-02 11:16 `20260802160000_foot_closing_confirmed_edit.sql` up.sql 직접 apply).
--   up.sql 이 멱등(CREATE IF NOT EXISTS / OR REPLACE)이나 db-push 재-apply 혼동 회피 위해
--   forward-doc(ledger row 등재)로만 수렴. DDL 재실행 0.
--
-- 실행: psql -f 이 파일 (supervisor exec-lane). 역-divergence 가드 위반 시 EXCEPTION(fail-closed).

DO $$
BEGIN
  -- ── 역-divergence 가드: objects prod-LIVE 단언 (record-only 전제) ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='closing_edit_log') THEN
    RAISE EXCEPTION 'FORWARD-DOC ABORT: closing_edit_log 테이블 prod 부재 — record-only 전제 위반(objects 未LIVE). '
                    'forward-doc 아닌 정식 apply 필요 → supervisor 판단.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='closing_confirmed_edit') THEN
    RAISE EXCEPTION 'FORWARD-DOC ABORT: closing_confirmed_edit() 함수 prod 부재 — record-only 전제 위반(objects 未LIVE). '
                    'forward-doc 아닌 정식 apply 필요 → supervisor 판단.';
  END IF;

  -- ── PMW row 무접촉 재확인(방어) — 이 forward-doc 은 DAYCLOSE row 만 등재 ──
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
             WHERE version='20260802160001') THEN
    RAISE NOTICE 'INFO: ledger row 20260802160001 이미 존재 — ON CONFLICT DO NOTHING (멱등 재실행 무해)';
  END IF;

  RAISE NOTICE 'FORWARD-DOC GUARD PASS: closing_edit_log + closing_confirmed_edit prod-LIVE. DAYCLOSE row 등재 진행.';
END $$;

-- ── DAYCLOSE 자기 forward-doc ledger row (record-only) ──
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260802160001', 'foot_closing_confirmed_edit')
ON CONFLICT (version) DO NOTHING;

-- ── POSTCHECK 힌트(supervisor): 두 마이그 각 정합 ──
--   SELECT version, name FROM supabase_migrations.schema_migrations
--     WHERE version IN ('20260802160000','20260802160001') ORDER BY version;
--   기대: 160000=foot_pmw_reconcile_autopromote_forwardfix(PMW, 불변) · 160001=foot_closing_confirmed_edit(DAYCLOSE, 신규 등재)
