-- T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY — provenance 4컬럼 ADDITIVE
-- 부모 T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP §8 판정2 (DA CONSULT-REPLY MSG-20260617-164713-uucv).
--
-- ★ ADDITIVE only — data-architect CONSULT GO(§8 판정2):
--   prescription_codes 에 HIRA 매칭 provenance 4컬럼. 전부 NULL default 無·CHECK 無·FK 無·기존 RLS 상속.
--   청구/KPI/집계 reader 무입력 → 순수 ADDITIVE → autonomy §3.1 ADDITIVE+DA GO = 대표 게이트 면제,
--   supervisor DDL-diff 만. (선례: 20260615120000_rxset_tag_meta 동형 — plain 컬럼, CHECK/FK 無.)
--
-- 컬럼(§8 판정2 정확 스펙):
--   hira_verified_at       TIMESTAMPTZ NULL  : HIRA 매칭 검증 시각.
--   hira_match_basis       TEXT        NULL  : 매칭 근거(성분/제품명/표준코드/품목기준코드/확정 ts 토큰). std9:/edi: 토큰 = 청구가능성 SSOT(§14).
--   hira_mapped_to_code_id UUID        NULL  : reference-move official 역연결(custom row 가 어느 official 로 승격됐는지). 논리적으로 prescription_codes.id 참조(FK 는 ADDITIVE 최소스펙 유지 위해 미부여).
--   hira_verified_by       UUID        NULL  : 오청구 책임추적(검증 staff). DB staff uuid 부재 시 NULL, 확정자는 match_basis 텍스트에 보존.
--
-- 멱등: ADD COLUMN IF NOT EXISTS → 재실행 no-op. 기존 행 전부 NULL. 무중단·무손실·완전 가역(rollback=DROP COLUMN).

BEGIN;

ALTER TABLE prescription_codes
  ADD COLUMN IF NOT EXISTS hira_verified_at       timestamptz,
  ADD COLUMN IF NOT EXISTS hira_match_basis       text,
  ADD COLUMN IF NOT EXISTS hira_mapped_to_code_id uuid,
  ADD COLUMN IF NOT EXISTS hira_verified_by       uuid;

COMMENT ON COLUMN prescription_codes.hira_verified_at       IS 'HIRA 매칭 검증 시각. T-20260617 §8 판정2 (부모) / T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY';
COMMENT ON COLUMN prescription_codes.hira_match_basis       IS 'HIRA 매칭 근거 토큰(std9:/edi:/simname:/prodcode:/총괄확정 ts). 청구가능성 SSOT(§14). T-20260617 §8 판정2';
COMMENT ON COLUMN prescription_codes.hira_mapped_to_code_id IS 'reference-move official 역연결(custom→official 승격 링크). 논리적으로 prescription_codes.id 참조. T-20260617 §8 판정2';
COMMENT ON COLUMN prescription_codes.hira_verified_by       IS 'HIRA 매칭 검증 staff(오청구 책임추적). 없으면 NULL·확정자는 match_basis 보존. T-20260617 §8 판정2';

-- 검증: 4컬럼 존재 확인
DO $$
DECLARE cnt int;
BEGIN
  SELECT count(*) INTO cnt
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='prescription_codes'
    AND column_name IN ('hira_verified_at','hira_match_basis','hira_mapped_to_code_id','hira_verified_by');
  IF cnt <> 4 THEN
    RAISE EXCEPTION 'HIRA-PROVENANCE verify FAILED: expected 4 columns, found %', cnt;
  END IF;
  RAISE NOTICE 'HIRA-PROVENANCE OK: 4 provenance columns present on prescription_codes';
END $$;

COMMIT;
