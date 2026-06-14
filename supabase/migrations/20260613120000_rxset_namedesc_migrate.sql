-- T-20260610-foot-RXSET-NAMEDESC-MODEL — Q3 A-1 자동이관 (set.name → items[].name)
-- DECISION LOCK 2026-06-12 (문지은 대표원장): 처방세트 항목 = [이름+용량]/[설명] 2필드.
-- 기존 19세트는 약 이름이 set.name 에, items[0].name 엔 분류(예 "항생제 연고")가 들어가 있음.
-- → set.name 을 items[0].name(약 이름)으로 이관, 기존 분류명은 items[0].notes(설명)로 이동. 데이터손실 0.
--
-- ⚠ 파괴적 데이터 write. supervisor DB게이트(dry-run 건수대조 GO) 통과 후에만 apply.
-- 적용 주체: dev-foot 직접 실행 (대시보드 수동 금지 — dev-foot DB 마이그 직접 실행 정책).
-- dry-run 근거: 19/19 single-item, notes 전부 empty → 1:1 결정적 이관 (will_migrate=19, skip=0).
--
-- 멱등성: items[0].name = set.name 이면(=이미 이관) WHERE 절에서 제외 → 재실행 no-op.
-- 안전: single-item 세트만 대상(jsonb_array_length=1). multi-item 세트는 무접촉(현재 0건, 향후 등장 대비).

BEGIN;

-- 1) 전체 스냅샷 백업 (rollback 원천)
CREATE TABLE IF NOT EXISTS prescription_sets_namedesc_backup_20260613 (
  id           integer PRIMARY KEY,  -- prescription_sets.id is int4 (not uuid) — verified 2026-06-15
  name         text,
  items        jsonb,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO prescription_sets_namedesc_backup_20260613 (id, name, items)
SELECT id, name, items
FROM prescription_sets
WHERE jsonb_array_length(items) = 1
  AND (items->0->>'name') IS DISTINCT FROM name
ON CONFLICT (id) DO NOTHING;

-- 2) 자동이관: items[0].name ← set.name, items[0].notes ← (기존 notes 우선, 비면 기존 분류명)
UPDATE prescription_sets ps
SET items = jsonb_build_array(
      (ps.items->0)
      || jsonb_build_object(
           'name', ps.name,
           'notes',
             CASE
               WHEN COALESCE(NULLIF(TRIM(ps.items->0->>'notes'), ''), '') = ''
                 THEN COALESCE(ps.items->0->>'name', '')   -- 기존 분류 → 설명칸
               ELSE ps.items->0->>'notes'                  -- 기존 설명 보존(분류 덮어쓰기 금지)
             END
         )
    )
WHERE jsonb_array_length(ps.items) = 1
  AND (ps.items->0->>'name') IS DISTINCT FROM ps.name;

-- 3) 검증: 이관된 세트의 items[0].name 이 set.name 과 일치하는지 (불일치=0 기대)
DO $$
DECLARE
  mismatch int;
BEGIN
  SELECT count(*) INTO mismatch
  FROM prescription_sets ps
  JOIN prescription_sets_namedesc_backup_20260613 b ON b.id = ps.id
  WHERE jsonb_array_length(ps.items) = 1
    AND (ps.items->0->>'name') IS DISTINCT FROM ps.name;
  IF mismatch > 0 THEN
    RAISE EXCEPTION 'RXSET-NAMEDESC migrate verify FAILED: % set(s) still mismatched', mismatch;
  END IF;
  RAISE NOTICE 'RXSET-NAMEDESC migrate OK: % set(s) migrated',
    (SELECT count(*) FROM prescription_sets_namedesc_backup_20260613);
END $$;

COMMIT;
