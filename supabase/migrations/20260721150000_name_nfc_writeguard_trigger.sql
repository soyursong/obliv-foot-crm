-- T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL — AC-2 소스닫힘 하드닝 (storage-boundary NFC write-guard)
-- DA CONSULT-REPLY(GO): MSG-20260721-234913-hdm3 §3 "가드가 3 필드 write-site 전부를 normalize 해야 파생셋 전체
--   소스닫힘 성립" + §5 방어심층("각 경계가 자기 정합 방어 — 상류 신뢰 금지").
-- 상위 SOP: Cross-CRM Data-Correction 백필 SOP v2.0 §0-2(소스닫힘-先) / cross_crm_write 방어심층 라인.
--
-- ── 왜 트리거(storage boundary)인가 ──
--   기존 AC-2 = reservation-ingest-from-dopamine EF 인그레스 normalize(app 경계, L257/260) — 결정적 오염원
--   (도파민 NFD push) 을 닫는다. 단 EF 는 customers.name / reservations.customer_name 만 landing 하고
--   check_ins.customer_name 은 직접 쓰지 않는다(cascade trg_sync_customer_name 또는 kiosk/self_checkin_create,
--   fn_selfcheckin_create_check_in, FE 직접 INSERT 경로). hdm3 §3 는 "3 필드 write-site 전부" 를 요구 →
--   EF-only 로는 check_ins 직접 write-site + FE 직접 write-site 가 미가드로 남는다.
--   ∴ 저장 경계(BEFORE INSERT OR UPDATE)에서 normalize(NFC) 하면 write-path(EF/RPC/kiosk/FE/cascade) 무관하게
--   NFD 저장이 구조적으로 불가 → 3 write-site 전부 소스닫힘 성립 + forensics(NFD 신규 row=0) 구조적 보장.
--
-- ── 안전 성질 ──
--   · NFC = 무손실 canonicalization → 동일 grapheme, 표시 이름 불변. 값-보존.
--   · 멱등 — 이미 NFC 인 값은 normalize no-op(char 동일). never-downgrade.
--   · NULL/'' 무해(normalize(NULL)=NULL, normalize('')='').
--   · ADDITIVE — 신규 트리거만. 컬럼/테이블/enum 추가 0. 기존 데이터 미변경(트리거는 향후 write 시 발화).
--   · 마스킹-reject 가드(_fn_is_masked_pii, RPC 내 raise)와 직교 — 유니코드 정규화만, un-mask 아님.
--   · 기존 trg_sync_customer_name(AFTER UPDATE OF name) 과 정합: BEFORE 가 NEW.name 을 NFC 로 먼저 확정 →
--     AFTER cascade 가 NFC 값을 전파 → check_ins/reservations BEFORE 가드에서 재-normalize no-op.
--
-- Risk: 스키마 변경(트리거 신규)만. 데이터 변경 없음. Rollback: 20260721150000_name_nfc_writeguard_trigger.rollback.sql
-- ⚠ 배포 순서(DA §3): 본 가드 배포·live·forensics(신규 NFD=0) 통과 → 그 다음 백필(20260721140000) supervisor DB-gate.
--   본 가드는 백필과 별개 ADDITIVE 트랙(선행).

BEGIN;

-- ── 이름 컬럼 NFC 정규화 함수 (BEFORE INSERT OR UPDATE, 저장 경계 방어) ──
CREATE OR REPLACE FUNCTION public.fn_name_nfc_writeguard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- customers.name
  IF TG_TABLE_NAME = 'customers' THEN
    IF NEW.name IS NOT NULL THEN
      NEW.name := normalize(NEW.name, NFC);
    END IF;

  -- reservations.customer_name (+ customer_real_name 동행/본명 스냅샷: 동일 이름 표시/검색 필드)
  ELSIF TG_TABLE_NAME = 'reservations' THEN
    IF NEW.customer_name IS NOT NULL THEN
      NEW.customer_name := normalize(NEW.customer_name, NFC);
    END IF;
    IF NEW.customer_real_name IS NOT NULL THEN
      NEW.customer_real_name := normalize(NEW.customer_real_name, NFC);
    END IF;

  -- check_ins.customer_name
  ELSIF TG_TABLE_NAME = 'check_ins' THEN
    IF NEW.customer_name IS NOT NULL THEN
      NEW.customer_name := normalize(NEW.customer_name, NFC);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_name_nfc_writeguard() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_name_nfc_writeguard() IS
  '이름 컬럼(customers.name / reservations.customer_name,customer_real_name / check_ins.customer_name) 저장 경계 NFC 정규화 가드. NFD 저장 구조적 차단(값-보존·멱등). AC-2 소스닫힘 (T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL, DA hdm3 §3/§5).';

DROP TRIGGER IF EXISTS trg_name_nfc_writeguard ON public.customers;
CREATE TRIGGER trg_name_nfc_writeguard
  BEFORE INSERT OR UPDATE OF name ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_name_nfc_writeguard();

DROP TRIGGER IF EXISTS trg_name_nfc_writeguard ON public.reservations;
CREATE TRIGGER trg_name_nfc_writeguard
  BEFORE INSERT OR UPDATE OF customer_name, customer_real_name ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_name_nfc_writeguard();

DROP TRIGGER IF EXISTS trg_name_nfc_writeguard ON public.check_ins;
CREATE TRIGGER trg_name_nfc_writeguard
  BEFORE INSERT OR UPDATE OF customer_name ON public.check_ins
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_name_nfc_writeguard();

COMMIT;
