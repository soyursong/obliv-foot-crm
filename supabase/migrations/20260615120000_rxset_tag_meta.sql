-- T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER — 묶음처방(prescription_sets) set-level 태그/아이콘 메타
-- 현장요청(문지은 대표원장, MSG-20260615-003419-lbkd): 묶음처방에 색깔 태그(라벨+색)·아이콘 부여 →
--   태그 클릭 시 그 묶음의 약물이 처방에 삽입(=빠른처방 트리거, A안 원클릭).
--
-- ★ ADDITIVE only — data-architect CONSULT GO(MSG-20260615-005324-wrkc):
--   · prescription_sets 에 set-level 태그(라벨/색/아이콘) 담을 빈 컬럼 없음(items=per-drug JSONB) → ADDITIVE 불가피.
--   · folder TEXT(nullable) 선례 미러. 파괴변경 아님 → ADDITIVE+DA GO = CEO 게이트 불요(§3.1), supervisor DDL-diff만.
--
-- 컬럼 설계(DA Q1 옵션A 확정 — 이산 TEXT 3컬럼, JSONB 아님):
--   tag_label TEXT  : 태그 라벨 텍스트(예: '무좀'). NULL=태그 없음.
--   tag_color TEXT  : 표지(presentation) 토큰 — tailwind 팔레트 토큰명 저장(purple/teal/rose/amber/sky/emerald/slate/...).
--                     ⚠ DB CHECK 미부여(DA Q2 (a)): tag_color=상태머신 값 아닌 표지 토큰 → CHECK 부여 시 팔레트 확장마다
--                     마이그+FE 동시갱신 결합비용만 늘고 무결성 이득 미미. canonical 팔레트는 FE(rxTagPalette.ts)에서 강제.
--   icon TEXT       : lucide 아이콘 식별자 — quick_rx_buttons.icon 과 동일 vocab(DRUG_ICON_OPTIONS) 재사용. NULL=아이콘 없음.
--
-- 멱등성: ADD COLUMN IF NOT EXISTS → 재실행 no-op. 기존 행 영향 없음(전부 NULL=태그없음).
-- 안전: nullable·default 없음·CHECK 없음·기존 컬럼 무접촉 → 무중단·무손실·완전 가역(rollback=DROP COLUMN).

BEGIN;

ALTER TABLE prescription_sets
  ADD COLUMN IF NOT EXISTS tag_label text,
  ADD COLUMN IF NOT EXISTS tag_color text,
  ADD COLUMN IF NOT EXISTS icon      text;

COMMENT ON COLUMN prescription_sets.tag_label IS '묶음처방 태그 라벨(예: 무좀). NULL=태그없음. T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER';
COMMENT ON COLUMN prescription_sets.tag_color IS '묶음처방 태그 색상 토큰(tailwind 팔레트명). FE-enforced enum(rxTagPalette.ts), DB CHECK 없음. T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER';
COMMENT ON COLUMN prescription_sets.icon      IS '묶음처방 아이콘(lucide 식별자, quick_rx_buttons.icon 동일 vocab). NULL=없음. T-20260615-foot-BUNDLERX-TAG-QUICKTRIGGER';

-- 검증: 3컬럼 존재 확인
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='prescription_sets'
    AND column_name IN ('tag_label','tag_color','icon');
  IF cnt <> 3 THEN
    RAISE EXCEPTION 'RXSET-TAG-META verify FAILED: expected 3 tag columns, found %', cnt;
  END IF;
  RAISE NOTICE 'RXSET-TAG-META OK: tag_label/tag_color/icon present on prescription_sets';
END $$;

COMMIT;
