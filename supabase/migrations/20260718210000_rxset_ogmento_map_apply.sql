-- T-20260718-foot-RXSET-OGMENTO-MAP-APPLY — 오구멘토 → 오구멘토정375밀리그램(아목시실린·클라불란산칼륨) reference-canonical (Case2)
-- 부모 T-20260617 §8 (b) reference-canonical 결정트리. sibling T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY 구조 상속.
-- 총괄 김주연(U0ATDB587PV, confirm 권한 문지은 대표원장 위임) 확정: 2026-07-18 slack "오구멘토정375mg 정상이라는거지? 연결ㄱ"
--   (C0ATE5P6JTH thread 1780810527.570069).
--
-- ★ 타깃명 정정(REDEFINITION): 부모 2026-07-15 기재 '오구멘토→오구멘틴375mg(Augmentin)' → 오늘 총괄 정정확정 '오구멘토정375mg'.
--   심평원 master(data.go.kr 15067462 의약품표준코드) READ-ONLY 조회로 정정 타깃 실재 확인:
--     오구멘토정375밀리그램(아목시실린·클라불란산칼륨) / 주식회사 더유제약 / 375밀리그램 / 전문의약품
--     품목기준코드 201908078 / 대표코드·표준코드 8800570003904 / 취소일자 공란(=ACTIVE).
--   ⚠ 오구멘틴(Augmentin/글락소, 글락소오구멘틴정375mg 품목 200209643)은 2012-04-26 등재취소 → 절대 연결 금지.
--     제조사(더유제약≠글락소스미스클라인)·코드·active 상태로 완전 분리 확인. 부모 §19 hold 근본원인(취소코드 연결) 회피.
--   이름(오구멘토정375밀리그램)+규격(375mg)+성분(아목시실린·클라불란산 2:1=250+125) 3중 일치 evidence.
--
-- Step A(READ-ONLY, scripts/..._stepA_audit.mjs) 판정: 목표 official 마스터 미등재 → ★Case2 (신규 official ADDITIVE + custom deprecate + reference-move).
--   custom 대상 = 1건: 942b2ea4-bcd9-4afa-a34f-98a33323a3f6 / '오구멘토' / LEGACY-f859925fdba2 / code_source=custom.
--   폴더 배지 surface(prescription_code_folders) 참조 = 1행(folder ed3ae609). 묶음처방(prescription_sets) 참조 = 0.
--   provenance 4컬럼 旣배포(FLUNACOEM DDL 20260716140100) → 본건 신규 DDL 0, 값적재 DML만.
--
-- 메커니즘 가드(§8 NO_GO):
--   (a) claim_code in-place 교체 = NO_GO  → custom row 의 claim_code 는 손대지 않음.
--   (c) custom hard-delete = NO_GO        → custom row 는 DELETE 하지 않고 provenance supersede 링크로 deprecate 표현.
--   채택 (b) = 신규 official ADDITIVE row 생성 + prescription_code_folders 참조를 official 로 재지정 + custom row deprecate.
--
-- claim_code 네임스페이스(§14 CONSULT-REPLY#2): 급여=EDI bare / 비급여·EDI미확정=HIRA-{품목기준코드9}.
--   본건은 IDENTITY 확정 티켓(급여/EDI 대조는 잔여 자체약 배치 소관, 본건 분리) →
--   HIRA-201908078 (품목기준코드 9자리 prefix). §335 bare 적재 NO_GO(청구 reader EDI 오인 방지) 준수 = prefix 필수.
--   insurance_status = NULL(급여여부 미확정 — 오청구 방지). 표준코드/품목기준코드/성분/확정근거 는 hira_match_basis 토큰 보존.
--
-- 오확산 방지: 대상 custom 이 정확히 1건이 아니거나 신규 claim_code 충돌 시 즉시 RAISE EXCEPTION → 트랜잭션 abort(무영속).

BEGIN;

DO $$
DECLARE
  v_custom_id   uuid;
  v_official_id uuid := gen_random_uuid();
  v_target_cnt  int;
  v_conflict    int;
  v_folder_cnt  int;
BEGIN
  -- ── 대상 custom row 정확 식별 (LEGACY claim_code + code_source=custom + 이름) ──
  SELECT count(*) INTO v_target_cnt
  FROM prescription_codes
  WHERE claim_code = 'LEGACY-f859925fdba2' AND code_source = 'custom';
  IF v_target_cnt <> 1 THEN
    RAISE EXCEPTION 'OGMENTO-MAP ABORT: custom 대상 % 건(기대=1) — 오확산 방지', v_target_cnt;
  END IF;

  SELECT id INTO v_custom_id
  FROM prescription_codes
  WHERE claim_code = 'LEGACY-f859925fdba2' AND code_source = 'custom'
    AND name_ko = '오구멘토';
  IF v_custom_id IS NULL THEN
    RAISE EXCEPTION 'OGMENTO-MAP ABORT: custom row(LEGACY-f859925fdba2 / 오구멘토) 미식별';
  END IF;

  -- ── 신규 official claim_code UNIQUE 충돌 방어 (충돌 시 Case1 강등 필요 → abort) ──
  SELECT count(*) INTO v_conflict FROM prescription_codes WHERE claim_code = 'HIRA-201908078';
  IF v_conflict <> 0 THEN
    RAISE EXCEPTION 'OGMENTO-MAP ABORT: claim_code HIRA-201908078 이미 존재(%건) — Case1 강등 검토', v_conflict;
  END IF;

  -- ── (Case2-b1) 신규 official row ADDITIVE 생성 ──
  --    나머지 컬럼은 custom row 미러(classification=내복약 등) + official 코호트 표준(code_type=국산보험등재약).
  INSERT INTO prescription_codes (
    id, claim_code, name_ko, code_source, code_type, classification, manufacturer,
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    insurance_status, insurance_status_source, description, service_id,
    hira_verified_at, hira_match_basis, hira_mapped_to_code_id, hira_verified_by
  )
  SELECT
    v_official_id,
    'HIRA-201908078',
    '오구멘토정375밀리그램(아목시실린·클라불란산칼륨)',
    'official',
    '국산보험등재약',
    classification,                 -- 내복약 (custom 미러)
    '주식회사 더유제약',
    anti_dropout, relative_value, ingredient_code, low_dose, price_krw,
    NULL,                           -- insurance_status: 급여여부 미확정(약국대조 별도)
    NULL,
    description, service_id,
    now(),
    'name:오구멘토정375밀리그램/std9:201908078/std13:8800570003904/성분:아목시실린+클라불란산2:1(250+125)/전문의약품/제조:주식회사 더유제약/active(취소일자 공란)/타깃정정 오구멘틴375mg→오구멘토정375mg(오구멘틴 Augmentin 아님)/총괄확정 2026-07-18 thread1780810527.570069(김주연 U0ATDB587PV)',
    NULL,                           -- official 는 canonical (mapped_to 없음)
    NULL                            -- verified_by: DB staff uuid 부재 → NULL, 확정자는 match_basis 보존
  FROM prescription_codes
  WHERE id = v_custom_id;

  -- ── (Case2-b2) 폴더 배지 surface 참조 재지정: prescription_code_folders custom → official ──
  SELECT count(*) INTO v_folder_cnt
  FROM prescription_code_folders WHERE prescription_code_id = v_custom_id;
  IF v_folder_cnt <> 1 THEN
    RAISE EXCEPTION 'OGMENTO-MAP ABORT: 폴더 참조 % 건(기대=1) — reference-move 대상 불일치', v_folder_cnt;
  END IF;

  UPDATE prescription_code_folders
    SET prescription_code_id = v_official_id
    WHERE prescription_code_id = v_custom_id;

  -- ── (Case2-b3) custom row deprecate 마킹 (hard-delete·claim_code 교체 금지 준수) ──
  --    폴더 참조 제거(위에서 official 로 이동) + provenance supersede 링크 = 폐기 표현.
  UPDATE prescription_codes
    SET hira_verified_at       = now(),
        hira_mapped_to_code_id = v_official_id,
        hira_match_basis       = 'DEPRECATED→official:' || v_official_id::text
                                 || ' | name:오구멘토정375밀리그램/std9:201908078/std13:8800570003904/성분:아목시실린+클라불란산2:1/총괄확정 2026-07-18 thread1780810527.570069'
    WHERE id = v_custom_id;

  RAISE NOTICE 'OGMENTO-MAP OK (Case2): custom % deprecated → official % (HIRA-201908078), folder-move % rows',
    v_custom_id, v_official_id, v_folder_cnt;
END $$;

-- ── 사후 검증 (같은 txn 내) ──
DO $$
DECLARE
  v_official_id  uuid;
  v_badge_left   int;
  v_folder_off   int;
BEGIN
  SELECT id INTO v_official_id FROM prescription_codes
    WHERE claim_code = 'HIRA-201908078' AND code_source = 'official';
  IF v_official_id IS NULL THEN
    RAISE EXCEPTION 'OGMENTO-MAP verify FAILED: official row(HIRA-201908078) 부재';
  END IF;

  -- 폴더에 남은 custom(자체) 참조 = 0 이어야
  SELECT count(*) INTO v_badge_left
  FROM prescription_code_folders f
  JOIN prescription_codes c ON c.id = f.prescription_code_id
  WHERE c.claim_code = 'LEGACY-f859925fdba2';
  IF v_badge_left <> 0 THEN
    RAISE EXCEPTION 'OGMENTO-MAP verify FAILED: 폴더에 custom 참조 % 건 잔존(기대=0)', v_badge_left;
  END IF;

  -- official 이 폴더에 배치됨 = 1
  SELECT count(*) INTO v_folder_off
  FROM prescription_code_folders WHERE prescription_code_id = v_official_id;
  IF v_folder_off <> 1 THEN
    RAISE EXCEPTION 'OGMENTO-MAP verify FAILED: official 폴더 참조 % 건(기대=1)', v_folder_off;
  END IF;

  RAISE NOTICE 'OGMENTO-MAP verify OK: 자체 폴더참조 0 / official 폴더참조 1';
END $$;

COMMIT;
