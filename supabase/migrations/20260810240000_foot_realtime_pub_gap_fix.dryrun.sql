-- DRY-RUN (무영속): T-20260810-foot-REALTIME-PUB-GAP-FIX
--   Migration Dry-Run No-Persistence Protocol 준수.
--   정본 스코프 = DA-20260810-foot-REALTIME-PUB-GAP-PERTABLE-MATRIX (ALTER PUB ADD 11 · FULL flip 5).
--   무영속 검증 = plpgsql DO 블록 안에서 forward(publication ADD ×11 + REPLICA IDENTITY FULL ×5 +
--     DEFAULT ×9) 실행 후 in-txn 관측 → RAISE EXCEPTION 으로 전체 롤백(DO 블록 트랜잭션 abort) → 영속 0.
--   INV-1(txn-control strip): forward 파일(20260810240000_foot_realtime_pub_gap_fix.sql)에 top-level
--     BEGIN;/COMMIT; 부재 → 조기 COMMIT sentinel-bypass 원천 부재.
--   INV-3(post-probe): 롤백 후 prod 에 11개 M-gap 이 여전히 pub 비-멤버 + FULL-대상 5개가 여전히
--     REPLICA IDENTITY 'd'(default)임을 fresh 쿼리로 실측(러너가 수행).
--   실 러너/PASS 판정: db-gate/ (supervisor DB-GATE) — GO-token lane. 본 파일은 재현 참조.
--
-- 검증 시나리오:
--   A. 적용 중(in-txn): 11개 M-gap 이 supabase_realtime 멤버(신규 멤버십).
--   B. 적용 중(in-txn): FULL 대상 5개(check_ins·reservations·room_assignments·closing_manual_payments·
--      duty_roster) relreplident='f'.
--   C. RAISE EXCEPTION 롤백 후(post-probe): 위 전부 원상(멤버 0 신규 · relreplident='d') — 비영속 실증.
--   D. schema_migrations 원장에 20260810240000 부재(미적용 상태 유지).

DO $$
DECLARE
  t text;
  m_gap_tables text[] := ARRAY[
    'payments','package_payments','closing_manual_payments','duty_roster','clinic_doctors',
    'redpay_raw_transactions','pending_payment','assignment_actions','staff_temp_off',
    'rooms','check_in_room_logs'
  ];
  full_tables text[] := ARRAY[
    'check_ins','reservations','room_assignments','closing_manual_payments','duty_roster'
  ];
  default_tables text[] := ARRAY[
    'payments','package_payments','clinic_doctors','redpay_raw_transactions','pending_payment',
    'assignment_actions','staff_temp_off','rooms','check_in_room_logs'
  ];
  v_pub_added  int;
  v_full_cnt   int;
BEGIN
  -- forward 적용(in-txn)
  FOREACH t IN ARRAY m_gap_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY full_tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
  FOREACH t IN ARRAY default_tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', t);
  END LOOP;

  -- (TEST A) in-txn publication 멤버십 확인
  SELECT count(*) INTO v_pub_added
    FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
     AND tablename = ANY(m_gap_tables);

  -- (TEST B) in-txn FULL 적용 확인
  SELECT count(*) INTO v_full_cnt
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname = ANY(full_tables) AND c.relreplident='f';

  RAISE EXCEPTION 'DRYRUN_OK pub_added=% full_cnt=% (expected 11 / 5) — 무영속 롤백', v_pub_added, v_full_cnt;
END $$;
