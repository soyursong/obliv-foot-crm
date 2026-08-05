-- FORWARD-DOC (record-only) — T-20260805-foot-DRS-VERSION-COLLISION-RENUMBER
--   daily_room_status version-collision(20260630200000 이중점유) disentangle 종결용 ledger row 등재.
--   SSOT/게이트: DA CONSULT-REPLY DA-20260805-foot-DRS-VERSION-COLLISION-RENUMBER (GO·조건부, MSG-20260805-082713-syt7)
--   class precedent: T-20260714 / T-20260802 (양건 DA GO·deployed) 동형.
--
-- ★ EXEC-LANE = supervisor 전속 (§1.5 원장 write lane · §1.6 record-step 게이트). dev-foot 물리 INSERT 아님.
--
-- ★ record-only · prod 재-apply 금지:
--   object(daily_room_status_staff_unlock_6menu 정책)는 이미 prod-LIVE
--   (T-20260701 sweep apply, commit 7d386c77; supervisor 2026-08-05 precheck 재확인 drs_unlock_pol=true).
--   up.sql 이 idempotent(DROP IF EXISTS + CREATE)이나 db-push 재-apply 혼동 회피 위해
--   forward-doc(ledger row 등재)로만 수렴. DDL 재실행 0.
--
-- ★ notif_tmpl row 20260630200000 무접촉 — 정당점유(created_by=dev-foot:NOTIF-TMPL-RLS-CODY-UNLOCK).
--
-- 실행: supervisor exec-lane, query() helper(Management API) 경유. 역-divergence 가드 위반 시 EXCEPTION(fail-closed).

DO $$
BEGIN
  -- ── 역-divergence 가드: daily_room_status 정책 prod-LIVE 단언 (record-only 전제) ──
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename='daily_room_status'
                 AND policyname='daily_room_status_staff_unlock_6menu') THEN
    RAISE EXCEPTION 'FORWARD-DOC ABORT: daily_room_status_staff_unlock_6menu 정책 prod 부재 — record-only 전제 위반(object 未LIVE). forward-doc 아닌 정식 apply 필요 → supervisor 판단.';
  END IF;

  -- ── notif_tmpl 200000 정당점유 무접촉 재확인(방어) ──
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                 WHERE version='20260630200000' AND name='notif_tmpl_write_staff_roles_align') THEN
    RAISE EXCEPTION 'FORWARD-DOC ABORT: 20260630200000 notif_tmpl 원장행 예상형태 아님 — TOCTOU 위반, disentangle 전제 붕괴.';
  END IF;

  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260630200001') THEN
    RAISE NOTICE 'INFO: ledger row 20260630200001 이미 존재 — ON CONFLICT DO NOTHING (멱등 재실행 무해)';
  END IF;

  RAISE NOTICE 'FORWARD-DOC GUARD PASS: daily_room_status_staff_unlock_6menu 정책 prod-LIVE + notif_tmpl 200000 정당점유. daily_room_status row 등재 진행.';
END $$;

-- ── daily_room_status 자기 forward-doc ledger row (record-only, statements 빈배열=replay 대상 아님) ──
INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
VALUES ('20260630200001', 'daily_room_status_staff_unlock_6menu_rls_additive', '{}'::text[],
        'T-20260805-DRS-VERSION-COLLISION-RENUMBER:supervisor-execlane')
ON CONFLICT (version) DO NOTHING;

-- ── POSTCHECK 힌트(supervisor): 두 마이그 각 정합 ──
--   SELECT version, name, created_by FROM supabase_migrations.schema_migrations
--     WHERE version IN ('20260630200000','20260630200001') ORDER BY version;
--   기대: 200000=notif_tmpl_write_staff_roles_align(불변) · 200001=daily_room_status_staff_unlock_6menu_rls_additive(신규 등재)
