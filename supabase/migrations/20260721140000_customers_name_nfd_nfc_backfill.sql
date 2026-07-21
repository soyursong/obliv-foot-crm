-- T-20260721-foot-CUSTOMER-NAME-NFD-NFC-BACKFILL  (FOLD-IN 개정 2026-07-21)
-- 부모 RCA: T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA (MSG-20260721-103648-m2hl)
-- 자매(표시교정): T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE (20260721120000, mutation 0)
-- DA CONSULT-REPLY(GO): MSG-20260721-234423-xfat — CONDITIONAL GO / 파생 사본 FOLD-IN.
--
-- ⛔⛔ GATE_HOLD — supervisor 백필 승인(DB-gate) 수신 전 절대 적용 금지 ⛔⛔
--   DA GO 는 수신(xfat). 남은 게이트 = §2-S 확장(7→10) DA 재confirm + supervisor 백필 승인(불변 최종게이트).
--   본 UPDATE(PHI name mutable) 실적용은 supervisor 승인 후에만.
--   §S2.4 + Cross-CRM Data-Correction Backfill SOP v2.0(§0-2-a·§2-S·§3-5) + Migration Dry-Run No-Persistence Protocol 준수.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- DIAGNOSE + PREFLIGHT 결과 (foot prod rxlomoozakkjesdqjtvd, read_only, 2026-07-21)
--   [지문] char_length(v) <> char_length(normalize(v,NFC))  (NFD 자모분해 conjoining jamo).
--   [freeze-set = 7-row, 원자 배치]  (DA 명시 7 = customers 3 + reservations 3 + check_ins 1 과 정합)
--     · customers.name          3건: b734f069 F-4818 / f137fe98 F-4903 / 0fc0752c F-4920  ← 유일 SoT (실명 off-git freeze.json)
--     · reservations.customer_name 3건 + check_ins.customer_name 1건
--          → ★직접 UPDATE 하지 않음. customers.name UPDATE 시 트리거 trg_sync_customer_name(fn_sync_customer_name)이
--            AFTER UPDATE OF name 로 자동 cascade(customer_id 매칭 행을 NEW.name=NFC 로 동기). "정식 mirror"(버그 아님).
--   [§2-S 기계열거 결과 — 2 후보 전부 해소]
--     · aicc_crm_phone_match.name(3건 hit) = VIEW(`SELECT id customer_id, clinic_id, name, phone, created_at FROM customers`).
--          독립 저장 없음 = customers.name 을 그대로 read-through → customers 정정 시 자동 반영. 별도 UPDATE 불요/금지(뷰).
--     · notification_logs.body_rendered(7건) = 발송완료 메시지 감사로그(이름 embed). 검색/dedup surface 아님, 불변 이력 →
--          정정 시 "실제 발송 내용" 왜곡 → 백필 제외.
--   [clobber-safety 검증] 3 customer_id 의 reservations/check_ins customer_name 은 각 1개 distinct 값뿐이며 전부
--       customers.name 과 NFC-equal(개명/동행 등 정당한 상이 스냅샷 0) → cascade 가 in-place NFC 와 값-동일. clobber 0.
--   [§3-5 제약] customers.name·reservations/check_ins.customer_name·aicc.name 에 CHECK/UNIQUE(name) = 0건.
--       NFC collision 시뮬: clinic jongno 각 이름 NFC-equal 총 1건(=NFD 본인) → 기존 NFC 동명 충돌 0.
--       NOT NULL: customers.name / check_ins.customer_name = NOT NULL → NFC 는 값-보존(비-NULL 유지) → 안전.
--   [제외] notification_logs.body_rendered(7건, 이름 embed) = 발송완료 메시지 감사로그(불변 이력). 검색/dedup surface 아님 →
--       정정 시 "실제 발송 내용" 왜곡 → 백필 제외(DA 재confirm 요청 대상). 별도 정정 안 함.
--   [검색실패 재현] raw LIKE '%<이름>%'(off-git) = 0건 → 백필 후 normalize(NFC) LIKE = 1건 (F-4903 기준).
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 백필 계약 (SOP v2.0):
--   · 대상셋 freeze = 명시 PK/customer_id IN-list. ★단일 count/predicate 기준 대량 UPDATE 금지.
--   · 이중 가드: (freeze IN) AND (여전히 NFD). GO 전 수기 정정분은 지문 불일치로 자동 skip(no-touch).
--   · 멱등 in-place normalize(v,'NFC') — 값-보존, 재실행 no-op.
--   · affected 예상밖 abort: customers>3 → RAISE EXCEPTION → 전체 ABORT.
--   · cascade 사후검증: reservations/check_ins/전수(customers 포함) NFD 잔존이 0 이 아니면 ABORT.
--   · 원장(payments/service_charges) 무접점. clinic 격리(PK 자체가 jongno 한정). DDL 0.
--   · rollback 원값(NFD hex) = _backfill.rollback.sql + _freeze.json(off-git PHI) 보존.

BEGIN;

DO $$
DECLARE
  v_cust_expected  INT := 3;   -- ★ apply 시점 census 재확인 값 (진단=3)
  v_cust_aff  INT;
  v_nfd_cust  INT;
  v_nfd_resv  INT;
  v_nfd_chk   INT;
  v_nfd_aicc  INT;   -- aicc = VIEW(over customers) → customers 정정 시 자동 반영. 무결성 재확인용.
BEGIN
  -- ① customers.name (유일 SoT) — 트리거 cascade → reservations/check_ins.customer_name 자동 NFC.
  --    aicc_crm_phone_match(VIEW) 은 customers.name 을 read-through → 별도 UPDATE 없이 자동 반영.
  UPDATE public.customers c
     SET name = normalize(c.name, NFC)
   WHERE c.id IN (
           'b734f069-5a06-414b-9ad6-f32ee3b3bf2c',   -- F-4818
           'f137fe98-30b2-4a66-bcc0-73bc68277b58',   -- F-4903
           '0fc0752c-7ccd-4a71-85ec-b7e4e5f20527'    -- F-4920
         )
     AND c.name IS NOT NULL
     AND char_length(c.name) <> char_length(normalize(c.name, NFC));
  GET DIAGNOSTICS v_cust_aff = ROW_COUNT;

  -- affected 예상밖 abort
  IF v_cust_aff > v_cust_expected THEN
    RAISE EXCEPTION 'BACKFILL ABORT: customers affected=% > expected=%', v_cust_aff, v_cust_expected;
  END IF;

  -- cascade + 전수 NFD 잔존 사후검증 (트랜잭션 내 — 커밋 전 무결성 확인)
  SELECT count(*) INTO v_nfd_cust FROM public.customers            WHERE name IS NOT NULL          AND char_length(name)          <> char_length(normalize(name,NFC));
  SELECT count(*) INTO v_nfd_resv FROM public.reservations         WHERE customer_name IS NOT NULL AND char_length(customer_name) <> char_length(normalize(customer_name,NFC));
  SELECT count(*) INTO v_nfd_chk  FROM public.check_ins            WHERE customer_name IS NOT NULL AND char_length(customer_name) <> char_length(normalize(customer_name,NFC));
  SELECT count(*) INTO v_nfd_aicc FROM public.aicc_crm_phone_match WHERE name IS NOT NULL          AND char_length(name)          <> char_length(normalize(name,NFC));

  IF v_nfd_cust <> 0 OR v_nfd_resv <> 0 OR v_nfd_chk <> 0 OR v_nfd_aicc <> 0 THEN
    RAISE EXCEPTION 'BACKFILL ABORT: NFD 잔존 (cust=% resv=% chk=% aicc(view)=%) — cascade 미완/추가대상 발견',
      v_nfd_cust, v_nfd_resv, v_nfd_chk, v_nfd_aicc;
  END IF;

  RAISE NOTICE 'NFD→NFC backfill OK: customers=% (cascade→resv/chk, aicc-view 자동). NFD 잔존 전수 0.', v_cust_aff;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
-- POSTCHECK (apply 후 supervisor DB-gate)
--   1) NFD 잔존 census 0 (전수, 4 surface):
--      SELECT 'customers' t,count(*) FROM customers WHERE name IS NOT NULL AND char_length(name)<>char_length(normalize(name,NFC))
--      UNION ALL SELECT 'reservations',count(*) FROM reservations WHERE customer_name IS NOT NULL AND char_length(customer_name)<>char_length(normalize(customer_name,NFC))
--      UNION ALL SELECT 'check_ins',count(*) FROM check_ins WHERE customer_name IS NOT NULL AND char_length(customer_name)<>char_length(normalize(customer_name,NFC))
--      UNION ALL SELECT 'aicc',count(*) FROM aicc_crm_phone_match WHERE name IS NOT NULL AND char_length(name)<>char_length(normalize(name,NFC));  -- 기대 전부 0
--   2) 이름검색 재현(raw LIKE, 백필 후 ≥1): SELECT chart_number,char_length(name) len3 FROM customers WHERE chart_number='F-4903';  -- len 3 = NFC
--      (실이름 LIKE 재현은 off-git freeze.json name 으로 수행 — 본 파일에 실명 미기재)
--   3) cascade 확인: SELECT char_length(customer_name) FROM reservations WHERE customer_id='f137fe98-30b2-4a66-bcc0-73bc68277b58';  -- len 3
