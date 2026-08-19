-- DRY-RUN (No-Persistence): T-20260819-foot-INFLOW-KAKAO-CANONICAL-CODE-ADD
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 은 COMMIT(txn-control)을 포함 = sentinel-bypass hazard 존재 → 본 dry-run 은 COMMIT 을 strip 하고
--     BEGIN..ROLLBACK 로 감싸 무영속 보장. txn 내부 assertion 실패 시 RAISE 'DRYRUN-FAIL' → 배치 abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션(독립 API 콜)에서 inbound.kakao 시드 부재 재확인.
BEGIN;

-- system_codes inbound.kakao INSERT (멱등)
INSERT INTO public.system_codes (code_type, code, label, series, sort_order, requires_reason)
VALUES
  ('inflow_channel', 'inbound.kakao', '카톡', 'inbound', 3, false)
ON CONFLICT (code_type, code) DO NOTHING;

-- assertion: inbound.kakao 착지 + 총 12행(기존 11코드 유실 0) + inbound.etc 무변
DO $chk$
DECLARE
  v_total  integer;
  v_kakao  integer;
  v_etc_rr boolean;
BEGIN
  SELECT count(*) INTO v_total  FROM public.system_codes WHERE code_type = 'inflow_channel';
  SELECT count(*) INTO v_kakao  FROM public.system_codes WHERE code_type = 'inflow_channel' AND code = 'inbound.kakao';
  SELECT requires_reason INTO v_etc_rr FROM public.system_codes WHERE code_type = 'inflow_channel' AND code = 'inbound.etc';

  IF v_kakao <> 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: inbound.kakao 시드 착지 실패(count=%)', v_kakao;
  END IF;
  IF v_total < 12 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: inflow_channel 총계 이상(기대 >=12, 실제=%)', v_total;
  END IF;
  IF v_etc_rr IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: inbound.etc.requires_reason 무변 가드 실패(실제=%)', v_etc_rr;
  END IF;
END $chk$;

ROLLBACK;

-- post-probe (runner 별 트랜잭션 · dry-run 후 prod 부재 재확인):
--   SELECT count(*) FROM public.system_codes WHERE code_type='inflow_channel' AND code='inbound.kakao'; -- 기대: 0 (무영속)
