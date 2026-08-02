-- FORWARD-DOC (원장↔파일 정합 복원) — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT §5.5 Option B
--   author: dev-foot / 2026-08-02
--   confirm: planner CONFIRM 2026-08-02 12:58 + supervisor CONCUR = Option A+B GO / Option C(DELETE) REJECT.
--   표준: Migration Ledger Reconciliation — "forward-doc" 분기(원장 ≠ 파일선언 divergence 정직 수렴).
--
-- ── 이 파일이 존재하는 이유 (naked phantom 의 파일-side 정합) ─────────────────────────
--   원장(supabase_migrations.schema_migrations)에는 version '20260724200000' 행이 실재하나(prod 정본),
--   워킹트리·전 git 브랜치 history 어디에도 대응 up.sql 파일이 없었다 = naked phantom.
--   이 phantom 은 자작러너 raw-exec stomp 시그니처(정상 named 07-24 마이그 사이에 낌) = 본 pilot(B1 actor-less
--   / 재발벡터 V2)이 차단하려는 OOB apply 벡터의 현물.
--
--   · created_by(원장행 축) divergence  → §5.5 Option A(20260802170002)에서 정직마커 'oob-unreconciled' 로 수렴.
--   · 원장↔파일(파일 부재 축) divergence → ★본 forward-doc 파일이 그 자리를 채워 정합 복원(마이그 디렉터리에
--     이제 20260724200000 대응 파일이 존재 = ledger row ↔ file 1:1).
--
-- ── DOC-ONLY / no-op 멱등 (★스키마·데이터 무접촉) ──────────────────────────────────
--   이 phantom 의 원래 DDL 은 규명 불가(naked). 따라서 본 파일은 어떤 스키마/데이터도 변경하지 않는다.
--   · prod: version 20260724200000 은 이미 원장에 applied → 러너는 본 파일을 skip(재실행 안 함).
--   · 재-apply(신환경 from-scratch 등): 아래 블록은 순수 정보성 no-op → 멱등(부작용 0).
--   ⚠ 정직성 원칙: 알 수 없는 DDL 을 추측 복원하지 않는다. 파일은 "이 phantom 의 진실"만 문서화한다.
-- =========================================================================

BEGIN;

DO $$
BEGIN
  -- 순수 정보성 — 스키마/데이터 변경 없음. re-apply 시에도 부작용 0(멱등 no-op).
  RAISE NOTICE 'forward-doc 20260724200000: OOB naked phantom (provenance 규명 불가). '
    'created_by 는 20260802170002 에서 정직마커 oob-unreconciled 로 reconcile 됨. '
    'DDL 미상 → 본 파일 no-op(원장↔파일 정합 복원 목적, 스키마 무접촉).';
END $$;

COMMIT;
