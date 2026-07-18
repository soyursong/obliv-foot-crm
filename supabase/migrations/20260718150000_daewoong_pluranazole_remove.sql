-- T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE
-- 서비스관리 약품 목록에서 '대웅푸루나졸'(동명 전건) 제거. 총괄 김주연(has_ops_authority) explicit "빼달라" (slack C0ATE5P6JTH ts 1784338735.191229).
--
-- ★ Step1 READ-ONLY 조사 결과(db-gate/*_step1_freeze.json, 2026-07-18):
--   · freeze 대상 = 정확히 1건:
--       id=676ceca0-23f0-4d33-a362-1af04770b564
--       name_ko='대웅푸루나졸정150mg(플루코나졸)'  claim_code='LEGACY-12d7730e32e8'  code_source='custom'
--     (총괄 '규격 여러개' 언급했으나 실제 마스터엔 150mg 단일행. name prefix '대웅푸루나졸%' = 1건.)
--     부모 T-20260617 에서 '매핑 제외(미접촉)'로 남긴 custom '자체' 약 — 본 티켓이 그 1건을 '삭제'로 분리 처리.
--   · 참조 검사(무결성):  처방이력(medical_charts.prescription_items)=0  묶음처방(prescription_sets.items)=0
--                        금기증(prescription_contraindications)=0  청구(service_charges→services 참조, 약 직접참조 없음)=0
--     → 유일 참조 = prescription_code_folders 폴더배정 1행(folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6) = 서비스관리 목록 노출 surface 자체.
--   · 판정: 보존해야 할 처방/청구 무결성 참조 0 → "참조 없음" 분기 → archive-first 스냅샷 후 hard-DELETE 안전.
--           (참조가 발견되면 아래 guard 가 abort → soft 처리 재검토. hard-DELETE 최종여부 = supervisor DML 게이트 판정.)
--
-- 안전장치: freeze셋 재검증(초과삭제 0) + 무결성 참조 재검증(발견 시 abort) + archive-first(롤백 원천) + 사후검증. 전부 단일 txn.

BEGIN;

-- ── 0) freeze-set + 무결성 참조 재검증 (apply 시점 대상셋 변동/오확산 방지) ──
DO $$
DECLARE
  v_target uuid := '676ceca0-23f0-4d33-a362-1af04770b564';
  v_cnt int; v_prefix int; v_mc int; v_ps int; v_ci int;
BEGIN
  -- (a) freeze id 가 정확히 그 약(name prefix + custom)인지
  SELECT count(*) INTO v_cnt FROM prescription_codes
    WHERE id = v_target AND name_ko LIKE '대웅푸루나졸%' AND code_source = 'custom';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE ABORT: freeze 대상 %건(기대=1, id=% / name LIKE 대웅푸루나졸%% / custom) — freeze셋 변동', v_cnt, v_target;
  END IF;

  -- (b) name prefix '대웅푸루나졸%' 총 건수 = 1 (규격 신규추가 등 초과대상 없음 = AC3 초과삭제 0)
  SELECT count(*) INTO v_prefix FROM prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';
  IF v_prefix <> 1 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE ABORT: name LIKE 대웅푸루나졸%% 가 %건(기대=1) — 규격 추가 등 freeze셋 변동 → 재조사 필요(초과삭제 방지)', v_prefix;
  END IF;

  -- (c) 무결성 참조 재검증: 처방이력/묶음처방/금기증이 이 약 참조하면 hard-DELETE 금지 → abort(soft 전환)
  SELECT count(*) INTO v_mc FROM medical_charts
    WHERE prescription_items @> jsonb_build_array(jsonb_build_object('prescription_code_id', v_target::text));
  SELECT count(*) INTO v_ps FROM prescription_sets
    WHERE items @> jsonb_build_array(jsonb_build_object('prescription_code_id', v_target::text));
  SELECT count(*) INTO v_ci FROM prescription_contraindications WHERE prescription_code_id = v_target;
  IF v_mc <> 0 OR v_ps <> 0 OR v_ci <> 0 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE ABORT: 참조 발생(처방이력=% 묶음=% 금기=%) — 무결성 보존 필요 → hard-DELETE 금지, soft 처리 재검토', v_mc, v_ps, v_ci;
  END IF;

  RAISE NOTICE 'DAEWOONG-REMOVE guard OK: freeze 1건 / prefix 1건 / 무결성참조 0 → archive-first hard-DELETE 진행';
END $$;

-- ── 1) archive-first: 대상 마스터 row + 폴더배정 스냅샷 (롤백 원천) ──
CREATE TABLE IF NOT EXISTS _archive_daewoong_pluranazole_20260718 AS
  SELECT * FROM prescription_codes
  WHERE id = '676ceca0-23f0-4d33-a362-1af04770b564';

CREATE TABLE IF NOT EXISTS _archive_daewoong_pluranazole_folders_20260718 AS
  SELECT * FROM prescription_code_folders
  WHERE prescription_code_id = '676ceca0-23f0-4d33-a362-1af04770b564';

-- ── 2) DELETE: 폴더배정 → 마스터 (FK ON DELETE CASCADE 있으나 명시 삭제로 감사 명확화) ──
DELETE FROM prescription_code_folders WHERE prescription_code_id = '676ceca0-23f0-4d33-a362-1af04770b564';
DELETE FROM prescription_codes        WHERE id = '676ceca0-23f0-4d33-a362-1af04770b564';

-- ── 3) 사후 검증 (같은 txn — 실패 시 전체 롤백) ──
DO $$
DECLARE v_pc int; v_f int; v_arc int;
BEGIN
  SELECT count(*) INTO v_pc FROM prescription_codes WHERE id = '676ceca0-23f0-4d33-a362-1af04770b564';
  SELECT count(*) INTO v_f  FROM prescription_code_folders WHERE prescription_code_id = '676ceca0-23f0-4d33-a362-1af04770b564';
  SELECT count(*) INTO v_arc FROM _archive_daewoong_pluranazole_20260718;
  IF v_pc <> 0 OR v_f <> 0 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE verify FAILED: master=% folder=% (기대 0/0)', v_pc, v_f;
  END IF;
  IF v_arc <> 1 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE verify FAILED: archive 스냅샷 %건(기대 1) — 롤백 원천 미확보', v_arc;
  END IF;
  RAISE NOTICE 'DAEWOONG-REMOVE OK: 마스터 1 + 폴더배정 1 삭제 / archive 스냅샷 1 보존. 순소실=0(무결성참조 없었음).';
END $$;

COMMIT;
