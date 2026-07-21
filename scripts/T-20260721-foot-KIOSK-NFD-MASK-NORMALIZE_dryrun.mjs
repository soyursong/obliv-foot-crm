// DRY-RUN evidence: T-20260721-foot-KIOSK-NFD-MASK-NORMALIZE
// 무영속(read-only). Management API /database/query 경유. prod 함수정의 변경 0.
//  A) 마스킹 산식 NFD깨짐→NFC교정 대조 (강승은)
//  B) 현 prod 함수정의 baseline (normalize wrap 부재 = 적용 전 상태 확인)
//  C) 시그니처/권한/SECDEF 불변 대상 스냅샷
import { query } from './lib/foot_migration_ledger.mjs';

// ── A) 마스킹 산식 회귀: NFD raw 는 깨지고, normalize(NFC) 래핑 입력은 완성형(강*은) ──
const maskCase = (expr) => `CASE
    WHEN ${expr} IS NULL OR btrim(${expr}) = ''  THEN ${expr}
    WHEN char_length(btrim(${expr})) = 1         THEN btrim(${expr})
    WHEN char_length(btrim(${expr})) = 2         THEN left(btrim(${expr}), 1) || '*'
    ELSE left(btrim(${expr}), 1) || repeat('*', char_length(btrim(${expr})) - 2) || right(btrim(${expr}), 1)
  END`;

const partA = await query(`
  WITH samples(label, nm_raw) AS (
    VALUES
      ('NFC-정상 강승은', normalize('강승은', NFC)),
      ('NFD-깨짐 강승은', normalize('강승은', NFD)),
      ('NFC 홍길동',      normalize('홍길동', NFC)),
      ('NFC 이영',        normalize('이영',   NFC)),
      ('NFC 박',          normalize('박',     NFC)),
      ('NULL',            NULL)
  )
  SELECT label,
         char_length(nm_raw)                 AS raw_len,
         char_length(normalize(nm_raw, NFC))  AS nfc_len,
         ${maskCase('nm_raw')}                AS masked_before,
         ${maskCase('normalize(nm_raw, NFC)')} AS masked_after
  FROM samples;`);
console.log('=== PART A — 마스킹 산식 NFD→NFC 회귀 ===');
console.log(JSON.stringify(partA, null, 2));

// ── B) 현 prod 함수 baseline: normalize wrap 아직 없음(적용 전) 확인 ──
const partB = await query(`
  SELECT p.proname,
         p.prosecdef,
         p.proconfig,
         pg_get_userbyid(p.proowner)                       AS owner,
         pg_get_function_identity_arguments(p.oid)          AS args,
         (pg_get_functiondef(p.oid) ILIKE '%normalize%NFC%') AS has_nfc_wrap
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_selfcheckin_today_reservations';`);
console.log('=== PART B — 현 prod 함수 baseline (기대 has_nfc_wrap=false) ===');
console.log(JSON.stringify(partB, null, 2));

// ── C) anon/authenticated EXECUTE 유지 대상 확인 ──
const partC = await query(`
  SELECT has_function_privilege('anon','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE') AS anon_exec,
         has_function_privilege('authenticated','public.fn_selfcheckin_today_reservations(uuid,date)','EXECUTE') AS auth_exec;`);
console.log('=== PART C — EXECUTE 권한 (불변 대상) ===');
console.log(JSON.stringify(partC));
