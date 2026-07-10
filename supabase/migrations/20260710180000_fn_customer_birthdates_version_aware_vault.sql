-- ============================================================================
-- T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK — 잔여 갭 1건 클로징
-- fn_customer_birthdates: rrn 파생(2순위) 분기를 version-aware Vault dual-key 로 전환
-- ============================================================================
-- 배경 / RC (supervisor prod 실측, read-only, 2026-07-10 · MSG-20260710-164601-ato2):
--   · rrn_decrypt / rrn_encrypt = 이미 Vault dual-key 라이브(20260710170000 rrn_decrypt 분기 적용됨).
--     v2 우선(vault 'foot_rrn_key_v2') → 실패 시 구키 'obliv_foot_rrn_key_2026' fallback.
--   · 복호 매트릭스: v1 23/23(구키) · v2 47/47(신키) → dual-key 로 전 70행 복호 OK.
--   · 유일 잔여 갭: fn_customer_birthdates 의 rrn 파생 분기가 여전히 `app.rrn_key` GUC→구키 폴백
--     단일 경로(pgp crypto 사용 함수 전수 스캔 결과 이것만 GUC-only).
--     → v2 47명(균검사·피검사) birth 파생 실패 → 발급 게이트 차단 지속의 RC.
--   · 즉, 20260710170000 의 fn_customer_birthdates 분기가 prod 에 미착지(rrn_decrypt 만 착지 =
--     3자 divergence). 본 마이그가 정본(prod 실재) 기준으로 fn 만 forward 재수렴한다.
--
-- 승인 게이트:
--   · supervisor Option B 승인(티켓 2026-07-06 결정) + 대표 LAUNCH-P0(2026-07-10 16:36, MSG-6mim).
--   · supervisor FIX-REQUEST(MSG-20260710-164601-ato2): fn_customer_birthdates 를 rrn_decrypt 와
--     동일 Vault dual-key 패턴으로 전환 요청. 승인 범위 = "기존 함수 본문 內 키 소스만 교체".
--
-- 키 소유권 준수(§5·RRN Runbook·AC3):
--   · 본 마이그는 신키를 생성/소유하지 않는다. Vault 기존 secret 'foot_rrn_key_v2'(06-25 provisioned)를
--     READ 하여 v2 복호에만 사용(별도 키값 불요 — rrn_decrypt 선례 동일, vault.decrypted_secrets 직접 read).
--   · 구키(v1)는 기존 GUC→fallback 경로 그대로 유지(v1 무회귀).
--
-- 무회귀 하드 가드 (AC3):
--   · 시그니처 무변경: fn_customer_birthdates(uuid, uuid[]) → TABLE(customer_id uuid, birth_date_display text).
--   · birth_date 우선 휴리스틱(1순위) 무변경. RRN fallback(2순위)의 '키 소스'만 version-aware 로 교체.
--   · 반환값 birth_date_display(YYYY-MM-DD)만 유지 — rrn 평문/뒷자리/성별코드 미노출(PHI 가드 유지).
--   · rrn_decrypt 는 손대지 않음(이미 dual-key 라이브·audit·A2 게이트 유지). 신규 복호 surface 0.
--   · GRANT 무변경(authenticated 만). RLS 정책 변경 0.
--   · v2 Vault 키 결측/조회실패 시 fail-safe: v_key_v2 NULL → 해당 v2 행 파생 NULL(구키 오복호 금지).
--
-- 멱등: CREATE OR REPLACE(시그니처 무변경) → 재실행 안전. 롤백: 동명 .rollback.sql(20260613120000 원복).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_customer_birthdates(
  p_clinic_id uuid,
  p_ids       uuid[]
) RETURNS TABLE (customer_id uuid, birth_date_display text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_key_v1 text;
  v_key_v2 text;
  v_key    text;
  r        record;
  v_rrn    text;
  v_d      text;
  v_yy int; v_mm int; v_dd int; v_g int;
  v_year int;
  v_bd   text;
BEGIN
  -- 구키(v1): GUC → fallback (기존 동작 유지 = v1 무회귀)
  BEGIN
    v_key_v1 := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key_v1 := NULL;
  END;
  IF v_key_v1 IS NULL OR v_key_v1 = '' THEN
    v_key_v1 := 'obliv_foot_rrn_key_2026';
  END IF;

  -- 신키(v2): Vault (루프 밖 1회 조회 — STABLE, per-call 1회. rrn_decrypt 선례 동일)
  BEGIN
    SELECT decrypted_secret INTO v_key_v2
      FROM vault.decrypted_secrets
     WHERE name = 'foot_rrn_key_v2'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key_v2 := NULL;
  END;

  FOR r IN
    SELECT c.id, c.birth_date, c.rrn_enc, COALESCE(c.rrn_encryption_version, 1) AS ver
      FROM public.customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.id = ANY(p_ids)
  LOOP
    v_year := NULL; v_mm := NULL; v_dd := NULL; v_bd := NULL;

    -- 1순위: birth_date 컬럼 (YYMMDD), 세기 휴리스틱 (무변경)
    v_d := regexp_replace(coalesce(r.birth_date, ''), '[^0-9]', '', 'g');
    IF length(v_d) >= 6 THEN
      v_yy := substr(v_d, 1, 2)::int;
      v_mm := substr(v_d, 3, 2)::int;
      v_dd := substr(v_d, 5, 2)::int;
      IF v_yy <= (extract(year from now())::int % 100) THEN
        v_year := 2000 + v_yy;
      ELSE
        v_year := 1900 + v_yy;
      END IF;
    ELSE
      -- 2순위: rrn 파생 (서버측 복호 — 평문 유출 없음). ★ version-aware 키 선택 ★
      v_key := CASE WHEN r.ver = 2 THEN v_key_v2 ELSE v_key_v1 END;
      v_rrn := NULL;
      IF r.rrn_enc IS NOT NULL AND v_key IS NOT NULL AND v_key <> '' THEN
        BEGIN
          v_rrn := extensions.pgp_sym_decrypt(r.rrn_enc, v_key);
        EXCEPTION WHEN OTHERS THEN
          v_rrn := NULL;
        END;
      END IF;
      v_d := regexp_replace(coalesce(v_rrn, ''), '[^0-9]', '', 'g');
      IF length(v_d) = 13 THEN
        v_yy := substr(v_d, 1, 2)::int;
        v_mm := substr(v_d, 3, 2)::int;
        v_dd := substr(v_d, 5, 2)::int;
        v_g  := substr(v_d, 7, 1)::int;
        v_year := CASE
          WHEN v_g IN (1, 2, 5, 6) THEN 1900 + v_yy
          WHEN v_g IN (3, 4, 7, 8) THEN 2000 + v_yy
          WHEN v_g IN (9, 0)       THEN 1800 + v_yy
          ELSE NULL
        END;
      END IF;
    END IF;

    IF v_year IS NOT NULL AND v_mm BETWEEN 1 AND 12 AND v_dd BETWEEN 1 AND 31 THEN
      BEGIN
        v_bd := to_char(make_date(v_year, v_mm, v_dd), 'YYYY-MM-DD');
      EXCEPTION WHEN OTHERS THEN
        v_bd := NULL;  -- 2/30 등 불가능한 날짜 방어
      END;
    END IF;

    customer_id := r.id;
    birth_date_display := v_bd;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 그랜트 무변경 재확인 (신규 surface 0)
REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) IS
  'T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK: 고객 생년월일(YYYY-MM-DD) 서버측 파생. birth_date 우선, 없으면 rrn 세기코드 파생(version-aware: v2→Vault foot_rrn_key_v2 / v1→GUC app.rrn_key→구키 fallback). PHI: birth_date만 반환, rrn 평문/뒷자리 미노출.';

-- ── 검증 (적용 시점 self-test) ──
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='fn_customer_birthdates' LIMIT 1)) INTO v_def;
  IF v_def !~ 'foot_rrn_key_v2' THEN
    RAISE EXCEPTION 'fn_customer_birthdates: v2 Vault 키 경로 누락';
  END IF;
  IF v_def !~ 'decrypted_secrets' THEN
    RAISE EXCEPTION 'fn_customer_birthdates: Vault decrypted_secrets read 경로 누락';
  END IF;
  IF v_def !~ 'rrn_encryption_version' THEN
    RAISE EXCEPTION 'fn_customer_birthdates: version-aware 분기(rrn_encryption_version) 누락';
  END IF;
  IF v_def !~ 'app.rrn_key' THEN
    RAISE EXCEPTION 'fn_customer_birthdates: v1 GUC fallback 경로 회귀(누락)';
  END IF;
  IF v_def ~ 'RETURNS text' THEN
    RAISE EXCEPTION 'fn_customer_birthdates: 시그니처 회귀(단일 text 반환 — TABLE 유지 위반)';
  END IF;
  RAISE NOTICE 'T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK: fn_customer_birthdates version-aware self-test 통과';
END
$verify$;

COMMIT;
