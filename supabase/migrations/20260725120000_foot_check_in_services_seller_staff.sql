-- T-20260724-foot-COSMETIC-SELLER-ATTRIB A-1 — check_in_services.seller_staff_id (ADDITIVE)
--
-- DA CONSULT-REPLY: DA-20260724-foot-COSMETIC-SELLER-ATTRIB (verdict = GO / ADDITIVE)
--   정본 = 1_Projects/201_메디빌더_AI도입/da_reply_foot_cosmetic_seller_attrib_additive_20260724.md
--
-- ── 무엇 / 왜 ─────────────────────────────────────────────────────────────────
--   화장품(풋화장품) 수가는 check_in_services 에 저장되며 check_in→check_ins.therapist_id(담당 실장)에
--   귀속되어 실제 판매 치료사를 식별할 수 없었다. seller_staff_id 로 화장품 라인에 한해 "판매한 치료사"를
--   별도 귀속한다. NULL 허용 → 기존 행/비화장품 라인 미영향(forward-only).
--
-- ── ADDITIVE / 게이트 ───────────────────────────────────────────────────────
--   신규 컬럼 1개(NULL) + FK 1개 + 부분인덱스 1개만. 0행이동·값flip0 → autonomy §3.1 대표게이트 면제,
--   supervisor DDL-diff + 롤백 SQL 게이트만. ★백필 금지: seller_staff_id := therapist_id 블랭킷 복사
--   절대 금지(역오염). NULL='미상' 은 집계에서 폴백(COALESCE therapist_id)하되 원본은 forward-only.
--
-- ── FK 삭제규칙 (DA BINDING) ─────────────────────────────────────────────────
--   ON DELETE RESTRICT — staff 삭제 시 판매귀속 보존(CASCADE/SET NULL 금지, 귀속 감사 흔적 보존).
--
-- ⚠ up.sql 에 BEGIN/COMMIT/트랜잭션 제어문 없음(순수 ALTER + DO + INDEX) → dry-run txn-strip 무해.

ALTER TABLE public.check_in_services
  ADD COLUMN IF NOT EXISTS seller_staff_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'check_in_services_seller_staff_id_fkey'
       AND conrelid = 'public.check_in_services'::regclass
  ) THEN
    ALTER TABLE public.check_in_services
      ADD CONSTRAINT check_in_services_seller_staff_id_fkey
      FOREIGN KEY (seller_staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS check_in_services_seller_staff_id_idx
  ON public.check_in_services (seller_staff_id)
  WHERE seller_staff_id IS NOT NULL;

COMMENT ON COLUMN public.check_in_services.seller_staff_id IS
  'T-20260724-foot-COSMETIC-SELLER-ATTRIB: 화장품(풋화장품) 판매 치료사(staff.id). NULL=미상(집계 폴백 COALESCE therapist_id). forward-only, 백필 금지(역오염). 비화장품 라인은 항상 NULL.';
