-- DRY-RUN: T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 의 BEGIN/COMMIT(txn-control) 는 strip. 아래 자체 BEGIN...ROLLBACK 안에서 UPDATE 실행.
--   · tx 내에서 affected/after 확인 후 ROLLBACK → prod 실적용 0.
--   · ROLLBACK 이후 post-probe(introspection)로 prod NFD 3건 잔존(=무영속) 재확인.
-- 프로드 rxlomoozakkjesdqjtvd 대상. 실행: psql "$FOOT_DB_URL" -f 이 파일 (또는 read_only=false 관리 API — GO 후에만).
--
-- ⛔ 이 dry-run 자체도 GO 전에는 실행하지 않는다(무영속이나, gate 순서 = census→CONSULT→GO→dryrun→apply).

-- ══════════════════════════════════════════════════════════════════════════════
-- PART A — before/after 대조 (read-only, txn 무관)
-- ══════════════════════════════════════════════════════════════════════════════
SELECT id, chart_number,
       name AS name_before,
       char_length(name) AS before_len,
       normalize(name, NFC) AS name_after,
       char_length(normalize(name, NFC)) AS after_len,
       encode(convert_to(name, 'UTF8'), 'hex') AS before_hex
  FROM public.customers
 WHERE id IN ('b734f069-5a06-414b-9ad6-f32ee3b3bf2c',
              'f137fe98-30b2-4a66-bcc0-73bc68277b58',
              '0fc0752c-7ccd-4a71-85ec-b7e4e5f20527')
 ORDER BY chart_number;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART B — 무영속 트랜잭션 apply (BEGIN...ROLLBACK)
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE v_affected INT;
BEGIN
  UPDATE public.customers c
     SET name = normalize(c.name, NFC)
   WHERE c.id IN ('b734f069-5a06-414b-9ad6-f32ee3b3bf2c',
                  'f137fe98-30b2-4a66-bcc0-73bc68277b58',
                  '0fc0752c-7ccd-4a71-85ec-b7e4e5f20527')
     AND c.name IS NOT NULL
     AND char_length(c.name) <> char_length(normalize(c.name, NFC));
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RAISE NOTICE '[DRYRUN] affected=% (기대 census 재확인 count)', v_affected;
END $$;

-- tx 내 회귀 확인: NFD 잔존 0 + 검색 재현
SELECT '[DRYRUN in-tx] NFD 잔존(기대 0)' AS chk,
       count(*) AS n
  FROM public.customers
 WHERE name IS NOT NULL AND char_length(name) <> char_length(normalize(name,NFC));

SELECT '[DRYRUN in-tx] 강승은 raw LIKE(기대 1)' AS chk, count(*) AS n
  FROM public.customers WHERE name LIKE '%강승은%';

ROLLBACK;   -- ★ 무영속 확정

-- ══════════════════════════════════════════════════════════════════════════════
-- PART C — post-probe: ROLLBACK 후 prod 실재 = 무영속 재확인 (기대: NFD 3건 잔존)
-- ══════════════════════════════════════════════════════════════════════════════
SELECT '[POST-PROBE] prod NFD 잔존(기대 3 = 무영속 증거)' AS chk,
       count(*) AS n
  FROM public.customers
 WHERE name IS NOT NULL AND char_length(name) <> char_length(normalize(name,NFC));
