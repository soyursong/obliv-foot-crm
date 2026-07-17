-- ════════════════════════════════════════════════════════════════════════════
-- T-20260716-foot-EXPPASS-TREATTYPE-CHECK-EXPAND
-- 풋 '체험권' 통계 태깅 — packages.treatment_type CHECK 에 '체험권' 토큰 ADDITIVE 확장
--
-- 근거: 김주연 총괄 요청('체험권 통계 잡아줘', C0ATE5P6JTH, 2026-07-16) +
--       DA CONSULT-REPLY MSG-20260716-065359-xapy (DA-20260716-FOOT-EXPPASS-TREATTYPE).
--   DA 정본: 1_Projects/201_메디빌더_AI도입/da_decision_foot_exppass_treattype_20260716.md
--
-- 판정:
--   Q1(packages CHECK '체험권' ADDITIVE) = GO → autonomy §3.1 대표게이트 면제, supervisor DDL-diff만.
--   Q2(treatment_standard_prices 동반확장) = NO — 체험권=기준정가(정찰가) 부재 프로모션 → tsp 등재 근거 없음.
--       tsp DDL 무변경(비파괴). 불변식 재정의: tsp CHECK = packages CHECK '100% 동일' → tsp ⊆ packages(부분집합).
--   Q3(기존 NULL 백필) = 조건부 GO·별도 게이트 — 본 배포 스코프 밖(forward-capture만, 백필은 후속).
--
-- ADDITIVE 안전: 허용집합 확대(5→6토큰). 기존 행 위반 0 — 현 체험권 구입건은 treatment_type=NULL 이고
--   CHECK 가 IS NULL 을 이미 허용. named constraint(chk_packages_treatment_type) 동일명 보존.
--   저장 canonical = '체험권' (Re:Born↔"리본" 과 달리 별도 표시라벨 분리 불요).
--
-- 멱등: DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT(6토큰). 재실행 안전.
--
-- ── ROLLBACK (원복 SQL) ──────────────────────────────────────────────────────
--   ⚠ 순서 주의: 원복 전 packages.treatment_type='체험권' 값이 존재하면 5토큰 CHECK 재적용이 실패한다.
--      → (선행) UPDATE public.packages SET treatment_type = NULL WHERE treatment_type = '체험권';  -- forward-capture 원복
--      → (본체)
--        ALTER TABLE public.packages DROP CONSTRAINT IF EXISTS chk_packages_treatment_type;
--        ALTER TABLE public.packages
--          ADD CONSTRAINT chk_packages_treatment_type
--          CHECK (treatment_type IS NULL OR treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born'));
--      → (원장) DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260716120000';
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- packages.treatment_type CHECK — 5토큰 → 6토큰(+ '체험권') ADDITIVE 확장.
--   named constraint 동일명 보존을 위해 DROP(IF EXISTS)→ADD. NULL 허용 가드 유지(레거시/미태깅).
--   기존 행 위반 0(현 체험권 행 treatment_type=NULL → IS NULL 통과) → ADD 즉시 검증 통과.
ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS chk_packages_treatment_type;

ALTER TABLE public.packages
  ADD CONSTRAINT chk_packages_treatment_type
  CHECK (treatment_type IS NULL OR treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born','체험권'));

COMMENT ON COLUMN public.packages.treatment_type IS
  'T-20260708/T-20260716 패키지 시술유형 태깅(수동 선택, 통계 시술유형별 객단가 집계용). CHECK 6토큰(비가열/가열/포돌로게/수액/Re:Born/체험권, 저장값=canonical, Re:Born 표시 "리본"·체험권 표시=저장동일). 체험권=기준정가(정찰가) 부재 프로모션 → treatment_standard_prices 미등재(tsp⊆packages 부분집합), reference_price NULL(할인율 "-"). session_type→treatment_type 런타임 파생(차감이벤트 grain)과 별 축 — 병합 금지. NULL=레거시/미태깅 허용.';

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260716120000', 'foot_pkg_treatment_type_add_exppass')
ON CONFLICT (version) DO NOTHING;

COMMIT;
