-- T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE — 서비스관리 약품 목록에서 '대웅푸루나졸' 전건 제거
--
-- 요청: 김주연 총괄(has_ops_authority, U0ATDB587PV, 2026-07-18 C0ATE5P6JTH thread 1784338735.191229)
--   "약품 목록(서비스관리)에서 '대웅푸루나졸' 삭제. 규격이 여러 개라 특정 불가 → 전체 제거."
--   경유: responder NEW-TICKET MSG-20260718-105941-ppnl.
--
-- ── 부모 티켓 관계(중복빌드/충돌 방지) ────────────────────────────────────────────
--   부모 T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP(approved, 18종 HIRA 승격)는 대웅푸루나졸을
--   '매핑 제외(custom 자체 유지·미접촉)'로 종결. 본 티켓은 그 대웅푸루나졸을 '목록 삭제'로 격상.
--   surface/action 분기 명확(매핑제외 ≠ 삭제) → fold 아님. 부모 18종 apply 범위 대웅 미접촉 유지 →
--   본 마이그와 겹치지 않음(READ-ONLY 대조 완료, 충돌 0).
--
-- ── Step1 READ-ONLY freeze (2026-07-18 dev-foot CONFIRMED) ────────────────────────
--   대상 = 1건: id 676ceca0… / name_ko '대웅푸루나졸정150mg(플루코나졸)' / code_source=custom /
--              claim_code 'LEGACY-12d7730e32e8'.
--   총괄 '규격 여러개'와 달리 실제 마스터엔 대웅푸루나졸 단일행(name LIKE '대웅푸루나졸%' = 1건, 다규격 아님).
--   무결성 참조 = 0 (처방이력 medical_charts / 묶음처방 prescription_sets / 금기 prescription_contraindications /
--                    폴더 prescription_code_folders / 화이트리스트 prescription_code_allowlist / 청구 전부 0).
--
-- ── 방식: archive-first hard-DELETE (참조 0 확증) ─────────────────────────────────
--   ⚠ DESTRUCTIVE DML(row 삭제) — 부모의 additive 성격과 다름. supervisor DML 게이트 통과 후에만 apply.
--     dev 자가적용 안 함(파괴적 DML). ADDITIVE carve-out(대표게이트 면제) 적용 금지.
--   ⚠ archive-first 2단 (Cross-CRM Orphan-Row Archive-First / data_correction_backfill SOP 준용):
--     [1단·apply 러너] 파괴 前 off-git _backup 네임스페이스로 대상 행 선적재(WS-C 20260713140000 선례 동일):
--        CREATE SCHEMA IF NOT EXISTS _backup;
--        CREATE TABLE _backup.daewoong_pluranazole_20260718_removed AS
--          SELECT * FROM public.prescription_codes
--           WHERE code_source='custom' AND claim_code='LEGACY-12d7730e32e8' AND name_ko LIKE '대웅푸루나졸%';
--        (DA §4 "archive tracked CREATE 금지" 준수 → 본 마이그는 archive CREATE 를 포함하지 않는다. DML only.)
--     [2단·본 마이그] freeze 재검증 + 참조 0 재검증(참조 발견 시 abort) → DELETE.
--   Rollback = 20260718150000_daewoong_pluranazole_remove.rollback.sql (_backup 에서 재INSERT 원복).
--   Dry-run  = 20260718150000_daewoong_pluranazole_remove.dryrun.sql (BEGIN..ROLLBACK 무영속 COUNT 검증).
--
-- ── freeze/참조 재검증 abort 불변식 (AC2·AC3 강제) ────────────────────────────────
--   · 대상 name LIKE '대웅푸루나졸%' 카운트가 freeze(=1)와 다르면 abort (규격 신규 유입/재확인 필요).
--   · 대상 행이 어느 참조 surface(FK 3종 + JSONB 2종)에라도 걸리면 abort
--     → hard-DELETE 절대 금지(기존 처방/청구 무결성 보존, risk_verdict GO_WARN). soft-delete 재설계 필요 → planner FOLLOWUP.
--   · DELETE 건수 <> 1 이면 abort (초과 삭제 0 = AC3).
--   원장(청구 원장) 무접점. 전 과정 단일 txn — 어느 단계든 RAISE 시 전체 롤백(무영속).
-- author: dev-foot / 2026-07-18

BEGIN;

DO $$
DECLARE
  v_target_id   uuid;
  v_name_cnt    int;
  v_ref_contra  int := 0;
  v_ref_folder  int := 0;
  v_ref_allow   int := 0;
  v_ref_set     int := 0;
  v_ref_chart   int := 0;
  v_deleted     int;
BEGIN
  -- ── freeze 재검증: 동명(대웅푸루나졸) 전건 카운트 = 1 (freeze census) ──
  SELECT count(*) INTO v_name_cnt
  FROM public.prescription_codes
  WHERE name_ko LIKE '대웅푸루나졸%';
  IF v_name_cnt <> 1 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE ABORT: 대웅푸루나졸 동명 % 건(freeze=1) — 규격 신규유입/드리프트, 재-freeze·재확인 필요', v_name_cnt;
  END IF;

  -- ── 대상 행 정확 식별 (code_source + LEGACY claim_code + 이름) ──
  SELECT id INTO v_target_id
  FROM public.prescription_codes
  WHERE code_source = 'custom'
    AND claim_code = 'LEGACY-12d7730e32e8'
    AND name_ko LIKE '대웅푸루나졸%';
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE ABORT: 대상 row(custom / LEGACY-12d7730e32e8 / 대웅푸루나졸) 미식별 — freeze 불일치';
  END IF;

  -- ── 참조 무결성 재검증 (FK 3종 + JSONB soft-ref 2종) — 하나라도 >0 이면 hard-DELETE 금지 ──
  --    1) 금기 prescription_contraindications (FK, ON DELETE CASCADE)
  SELECT count(*) INTO v_ref_contra
  FROM public.prescription_contraindications
  WHERE prescription_code_id = v_target_id;

  --    2) 약품폴더 배지 prescription_code_folders (FK, ON DELETE CASCADE)
  IF to_regclass('public.prescription_code_folders') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.prescription_code_folders WHERE prescription_code_id = $1'
      INTO v_ref_folder USING v_target_id;
  END IF;

  --    3) 처방 화이트리스트 overlay prescription_code_allowlist (FK, ON DELETE CASCADE) — prod 미배포 가능 → to_regclass 가드
  IF to_regclass('public.prescription_code_allowlist') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.prescription_code_allowlist WHERE prescription_code_id = $1'
      INTO v_ref_allow USING v_target_id;
  END IF;

  --    4) 묶음처방 prescription_sets.items[] (JSONB soft-ref, DB FK 없음)
  IF to_regclass('public.prescription_sets') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM public.prescription_sets s
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(s.items, '[]'::jsonb)) e
          WHERE e->>'prescription_code_id' = $1::text )
    $q$ INTO v_ref_set USING v_target_id;
  END IF;

  --    5) 처방이력 medical_charts.prescription_items[] (JSONB soft-ref, DB FK 없음) — 청구/이력 대리 지표
  IF to_regclass('public.medical_charts') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM public.medical_charts m
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(m.prescription_items, '[]'::jsonb)) e
          WHERE e->>'prescription_code_id' = $1::text )
    $q$ INTO v_ref_chart USING v_target_id;
  END IF;

  IF (v_ref_contra + v_ref_folder + v_ref_allow + v_ref_set + v_ref_chart) <> 0 THEN
    RAISE EXCEPTION
      'DAEWOONG-REMOVE ABORT: 참조 존재 (금기=% 폴더=% 화이트=% 묶음=% 처방이력=%) — hard-DELETE 금지, soft-delete 재설계 필요(planner FOLLOWUP)',
      v_ref_contra, v_ref_folder, v_ref_allow, v_ref_set, v_ref_chart;
  END IF;

  -- ── archive-first 2단: (1단=apply 러너 off-git _backup 선적재 완료 전제) → (2단) 파괴 실행 ──
  DELETE FROM public.prescription_codes WHERE id = v_target_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE ABORT: 삭제 % 건(기대=1) — 초과/미달 삭제, 전체 롤백', v_deleted;
  END IF;

  RAISE NOTICE 'DAEWOONG-REMOVE OK: 대웅푸루나졸 custom row % 삭제(참조 0 확증) / 동명 잔존 0', v_target_id;
END $$;

-- ── 사후 검증 (같은 txn 내) ──
DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE verify FAILED: 대웅푸루나졸 % 건 잔존(기대=0)', v_left;
  END IF;
  RAISE NOTICE 'DAEWOONG-REMOVE verify OK: 서비스관리 약품 목록에 대웅푸루나졸 0건';
END $$;

COMMIT;
