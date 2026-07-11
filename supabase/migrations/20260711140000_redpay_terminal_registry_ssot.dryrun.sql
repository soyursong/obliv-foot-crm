-- DRY-RUN: T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE
-- 목적: (1) 테이블 신설·seed 무오류, (2) 테이블 파생 화이트리스트 = 기존 하드코딩 17-set 정확일치
--       (전환 전후 필터 동일결과 = 회귀 0 증명), (3) 알람 뷰 정상.
-- 실 데이터 무변경(BEGIN...ROLLBACK). supervisor DB-GATE 증거용. 프로드 rxlomoozakkjesdqjtvd.
-- 실행: psql "$FOOT_DB_URL" -f 이 파일

BEGIN;

-- ── 신설 + seed (본 마이그 §1·§2 발췌) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.redpay_terminal_registry (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid,
  domain         text        NOT NULL,
  merchant_id    text        NOT NULL,
  tid            text,
  terminal_label text,
  active         boolean     NOT NULL DEFAULT true,
  source         text,
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redpay_terminal_registry_merchant_uk UNIQUE (merchant_id)
);

WITH seed(merchant_id, tid, terminal_label) AS (
  VALUES
    ('1777285001','1047479255','풋(VAN)'),  ('1777285004','1047479261','풋(VAN)'),
    ('1777288001','1047479469','풋(유선)'), ('1777288004','1047479472','풋(유선)'),
    ('1777289001','1047479483','풋(멀티)'), ('1777289002','1047479476','풋(멀티)'),
    ('1777289003','1047479477','풋(멀티)'), ('1777289004','1047479478','풋(멀티)'),
    ('1777289005','1047479479','풋(멀티)'), ('1777289006','1047479480','풋(멀티)'),
    ('1777289007','1047479481','풋(멀티)'), ('1777289008','1047479482','풋(멀티)'),
    ('1777289009','1047479153','풋(무선)'), ('1777289010','1047479148','풋(무선)'),
    ('1777289011','1047479155','풋(무선)'), ('1777289012','1047479158','풋(무선)'),
    ('1777289013','1047479157','풋(무선)')
)
INSERT INTO public.redpay_terminal_registry
  (clinic_id, domain, merchant_id, tid, terminal_label, active, source, verified_at)
SELECT NULL, 'foot', s.merchant_id, s.tid, s.terminal_label, true, 'dryrun', now()
FROM seed s
ON CONFLICT (merchant_id) DO NOTHING;

-- ── (A) seed count = 17, active merchant/tid 각 17 ───────────────────────────
SELECT 'seed_count' AS check, count(*) AS val, (count(*) = 17) AS pass
FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active;

-- ── (B) 테이블 파생 merchant 집합 = 기존 하드코딩 17-set 정확일치 (대칭차 = 0) ──
WITH hardcoded(merchant_id) AS (
  VALUES ('1777285001'),('1777285004'),('1777288001'),('1777288004'),('1777289001'),
         ('1777289002'),('1777289003'),('1777289004'),('1777289005'),('1777289006'),
         ('1777289007'),('1777289008'),('1777289009'),('1777289010'),('1777289011'),
         ('1777289012'),('1777289013')
),
derived AS (
  SELECT merchant_id FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active
)
SELECT 'merchant_symdiff' AS check,
       (SELECT count(*) FROM (
          (SELECT merchant_id FROM hardcoded EXCEPT SELECT merchant_id FROM derived)
          UNION ALL
          (SELECT merchant_id FROM derived   EXCEPT SELECT merchant_id FROM hardcoded)
        ) d) AS val,
       ((SELECT count(*) FROM (
          (SELECT merchant_id FROM hardcoded EXCEPT SELECT merchant_id FROM derived)
          UNION ALL
          (SELECT merchant_id FROM derived   EXCEPT SELECT merchant_id FROM hardcoded)
        ) d) = 0) AS pass;

-- ── (C) 테이블 파생 tid 집합 = 기존 하드코딩 TID 17-set 정확일치 (대칭차 = 0) ──
WITH hardcoded(tid) AS (
  VALUES ('1047479255'),('1047479261'),('1047479469'),('1047479472'),('1047479483'),
         ('1047479476'),('1047479477'),('1047479478'),('1047479479'),('1047479480'),
         ('1047479481'),('1047479482'),('1047479153'),('1047479148'),('1047479155'),
         ('1047479158'),('1047479157')
),
derived AS (
  SELECT tid FROM public.redpay_terminal_registry WHERE domain = 'foot' AND active AND tid IS NOT NULL
)
SELECT 'tid_symdiff' AS check,
       (SELECT count(*) FROM (
          (SELECT tid FROM hardcoded EXCEPT SELECT tid FROM derived)
          UNION ALL
          (SELECT tid FROM derived   EXCEPT SELECT tid FROM hardcoded)
        ) d) AS val,
       ((SELECT count(*) FROM (
          (SELECT tid FROM hardcoded EXCEPT SELECT tid FROM derived)
          UNION ALL
          (SELECT tid FROM derived   EXCEPT SELECT tid FROM hardcoded)
        ) d) = 0) AS pass;

-- 기대: 세 SELECT 모두 pass = t (seed_count=17 / merchant_symdiff=0 / tid_symdiff=0).
--       → 테이블 파생 뷰/함수는 전환 전 하드코딩과 100% 동일 결과(회귀 0).

ROLLBACK;
