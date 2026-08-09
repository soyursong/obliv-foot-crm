-- T-20260809-foot-KIOSK-SELFCHECKIN-UNIQUEID-CONSENT — §24 고유식별정보 별도동의 (ADDITIVE)
-- ════════════════════════════════════════════════════════════════════════════
-- da_consult_ref: DA-20260809-foot-KIOSK-SELFCHECKIN-UNIQUEID-CONSENT (CONSULT-REPLY MSG-20260809-232927-d169)
--   SSOT: agents/docs/da_replies/da_decision_foot_kiosk_selfcheckin_uniqueid_consent_20260809.md (996f7b88118)
--   판정 = 조건부 GO. Option B(신규 customers.consent_unique_id + p_consent_unique_id RPC arg, ADDITIVE)=canonical.
--     · 개보법 §24 고유식별정보 ≠ §23 민감정보 ≠ §15 privacy = 별 legal basis → 별 컬럼 신설(오버로드 금지 §16-3b#4).
--     · Option A(privacy_consent/consent_sensitive 재사용·의미확장)=REJECT (basis conflate → §24 입증책임 붕괴).
--     · consent_version=보완축(대체 아님) — 문안 신규추가 시 version bump 은 공유 3-튜플 원자성에 흡수.
--   자매축 직교 CONFIRM: consent_forms.form_type='unique_id'(문서-아티팩트 축, 20260809150000)
--     ⊥ 본건 customers boolean flag 축(키오스크 접수). 공존, 신규 CONSULT 정당.
--
-- change-class = ADDITIVE (nullable 컬럼1 + arg1 append·backfill0·기존행 mutation0) → §3.1 CEO 파괴게이트 면제.
--   ⚠ db_change=true(DDL 존재) → supervisor DDL-diff + 물리 GO-token 선행 의무 유지(AC-1, apply 前 chokepoint).
--
-- 구조: 개보법 §23 consent_sensitive 롤아웃(20260629120000 + 20260629160000)의 §24 직역 미러.
--   §23 이 손댄 동일 3 write-path 를 동일 ADDITIVE 패턴으로 §24 확장(collect-but-not-persist 방지):
--     1) customers.consent_unique_id BOOLEAN nullable + COMMENT (HARD: unique key 오독 차단)
--     2) fn_selfcheckin_update_personal_info      13-arg → 14-arg (예약검증 초진 개인정보 저장 경로)
--     3) fn_selfcheckin_rrn_match                 병합 set-list 에 consent_unique_id 이관 (merge-loss 방지)
--     4) fn_selfcheckin_upsert_customer_resolve_v4 신규 함수 = resolve_v3 본문 + p_consent_unique_id
--        (워크인/직접입력 실호출 경로, ANON-KIOSK-CUTOVER. 버전명 함수 = 오버로드 ambiguity 0, DA §제약#1)
--
-- ── §24 flag 는 공유 3-튜플(consent_agreed_at/consent_version) 편승 — 신규 timestamp 컬럼 불요(DA Q3) ──
--     · consent_unique_id=true → agreed_at+version 동반(3-튜플 원자성, DA §제약#2). 부분적재 금지.
--     · agreed_at/version = COALESCE 최초기록 보존(비파괴, DA §제약#3). 철회는 별도경로(도입 시 CONSULT).
--     · sensitive-only 호출(unique_id NULL) 시 조건은 원 sensitive 술어로 환원 = byte-identical(VG3 무회귀).
--
-- ── RRN 원문 무접촉(DA Q2 CONFIRM) ── encrypted_rrn/rrn_encrypt/§16-4/§31 무접촉. flag boolean 만 추가.
--
-- verify-gate 매핑(apply 前 BLOCKING, DA HARD):
--   VG1 arg 끝-append only(resolve_v4=버전명·ambiguity0 / personal_info 13-arg DROP 후 14-arg 재생성)
--   VG2 3-튜플 원자성(consent_unique_id=true → agreed_at+version 동반)
--   VG3 기존 flag 무회귀(sensitive-only 술어 환원 byte-identical, resolve_v3 잔존 무변경)
--   VG4 RRN 원문경로 무접촉(census: 본 마이그 encrypted_rrn/rrn 참조 0)
--   VG5 nullable forward-only(no DEFAULT·backfill0) + down 대칭(.rollback.sql)
--   VG6 (FE) foot-checkin SelfCheckIn §24 체크박스 필수 — 별 아티팩트(foot-checkin repo)
--
-- 게이트 순서(AC-1, supervisor 소관 apply-order): DA GO → dev-foot 구현(본 파일, VG1~6)
--   → supervisor DDL-diff + 물리 GO-token 발행 → apply. (마이그 apply 를 FE 배포보다 선행 — C16 deploy-order)
-- 병행(비-blocking): §24 별도동의 문안 + consent_version bump = legal(김숭주) 소관, 수집 라이브 前 선행.
-- author: dev-foot / 2026-08-09 · ticket: T-20260809-foot-KIOSK-SELFCHECKIN-UNIQUEID-CONSENT
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. customers ADDITIVE 1컬럼 (nullable, no DEFAULT — VG5 forward-only, backfill0) ──────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS consent_unique_id BOOLEAN;

COMMENT ON COLUMN public.customers.consent_unique_id IS
  '개보법 §24 고유식별정보(주민번호/외국인등록번호/여권번호) 별도동의'
  ' [T-20260809-foot-KIOSK-SELFCHECKIN-UNIQUEID-CONSENT] '
  '동의 boolean flag(고유 key/unique constraint 아님). §23 consent_sensitive 와 별 legal basis(별 컬럼). '
  '증빙 시각/버전은 공유 3-튜플 consent_agreed_at/consent_version 편승. nullable — 미수집 기존 row 는 NULL(허위 false 금지).';

-- ─── 2. fn_selfcheckin_update_personal_info — 13-arg → 14-arg canonical 재정의 ────────────────
-- 잔존 13-arg(20260629120000) DROP 후 14-arg 재생성(오버로드 모호성 제거 — VG1). +p_consent_unique_id 끝-append.
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT  -- 13-arg (현 prod canonical)
);

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_update_personal_info(
  p_check_in_id        UUID,
  p_clinic_id          UUID,
  p_birth_date         TEXT     DEFAULT NULL,
  p_address            TEXT     DEFAULT NULL,
  p_address_detail     TEXT     DEFAULT NULL,
  p_postal_code        TEXT     DEFAULT NULL,
  p_privacy_consent    BOOLEAN  DEFAULT NULL,
  p_insurance_consent  BOOLEAN  DEFAULT NULL,   -- → hira_consent
  p_visit_route        TEXT     DEFAULT NULL,
  p_visit_route_detail TEXT     DEFAULT NULL,
  p_consent_sensitive  BOOLEAN     DEFAULT NULL,
  p_consent_agreed_at  TIMESTAMPTZ DEFAULT NULL,
  p_consent_version    TEXT        DEFAULT NULL,
  -- T-20260809 §24: 고유식별정보 별도동의 1파라미터 (DEFAULT NULL → 구 13-arg FE 하위호환)
  p_consent_unique_id  BOOLEAN     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci check_ins%ROWTYPE;
BEGIN
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  -- 고객 정보 업데이트 (NULL 파라미터는 기존 값 유지)
  UPDATE customers
  SET
    birth_date         = COALESCE(p_birth_date,         birth_date),
    address            = COALESCE(p_address,            address),
    address_detail     = COALESCE(p_address_detail,     address_detail),
    postal_code        = COALESCE(p_postal_code,        postal_code),
    privacy_consent    = COALESCE(p_privacy_consent,    privacy_consent),
    privacy_consent_at = CASE
                           WHEN p_privacy_consent = true  THEN now()
                           WHEN p_privacy_consent = false THEN NULL
                           ELSE privacy_consent_at
                         END,
    visit_route        = COALESCE(p_visit_route,        visit_route),
    visit_route_detail = COALESCE(p_visit_route_detail, visit_route_detail),
    hira_consent       = CASE
                           WHEN p_insurance_consent = true THEN true
                           ELSE hira_consent
                         END,
    hira_consent_at    = CASE
                           WHEN p_insurance_consent = true THEN now()
                           ELSE hira_consent_at
                         END,
    -- T-20260615-foot-CONSENT-SENSITIVE (개보법 §23): FALSE→TRUE no-downgrade, 최초기록 보존. (무변경)
    consent_sensitive  = CASE
                           WHEN p_consent_sensitive = true THEN true
                           ELSE consent_sensitive
                         END,
    -- T-20260809 §24 고유식별정보: FALSE→TRUE no-downgrade (별 legal basis, 별 flag).
    consent_unique_id  = CASE
                           WHEN p_consent_unique_id = true THEN true
                           ELSE consent_unique_id
                         END,
    -- 공유 3-튜플: sensitive OR unique_id 중 하나라도 TRUE 시 최초기록 보존(COALESCE).
    --   unique_id NULL(구 FE) → 술어가 p_consent_sensitive=true 로 환원 = byte-identical(VG3).
    consent_agreed_at  = CASE
                           WHEN p_consent_sensitive = true OR p_consent_unique_id = true
                             THEN COALESCE(consent_agreed_at, p_consent_agreed_at, now())
                           ELSE consent_agreed_at
                         END,
    consent_version    = CASE
                           WHEN p_consent_sensitive = true OR p_consent_unique_id = true
                             THEN COALESCE(consent_version, p_consent_version, 'foot-2026-06')
                           ELSE consent_version
                         END,
    updated_at         = now()
  WHERE id        = v_ci.customer_id
    AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_update_personal_info(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TEXT, BOOLEAN
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_update_personal_info IS
  'T-20260611(consolidate)+T-20260615(§23 sensitive)+T-20260809(§24 unique_id): 초진 셀프접수 개인정보 저장 14-arg.'
  ' 생년월일·주소·동의(privacy+at, hira+at, sensitive/unique_id + 공유 agreed_at/version)·방문경로.'
  ' §24 unique_id: FALSE→TRUE no-downgrade, sensitive 와 공유 3-튜플 최초기록 보존(COALESCE, foot-2026-06).'
  ' 하위호환: 구 13-arg 호출자는 신규 p_consent_unique_id DEFAULT NULL. anon SECURITY DEFINER — 30분/clinic 이중검증. RRN 비저장.';

-- ─── 3. fn_selfcheckin_rrn_match — 병합 set-list 에 consent_unique_id 이관 추가 ───────────────
-- (merge-path 보강: 2레코드 병합 시 셀프접수 임시레코드의 §24 동의가 ⑥ DELETE 로 유실되는 것 방지.
--  §23 sensitive 와 동일 패턴 — flag true 우선(다운그레이드 방지). 시그니처(UUID,UUID) 불변.
--  ★ 공유 3-튜플 agreed_at/version 이관 로직은 무변경(byte-identical, VG3) — sensitive 와 unique_id 는
--    키오스크에서 동시 캡처되어 sensitive 술어가 이미 timestamp 를 이관(공존). flag 만 추가 이관.)
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_rrn_match(
  p_check_in_id  UUID,
  p_clinic_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ci             check_ins%ROWTYPE;
  v_self_bd        TEXT;
  v_self_cust_id   UUID;
  v_target_cust_id UUID;
  v_today          DATE;
BEGIN
  SELECT * INTO v_ci
  FROM   check_ins
  WHERE  id        = p_check_in_id
    AND  clinic_id = p_clinic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'check_in_not_found');
  END IF;

  IF v_ci.checked_in_at < (now() - INTERVAL '30 minutes') THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_old');
  END IF;

  IF v_ci.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_customer_id');
  END IF;

  v_self_cust_id := v_ci.customer_id;

  SELECT birth_date INTO v_self_bd
  FROM   customers
  WHERE  id = v_self_cust_id;

  IF v_self_bd IS NULL OR length(v_self_bd) < 6 THEN
    RETURN jsonb_build_object('success', true, 'matched', false, 'reason', 'no_birth_date');
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;

  SELECT c.id INTO v_target_cust_id
  FROM   customers c
  JOIN   check_ins ci ON ci.customer_id = c.id
  WHERE  c.clinic_id  = p_clinic_id
    AND  c.id        <> v_self_cust_id
    AND  c.birth_date = v_self_bd
    AND  (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::DATE = v_today
    AND  ci.status   <> 'cancelled'
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_target_cust_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'matched', false);
  END IF;

  UPDATE check_ins
  SET    customer_id = v_target_cust_id
  WHERE  id = p_check_in_id;

  -- ⑤ 기존 고객 레코드에 selfcheckin 수집 최신 데이터 병합 (동의류 src=true 우선, 다운그레이드 방지)
  UPDATE customers dest
  SET
    birth_date         = COALESCE(src.birth_date,      dest.birth_date),
    address            = COALESCE(src.address,         dest.address),
    postal_code        = COALESCE(src.postal_code,     dest.postal_code),
    address_detail     = COALESCE(src.address_detail,  dest.address_detail),
    hira_consent       = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
    hira_consent_at    = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
                              THEN src.hira_consent_at
                             ELSE dest.hira_consent_at
                        END,
    privacy_consent    = CASE WHEN src.privacy_consent = true THEN true ELSE dest.privacy_consent END,
    privacy_consent_at = CASE WHEN src.privacy_consent = true AND dest.privacy_consent IS DISTINCT FROM true
                              THEN src.privacy_consent_at
                             ELSE dest.privacy_consent_at
                        END,
    sms_opt_in         = CASE WHEN src.sms_opt_in = true THEN true ELSE dest.sms_opt_in END,
    sms_opt_in_at      = CASE WHEN src.sms_opt_in = true AND dest.sms_opt_in IS DISTINCT FROM true
                              THEN src.sms_opt_in_at
                             ELSE dest.sms_opt_in_at
                        END,
    consent_sensitive  = CASE WHEN src.consent_sensitive = true THEN true ELSE dest.consent_sensitive END,
    -- T-20260809 §24: unique_id flag 이관 (src=true 우선, no-downgrade). 신규 컬럼 없음.
    consent_unique_id  = CASE WHEN src.consent_unique_id = true THEN true ELSE dest.consent_unique_id END,
    consent_agreed_at  = CASE WHEN src.consent_sensitive = true AND dest.consent_sensitive IS DISTINCT FROM true
                              THEN src.consent_agreed_at
                             ELSE dest.consent_agreed_at
                        END,
    consent_version    = CASE WHEN src.consent_sensitive = true AND dest.consent_sensitive IS DISTINCT FROM true
                              THEN src.consent_version
                             ELSE dest.consent_version
                        END,
    updated_at         = now()
  FROM customers src
  WHERE dest.id   = v_target_cust_id
    AND src.id    = v_self_cust_id;

  IF NOT EXISTS (
    SELECT 1 FROM check_ins WHERE customer_id = v_self_cust_id AND id <> p_check_in_id
  ) THEN
    DELETE FROM customers WHERE id = v_self_cust_id AND clinic_id = p_clinic_id;
  END IF;

  RETURN jsonb_build_object(
    'success',               true,
    'matched',               true,
    'merged_to_customer_id', v_target_cust_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_rrn_match(UUID, UUID)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_rrn_match IS
  'T-20260611(merge-path)+T-20260615(§23 sensitive)+T-20260809(§24 unique_id): 셀프접수 주민번호 자동 매칭. '
  'birth_date(앞6자리)+당일 check_in 으로 데스크 레코드와 병합. '
  '병합 시 address/postal_code/address_detail(COALESCE) + hira/privacy/sms/sensitive/unique_id 동의(true 우선) 전부 이관. '
  '공유 agreed_at/version 은 sensitive 술어로 이관(unique_id 는 키오스크 동시캡처로 공존). anon SECURITY DEFINER — 30분/clinic 이중검증.';

-- ─── 4. fn_selfcheckin_upsert_customer_resolve_v4 — 신규 함수(버전명, VG1 오버로드 ambiguity0) ──
-- = resolve_v3(20260719120000, created_by 스탬프 포함) 본문 + p_consent_unique_id 끝-append.
--   구 resolve_v3(15-arg) 무변경·잔존(VG3 무회귀). FE repoint(v3→v4)는 컷오버(마이그 apply 선행).
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v4(
  p_clinic_id         UUID,
  p_name              TEXT,
  p_phone             TEXT,
  p_visit_type        TEXT,
  p_sms_opt_in        BOOLEAN     DEFAULT NULL,
  p_birth_date        TEXT        DEFAULT NULL,
  p_address           TEXT        DEFAULT NULL,
  p_postal_code       TEXT        DEFAULT NULL,
  p_address_detail    TEXT        DEFAULT NULL,
  p_customer_email    TEXT        DEFAULT NULL,
  p_privacy_consent   BOOLEAN     DEFAULT NULL,
  p_hira_consent      BOOLEAN     DEFAULT NULL,
  p_consent_sensitive BOOLEAN     DEFAULT NULL,
  p_consent_agreed_at TIMESTAMPTZ DEFAULT NULL,
  p_consent_version   TEXT        DEFAULT NULL,
  -- T-20260809 §24: 고유식별정보 별도동의 1파라미터 (DEFAULT NULL, 끝-append — VG1)
  p_consent_unique_id BOOLEAN     DEFAULT NULL
)
RETURNS TABLE(customer_id UUID, link_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name   TEXT := NULLIF(btrim(p_name), '');
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT;
  v_count  INT;
  v_id     UUID;
BEGIN
  IF p_clinic_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  v_canon := CASE
    WHEN length(v_digits) < 8 THEN NULL
    WHEN v_digits LIKE '0%'  THEN '82' || substring(v_digits FROM 2)
    WHEN v_digits LIKE '82%' THEN v_digits
    ELSE v_digits
  END;

  IF v_canon IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon;

    IF v_count >= 2 THEN
      RETURN QUERY SELECT NULL::uuid, 'ambiguous'::text;
      RETURN;

    ELSIF v_count = 1 THEN
      SELECT c.id INTO v_id
        FROM customers c
       WHERE c.clinic_id = p_clinic_id
         AND c.name = v_name
         AND ( CASE
                 WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                   THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
                 ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
               END ) = v_canon
       LIMIT 1;

      -- 전달된 값만 멱등 persist(COALESCE 보존).
      UPDATE customers SET
        sms_opt_in         = COALESCE(p_sms_opt_in, sms_opt_in),
        sms_opt_in_at      = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                                  WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
        customer_email     = COALESCE(NULLIF(btrim(p_customer_email),''), customer_email),
        birth_date         = COALESCE(NULLIF(btrim(p_birth_date),''), birth_date),
        address            = COALESCE(NULLIF(btrim(p_address),''), address),
        postal_code        = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
        address_detail     = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail),
        privacy_consent    = COALESCE(p_privacy_consent, privacy_consent),
        privacy_consent_at = CASE WHEN p_privacy_consent IS TRUE THEN now()
                                  WHEN p_privacy_consent IS FALSE THEN NULL ELSE privacy_consent_at END,
        hira_consent       = COALESCE(p_hira_consent, hira_consent),
        hira_consent_at    = CASE WHEN p_hira_consent IS TRUE THEN now()
                                  WHEN p_hira_consent IS FALSE THEN NULL ELSE hira_consent_at END,
        -- ── §23 민감정보 동의 — no-downgrade + 최초기록 보존(무변경, VG3) ──
        consent_sensitive  = CASE WHEN p_consent_sensitive IS TRUE THEN true
                                  ELSE consent_sensitive END,
        -- ── §24 고유식별정보 동의 — no-downgrade(별 legal basis, 별 flag) ──
        consent_unique_id  = CASE WHEN p_consent_unique_id IS TRUE THEN true
                                  ELSE consent_unique_id END,
        -- 공유 3-튜플: sensitive OR unique_id 중 하나라도 TRUE 시 최초기록 보존(COALESCE).
        --   unique_id NULL(구 v3 호출) 시 술어는 sensitive 로 환원 = byte-identical(VG3).
        consent_agreed_at  = CASE WHEN p_consent_sensitive IS TRUE OR p_consent_unique_id IS TRUE
                                    THEN COALESCE(consent_agreed_at, p_consent_agreed_at, now())
                                  ELSE consent_agreed_at END,
        consent_version    = CASE WHEN p_consent_sensitive IS TRUE OR p_consent_unique_id IS TRUE
                                    THEN COALESCE(consent_version, p_consent_version, 'foot-2026-06')
                                  ELSE consent_version END
       WHERE id = v_id;

      RETURN QUERY SELECT v_id, 'linked'::text;
      RETURN;
    END IF;
  END IF;

  -- ── 0건(또는 연락처 미가용) → 신규 INSERT ──
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    consent_sensitive, consent_unique_id, consent_agreed_at, consent_version,
    created_by
  ) VALUES (
    p_clinic_id, v_name, NULLIF(p_phone,''),
    CASE WHEN p_visit_type = 'new' THEN 'new' ELSE 'returning' END,
    COALESCE(p_sms_opt_in, true),
    CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
    NULLIF(btrim(p_customer_email),''),
    NULLIF(btrim(p_birth_date),''),
    NULLIF(btrim(p_address),''),
    NULLIF(btrim(p_postal_code),''),
    NULLIF(btrim(p_address_detail),''),
    COALESCE(p_privacy_consent, false),
    CASE WHEN p_privacy_consent IS TRUE THEN now() ELSE NULL END,
    COALESCE(p_hira_consent, false),
    CASE WHEN p_hira_consent IS TRUE THEN now() ELSE NULL END,
    -- §23: sensitive=true 시에만 동의 기록(DB DEFAULT FALSE 고수 — 미동의 허위기록 방지).
    COALESCE(p_consent_sensitive, false),
    -- §24: nullable 편승 — 전달값 그대로(NULL=미수집 unknown, 허위 false 금지, VG5).
    p_consent_unique_id,
    -- 공유 3-튜플: sensitive OR unique_id 중 하나라도 TRUE 시 기록.
    CASE WHEN p_consent_sensitive IS TRUE OR p_consent_unique_id IS TRUE THEN COALESCE(p_consent_agreed_at, now()) ELSE NULL END,
    CASE WHEN p_consent_sensitive IS TRUE OR p_consent_unique_id IS TRUE THEN COALESCE(p_consent_version, 'foot-2026-06') ELSE NULL END,
    'self_checkin'  -- T-20260716 landing 스탬프(new-write-only)
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
  RETURN;

EXCEPTION WHEN unique_violation THEN
  IF v_canon IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE; END IF;
  RETURN QUERY SELECT v_id, 'linked'::text;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v4(
  UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TEXT, BOOLEAN
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v4 IS
  'T-20260809-foot-KIOSK-SELFCHECKIN-UNIQUEID-CONSENT: 셀프체크인 고객 upsert RESOLVE v4 (ADDITIVE). '
  '= resolve_v3(created_by 스탬프 포함) 본문 + §24 고유식별정보 동의 p_consent_unique_id(개보법 §24). '
  'unique_id: FALSE→TRUE no-downgrade, §23 sensitive 와 공유 3-튜플(agreed_at/version) 최초기록 보존(COALESCE, foot-2026-06). '
  'sensitive-only 호출 시 술어 환원 = v3 byte-identical(무회귀). 복합키[성함 AND 연락처 canonical] — linked/created/ambiguous. '
  '반환형 v3 동일(drop-in). customer_id 입력 없음(§16-5). 구 resolve_v3(15-arg) 잔존 — FE repoint 는 컷오버(마이그 apply 선행).';

-- PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (supervisor apply 후):
--
-- -- 컬럼 실재 + nullable + COMMENT
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_name='customers' AND column_name='consent_unique_id';
-- SELECT col_description('public.customers'::regclass,
--          (SELECT attnum FROM pg_attribute WHERE attrelid='public.customers'::regclass AND attname='consent_unique_id'));
--
-- -- 함수 시그니처(v3 잔존 + v4 신규 + personal_info 14-arg)
-- SELECT proname, pg_get_function_identity_arguments(oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public'
--    AND p.proname IN ('fn_selfcheckin_upsert_customer_resolve_v3',
--                      'fn_selfcheckin_upsert_customer_resolve_v4',
--                      'fn_selfcheckin_update_personal_info',
--                      'fn_selfcheckin_rrn_match')
--  ORDER BY proname;
-- ════════════════════════════════════════════════════════════════════════════
