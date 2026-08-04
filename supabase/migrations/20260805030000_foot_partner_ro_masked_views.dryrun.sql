-- DRY-RUN: T-20260720-foot partner_ro 마스킹 뷰 (무영속 검증용)
-- 러너 harness가 sentinel RAISE로 rollback → prod 무영속. Step 9(롤 프로비저닝)=미포함.
-- ⚠ top-level BEGIN/COMMIT 없음 (migration_dryrun_no_persistence_standard v1.0)

-- partner_ro 마스킹 read-only 뷰 정의 DRAFT — 풋센터(obliv-foot-crm)
-- assignee: dev-foot | change-class: ADDITIVE (신규 스키마·함수·뷰만, 기존 무접점) | db_change: DRAFT(미적용)
-- 2026-08-05 03:00 KST
-- =====================================================
-- ★★ 이 파일은 "뷰 정의 설계입력(draft)"이다. 발급 evidence 아님. 자동적용 금지. ★★
--   적용은 아래 잔여 게이트 全 clear 후 supervisor DDL-diff(WARN-3) 하에서만:
--     · gate_a  = ENV-SERVICEROLE-LIVECRED 로테이션 완료 (구 credential 반출 금지)
--     · gate_c  = legal REQUIRED (가명정보 개보법 §26 internal/external 판정, 김숭주)
--     · gate_c(exec) = soyursong(project owner) 또는 CEO-admin — 롤 발급/GRANT 집행 주체
--                      (dev-foot는 management 권한無·§5 → 본 파일 = 뷰 draft + Step 9 runbook 한정)
--     · WARN-3  = supervisor DDL-diff (prod drift 실증 + base grant=0 + 42501 + 마스킹 실렌더 + allowlist assert)
-- =====================================================
-- 근거 SSOT: da_replies/da_decision_foot_eunsang_dbreadonly_phi_scope_20260805.md
--            §ADDENDUM-WARN2-CONFIRM (분류표 ACCEPT·2 tightening + allowlist projection 하드조건)
-- 반영된 DA 판정:
--   ① ★allowlist projection (전 뷰 공통·최중대): PASS 컬럼을 SELECT에 명시 열거. SELECT * 금지.
--      → 향후 base ADD COLUMN = default exclude-until-classified(fail-closed·silent-leak 차단).
--   ② Item1 correction 2건 + postal:
--        · customers.first_inflow_source_ref = BLOCK (tightening MASK→BLOCK, free-text 물리제외)
--        · customers.chart_number = PASS-tier이나 default EXCLUDE(뷰에서 omit·customer_id opaque가 join 충족)
--        · customers.postal_code = MASK-coarsen (시군구 prefix, building-level 제거)
--   ③ ★재-CONSULT 확정(dev-foot 실스키마 검증):
--        · reservations.referral_source = TEXT·CHECK/enum 부재 = free-text → BLOCK (§36 freeze 병행축)
--        · customers.first_inflow_source_ref = TEXT·제약 부재 = free-text(inbound.etc 사유 hint) → BLOCK
--        · (대비) first_inflow_channel / inflow_channel = system_codes 11코드 coded → PASS
--      ⇒ 두 컬럼 모두 coded 아님 확인 → PASS 재편 불요, BLOCK 확정. re-CONSULT 트리거 미발동.
--   ④ Item2 v_package_sessions 편입 GO (starter 6→7). memo/surcharge_memo BLOCK, customer 식별컬럼 부재.
--   ⑤ Item3 v_redpay_masked 편입 GO. raw_payload 물리제외(BLOCK), customer 식별컬럼 0, root_trxid 미분류→제외.
--   ⑥ Item4 진료층(진료차트·처방·문진·동의서명·보험청구·자유텍스트 메모·감사 payload) 전면제외 = 뷰 미생성.
-- 일반원칙: unbounded free-text(memo/notes/source_ref/referral_source) = CLASS-BLOCK by default.
-- ⚠ top-level BEGIN/COMMIT 없음 (무영속 dry-run 러너 harness 호환, migration_dryrun_no_persistence_standard v1.0)
-- 스키마 출처 = migration 정적추출(commit 이후). prod 실재 컬럼 drift는 WARN-3에서 재대조.
-- =====================================================

-- ════════════════════════════════════════════════════════════════════
-- Step 0: 전용 스키마 (owner-rights 마스킹 뷰 격리면)
-- ════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS partner_ro;
COMMENT ON SCHEMA partner_ro IS
  'T-20260720 파트너(이은상/AI솔루션팀) read-only 노출면. owner-rights 마스킹 뷰 전용. base public 테이블 직접 grant=0. 롤=전용 제한 Postgres 롤+pooler 직결(대시보드/멤버초대 부적격). 롤백=DROP SCHEMA partner_ro CASCADE.';

-- ════════════════════════════════════════════════════════════════════
-- Step 1: 마스킹 헬퍼 함수 (IMMUTABLE·테이블 무접근·순수 텍스트 변환)
--   §16-3a 준용. free-text는 마스킹 대상 아님(BLOCK=물리제외) → 여기엔 known-shape 식별자 변환만.
-- ════════════════════════════════════════════════════════════════════

-- 성명: 김철수→김**, 홍길동→홍*동, 이수→이* , 김→* (first/last 유지·중간 마스킹)
CREATE OR REPLACE FUNCTION partner_ro.mask_name(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR length(btrim(p)) = 0 THEN NULL
    WHEN char_length(p) = 1 THEN '*'
    WHEN char_length(p) = 2 THEN left(p,1) || '*'
    ELSE left(p,1) || repeat('*', char_length(p)-2) || right(p,1)
  END
$$;

-- 주소: 시도·시군구까지 coarsen (앞 2토큰), building-level 제거
CREATE OR REPLACE FUNCTION partner_ro.mask_region(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR length(btrim(p)) = 0 THEN NULL
    ELSE nullif(btrim(split_part(btrim(p),' ',1) || ' ' || split_part(btrim(p),' ',2)), '')
  END
$$;

-- 우편번호: 5자리→시군구 prefix 3자리 (fine-grained geo quasi-id 제거)
CREATE OR REPLACE FUNCTION partner_ro.mask_postal(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR length(btrim(p)) = 0 THEN NULL
    ELSE nullif(left(regexp_replace(p, '[^0-9]', '', 'g'), 3), '')
  END
$$;

-- email: 도메인만 (@example.com)
CREATE OR REPLACE FUNCTION partner_ro.mask_email_domain(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR position('@' in p) = 0 THEN NULL
    ELSE '@' || split_part(p, '@', 2)
  END
$$;

-- 생년월일(text)→출생연도만 (4자리). 밴드 필요 시 QC 단계 재조정.
CREATE OR REPLACE FUNCTION partner_ro.mask_birth_year(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT (regexp_match(coalesce(p,''), '(\d{4})'))[1]
$$;

-- ════════════════════════════════════════════════════════════════════
-- Step 2: starter 뷰 7종 — 전부 allowlist projection (SELECT * 금지)
--   security_barrier=true (마스킹 우회 leak 방지). 기본 owner-rights(security_invoker 미설정).
-- ════════════════════════════════════════════════════════════════════

-- ── 2.1 v_customers_masked ← public.customers ────────────────────────
--   MASK 5: display_name·birth_year·region·postal_prefix·email_domain
--   BLOCK/omit: name(raw)·phone·birth_date(raw)·address(raw)·address_detail·postal_code(raw)·
--               customer_email(raw)·rrn_enc·passport_number·memo·chart_number(omit)·first_inflow_source_ref(BLOCK)
CREATE OR REPLACE VIEW partner_ro.v_customers_masked
  WITH (security_barrier = true) AS
  SELECT
    id,
    clinic_id,
    partner_ro.mask_name(name)                    AS display_name,
    partner_ro.mask_birth_year(birth_date)        AS birth_year,
    partner_ro.mask_region(address)               AS region,
    partner_ro.mask_postal(postal_code)           AS postal_prefix,
    partner_ro.mask_email_domain(customer_email)  AS email_domain,
    visit_type,
    customer_grade,
    assigned_staff_role,
    is_simulation,
    privacy_consent,
    sms_reject,
    marketing_reject,
    first_inflow_channel,
    first_inflow_at,
    created_by,
    created_at,
    updated_at
  FROM public.customers;
COMMENT ON VIEW partner_ro.v_customers_masked IS
  'allowlist. MASK5(name/birth/address/postal/email). BLOCK: rrn_enc·passport·phone·memo·first_inflow_source_ref(free-text). omit: chart_number(quasi-id·customer_id opaque가 join 충족). 신규컬럼=default exclude.';

-- ── 2.2 v_reservations_masked ← public.reservations ──────────────────
--   BLOCK: customer_name·customer_phone·memo·referral_source(free-text·§36 freeze)
CREATE OR REPLACE VIEW partner_ro.v_reservations_masked
  WITH (security_barrier = true) AS
  SELECT
    id,
    clinic_id,
    customer_id,
    service_id,
    reservation_date,
    reservation_time,
    end_time,
    visit_type,
    visit_nature,
    status,
    inflow_channel,
    created_by,
    created_at,
    updated_at
  FROM public.reservations;
COMMENT ON VIEW partner_ro.v_reservations_masked IS
  'allowlist. FK opaque(customer_id/service_id)·enum·시각·inflow_channel(coded) PASS. BLOCK: customer_name/customer_phone(denorm)·memo·referral_source(free-text).';

-- ── 2.3 v_check_ins_masked ← public.check_ins ────────────────────────
--   BLOCK: customer_name·customer_phone·notes·treatment_memo·treatment_photos
CREATE OR REPLACE VIEW partner_ro.v_check_ins_masked
  WITH (security_barrier = true) AS
  SELECT
    id,
    clinic_id,
    customer_id,
    reservation_id,
    package_id,
    queue_number,
    status,
    visit_type,
    visit_nature,
    inflow_channel,
    priority_flag,
    call_list_manual_order,
    consultant_id,
    therapist_id,
    technician_id,
    consultation_room,
    treatment_room,
    laser_room,
    checked_in_at,
    called_at,
    completed_at,
    created_at
  FROM public.check_ins;
COMMENT ON VIEW partner_ro.v_check_ins_masked IS
  'allowlist. 물리동선(queue/room/status)·스태프FK·시각 PASS. BLOCK: customer_name/phone(denorm)·notes·treatment_memo(임상 자유텍스트)·treatment_photos(임상사진 URL).';

-- ── 2.4 v_status_transitions ← public.status_transitions ─────────────
--   전 컬럼 PASS(PII 부재)·물리동선 QC 직결. allowlist 명시(신규컬럼 fail-closed).
CREATE OR REPLACE VIEW partner_ro.v_status_transitions
  WITH (security_barrier = true) AS
  SELECT
    id,
    check_in_id,
    clinic_id,
    from_status,
    to_status,
    room_id,
    changed_by,
    transitioned_at
  FROM public.status_transitions;
COMMENT ON VIEW partner_ro.v_status_transitions IS
  'allowlist. 물리동선 상태전이(PII 부재). 신규컬럼=default exclude-until-classified.';

-- ── 2.5 v_payments_masked ← payments ∪ package_payments (★foot 패키지 1급) ─
--   금액/method/시각 = 성명 마스킹 전제 하 PASS. BLOCK: memo. omit: card_no_masked(PCI-인접·미분류).
--   customer_id = opaque FK만. source 판별자로 두 결제 grain 통합.
CREATE OR REPLACE VIEW partner_ro.v_payments_masked
  WITH (security_barrier = true) AS
  SELECT
    'payment'::text          AS source,
    id,
    check_in_id,
    NULL::uuid               AS package_id,
    customer_id,
    clinic_id,
    amount,
    method,
    installment,
    payment_type,
    NULL::integer            AS vat_amount,
    is_simulation,
    created_at
  FROM public.payments
  UNION ALL
  SELECT
    'package_payment'::text  AS source,
    id,
    NULL::uuid               AS check_in_id,
    package_id,
    customer_id,
    clinic_id,
    amount,
    method,
    installment,
    payment_type,
    vat_amount,
    is_simulation,
    created_at
  FROM public.package_payments;
COMMENT ON VIEW partner_ro.v_payments_masked IS
  'allowlist·UNION(payments+package_payments). 금액/method/installment/type/시각 PASS. BLOCK: memo. omit: card_no_masked. customer_id opaque FK만.';

-- ── 2.6 v_service_charges_masked ← public.service_charges ────────────
--   자유텍스트 없음(service_id FK만)·BLOCK 컬럼 0. treatment_name 자유텍스트는 services/check_in_services 소재(미노출).
CREATE OR REPLACE VIEW partner_ro.v_service_charges_masked
  WITH (security_barrier = true) AS
  SELECT
    id,
    clinic_id,
    check_in_id,
    customer_id,
    service_id,
    is_insurance_covered,
    hira_score,
    hira_unit_value,
    base_amount,
    insurance_covered_amount,
    copayment_amount,
    exempt_amount,
    customer_grade_at_charge,
    copayment_rate_at_charge,
    calculated_at,
    calculation_engine_version
  FROM public.service_charges;
COMMENT ON VIEW partner_ro.v_service_charges_masked IS
  'allowlist. 명세 구조축(hira/금액/급여) PASS·자유텍스트 0. treatment_name은 service_id FK로 대체(원문 미노출).';

-- ── 2.7 v_package_sessions ← public.package_sessions (Item2 GO·6→7) ──
--   회차소진 추적. customer 식별컬럼 부재(package_id FK opaque만). BLOCK: surcharge_memo·memo.
CREATE OR REPLACE VIEW partner_ro.v_package_sessions
  WITH (security_barrier = true) AS
  SELECT
    id,
    package_id,
    check_in_id,
    session_number,
    session_type,
    session_date,
    unit_price,
    surcharge,
    status,
    performed_by,
    deleted_at,
    deleted_by,
    created_at
  FROM public.package_sessions;
COMMENT ON VIEW partner_ro.v_package_sessions IS
  'allowlist(Item2 GO). 회차/session_type/금액/시각/FK PASS. BLOCK: surcharge_memo·memo(free-text). customer 식별컬럼 부재(package_id opaque FK만).';

-- ── 2.8 v_redpay_masked ← public.redpay_raw_transactions (Item3 GO) ──
--   ★raw_payload = 물리제외(BLOCK·마스킹 아님·PCI/PHI fragment 잠재). root_trxid=미분류→제외.
--   customer 식별컬럼 0(matched_payment_id=payment FK opaque). merchant-financial only(비-PHI).
CREATE OR REPLACE VIEW partner_ro.v_redpay_masked
  WITH (security_barrier = true) AS
  SELECT
    id,
    clinic_id,
    external_trxid,
    external_status,
    amount,
    approval_no,
    tid,
    approved_at,
    cancelled_at,
    match_rule,
    matched_payment_id,
    created_at,
    updated_at
  FROM public.redpay_raw_transactions;
COMMENT ON VIEW partner_ro.v_redpay_masked IS
  'allowlist(Item3 GO). merchant-financial(external_trxid/status/amount/approval/tid/시각/match) PASS. BLOCK: raw_payload(물리제외·PCI). omit: root_trxid(미분류). customer 식별컬럼 0.';

-- ════════════════════════════════════════════════════════════════════
