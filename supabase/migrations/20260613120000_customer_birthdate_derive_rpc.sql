-- T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN
-- 고객 생년월일 자동 표기용 서버측 파생 RPC (김주연 총괄 요청).
--
-- ⚠️ PHI 가드:
--   - rrn 복호화는 서버(SECURITY DEFINER) 안에서만 수행.
--   - 반환값은 생년월일(YYYY-MM-DD) 하나뿐. rrn 뒷자리·성별코드 절대 미반환.
--   - 클라이언트는 평문 rrn 을 절대 받지 않는다(이 함수가 birth_date 만 노출).
--
-- 파생 규칙:
--   1순위) customers.birth_date(YYMMDD 텍스트)가 있으면 사용 — 세기는 휴리스틱
--          (YY ≤ 현재연도 2자리 → 2000년대, 아니면 1900년대. 미래 출생연도 미생성).
--   2순위) birth_date 가 비면 rrn 앞6자리(YYMMDD) + 7번째 자리(세기코드)로 파생.
--          세기코드: 1,2,5,6→1900s / 3,4,7,8→2000s / 9,0→1800s.
--   파싱 불가/결측 → NULL (화면은 '-' 표기).
--
-- 신규 컬럼/테이블/enum 없음 (데이터계약 비변경). read-only.
-- rollback: 20260613120000_customer_birthdate_derive_rpc.rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_customer_birthdates(
  p_clinic_id uuid,
  p_ids       uuid[]
) RETURNS TABLE (customer_id uuid, birth_date_display text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key  text;
  r      record;
  v_rrn  text;
  v_d    text;
  v_yy   int; v_mm int; v_dd int; v_g int;
  v_year int;
  v_bd   text;
BEGIN
  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;

  FOR r IN
    SELECT c.id, c.birth_date, c.rrn_enc
      FROM public.customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.id = ANY(p_ids)
  LOOP
    v_year := NULL; v_mm := NULL; v_dd := NULL; v_bd := NULL;

    -- 1순위: birth_date 컬럼 (YYMMDD), 세기 휴리스틱
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
      -- 2순위: rrn 파생 (서버측 복호화 — 평문 유출 없음)
      v_rrn := NULL;
      IF r.rrn_enc IS NOT NULL THEN
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

-- PHI: SECURITY DEFINER 가 rrn 을 복호화하므로 미인증(anon) 호출 차단 필수.
-- Supabase 기본 default-privilege 가 신규 함수에 anon EXECUTE 를 자동 부여하므로 명시 회수.
REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) IS
  'T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN: 고객 생년월일(YYYY-MM-DD) 서버측 파생. birth_date 우선, 없으면 rrn 세기코드 파생. PHI: birth_date만 반환, rrn 평문/뒷자리 미노출.';

COMMIT;
