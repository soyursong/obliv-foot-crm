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
-- ── Step1 READ-ONLY freeze (2026-07-18 dev-foot CONFIRMED · 2026-07-19 RE-CONFIRMED post-DMLgate) ──
--   대상 = 1건: id 676ceca0… / name_ko '대웅푸루나졸정150mg(플루코나졸)' / code_source=custom /
--              claim_code 'LEGACY-12d7730e32e8'.
--   총괄 '규격 여러개'와 달리 실제 마스터엔 대웅푸루나졸 단일행(name LIKE '대웅푸루나졸%' = 1건, 다규격 아님).
--   ⚠ freeze 정정(2026-07-19): supervisor LIVE prod DML게이트 dry-run 결과 참조 5종 중 **폴더=1**
--      (prescription_code_folders → folder 'ed3ae609…처방세트 이관', 2026-06-17 편입 — 부모 T-20260617 RXSET
--       배치가 이 약을 조직 폴더에 편입한 것으로 추정). 나머지 4종(금기/묶음/처방이력/화이트)=0 재확인.
--      최초 13:04 freeze의 '무결성참조 0'은 폴더 멤버십 조사 누락(freeze stale) → 본 freeze 로 대체.
--
-- ── 방식: archive-first hard-DELETE + 폴더 CASCADE 의도 수용 ───────────────────────
--   ⚠ DESTRUCTIVE DML(row 삭제) — 부모의 additive 성격과 다름. supervisor DML 게이트 통과 후에만 apply.
--     dev 자가적용 안 함(파괴적 DML). ADDITIVE carve-out(대표게이트 면제) 적용 금지.
--   ▷ 폴더 참조 처리(FIX-REQUEST 옵션① 채택, dev 설계 판정):
--      prescription_code_folders.prescription_code_id 는 **FK ON DELETE CASCADE** (파일탐색기 '약 하나=폴더 하나'
--      배지 시맨틱, 20260607180000_prescription_drug_folders §37 참조). folder '처방세트 이관'은 **조직용 배지**로
--      임상/청구 무결성과 무관 → 약 삭제 시 폴더 멤버십이 CASCADE 로 자동 정리되는 것이 의도된 정상 동작.
--      따라서 폴더(v_ref_folder)는 **abort 합산에서 제외**한다. 대신 archive-first 1단에서 폴더 멤버십 행도
--      _backup 에 스냅샷 → CASCADE 삭제 + 아카이브 = **가역**(rollback 이 폴더 멤버십까지 재삽입 원복).
--      단 금기/묶음/처방이력/화이트 4종은 임상/청구 무결성 직결 → abort 유지(발견 시 hard-DELETE 금지).
--   ⚠ archive-first 2단 (Cross-CRM Orphan-Row Archive-First / data_correction_backfill SOP 준용):
--     [1단·apply 러너] 파괴 前 off-git _backup 네임스페이스로 대상 행 + 폴더 멤버십 행 선적재
--        (러너: scripts/T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE_apply.mjs, WS-C 20260713140000 선례 동일):
--        CREATE SCHEMA IF NOT EXISTS _backup;
--        CREATE TABLE _backup.daewoong_pluranazole_20260718_removed AS SELECT * FROM public.prescription_codes
--           WHERE code_source='custom' AND claim_code='LEGACY-12d7730e32e8' AND name_ko LIKE '대웅푸루나졸%';
--        CREATE TABLE _backup.daewoong_pluranazole_folders_20260718_removed AS SELECT * FROM public.prescription_code_folders
--           WHERE prescription_code_id IN (SELECT id FROM _backup.daewoong_pluranazole_20260718_removed);
--        (DA §4 "archive tracked CREATE 금지" 준수 → 본 마이그는 archive CREATE 를 포함하지 않는다. DML only.)
--     [2단·본 마이그] freeze 재검증 + 4종 참조 0 재검증(발견 시 abort) → DELETE (폴더 멤버십은 FK CASCADE 자동 삭제).
--   Rollback = 20260718150000_daewoong_pluranazole_remove.rollback.sql (_backup 2종에서 재INSERT 원복 — 폴더 멤버십 포함).
--   Dry-run  = 20260718150000_daewoong_pluranazole_remove.dryrun.sql (BEGIN..ROLLBACK 무영속 COUNT 검증).
--
-- ── freeze/참조 재검증 abort 불변식 (AC2·AC3 강제) ────────────────────────────────
--   · 대상 name LIKE '대웅푸루나졸%' 카운트가 freeze(=1)와 다르면 abort (규격 신규 유입/재확인 필요).
--   · 대상 행이 **임상/청구 참조 surface 4종**(금기 FK / 화이트 FK / 묶음 JSONB / 처방이력 JSONB) 중
--     하나라도 걸리면 abort → hard-DELETE 절대 금지(기존 처방/청구 무결성 보존). soft-delete 재설계 → planner FOLLOWUP.
--     (폴더 FK 는 CASCADE+아카이브=가역 → abort 제외. 단 archive-first 1단 폴더 스냅샷 부재 시 롤백 원복 불가 위험.)
--   · DELETE 건수 <> 1 이면 abort (초과 삭제 0 = AC3).
--   원장(청구 원장) 무접점. 전 과정 단일 txn — 어느 단계든 RAISE 시 전체 롤백(무영속).
-- author: dev-foot / 2026-07-18 (rev 2026-07-19: folder CASCADE 수용, FIX-REQUEST 옵션①)

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

  -- ── 참조 무결성 재검증 (임상/청구 abort 4종 + 폴더 CASCADE 1종=비-abort) ──
  --    ⚠ abort 합산 대상 = 금기 + 화이트 + 묶음 + 처방이력 (임상/청구 무결성 직결).
  --      폴더(v_ref_folder)는 CASCADE+아카이브=가역 → 별도 계측만 하고 abort 합산에서 제외.
  --    1) 금기 prescription_contraindications (FK, ON DELETE CASCADE) [abort]
  SELECT count(*) INTO v_ref_contra
  FROM public.prescription_contraindications
  WHERE prescription_code_id = v_target_id;

  --    2) 약품폴더 배지 prescription_code_folders (FK, ON DELETE CASCADE) [비-abort · 계측만]
  --       조직용 배지(파일탐색기 '약 하나=폴더 하나') → 삭제 시 CASCADE 자동 정리가 의도된 동작.
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

  -- abort 합산 = 임상/청구 4종만(폴더 제외). 하나라도 >0 → hard-DELETE 금지.
  IF (v_ref_contra + v_ref_allow + v_ref_set + v_ref_chart) <> 0 THEN
    RAISE EXCEPTION
      'DAEWOONG-REMOVE ABORT: 임상/청구 참조 존재 (금기=% 화이트=% 묶음=% 처방이력=%) — hard-DELETE 금지, soft-delete 재설계 필요(planner FOLLOWUP)',
      v_ref_contra, v_ref_allow, v_ref_set, v_ref_chart;
  END IF;
  RAISE NOTICE 'DAEWOONG-REMOVE 참조 계측: 금기=% 화이트=% 묶음=% 처방이력=% (abort 4종 합산 0) · 폴더=%(CASCADE 자동정리·archive 원복 가역)',
    v_ref_contra, v_ref_allow, v_ref_set, v_ref_chart, v_ref_folder;

  -- ── archive-first 2단: (1단=apply 러너 off-git _backup 선적재[대상행+폴더멤버십] 완료 전제) → (2단) 파괴 실행 ──
  --    폴더 멤버십(prescription_code_folders)은 FK ON DELETE CASCADE 로 본 DELETE 시 자동 삭제됨(archive 로 원복 가역).
  DELETE FROM public.prescription_codes WHERE id = v_target_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE ABORT: 삭제 % 건(기대=1) — 초과/미달 삭제, 전체 롤백', v_deleted;
  END IF;

  RAISE NOTICE 'DAEWOONG-REMOVE OK: 대웅푸루나졸 custom row % 삭제(임상/청구 참조 0 확증, 폴더 % 건 CASCADE 정리) / 동명 잔존 0', v_target_id, v_ref_folder;
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
