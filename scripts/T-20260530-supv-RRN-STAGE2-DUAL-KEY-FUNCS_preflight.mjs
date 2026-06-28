/**
 * T-20260530-supv-RRN-STAGE2-DUAL-KEY-FUNCS — PRE-FLIGHT (read-only, write 0건)
 * Step 4 적용 직전 precondition 재확인 + Step 5 검증용 대상 발굴.
 * foot CRM = 단일 Supabase(rxlomoozakkjesdqjtvd). prod=dev 1위치.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const c = conn(); await c.connect();
console.log('✅ DB 연결 (PRE-FLIGHT, read-only) [rxlomoozakkjesdqjtvd]', new Date().toISOString());

// 1) Vault 신키 접근 가능
const k = await c.query(`SELECT (decrypted_secret IS NOT NULL) AS key_accessible, length(decrypted_secret) AS len
  FROM vault.decrypted_secrets WHERE name='foot_rrn_key_v2'`);
console.log('\n[1] Vault foot_rrn_key_v2:', JSON.stringify(k.rows));

// 2) audit 컬럼 존재 (STAGE2A close 재확인 — 컬럼순서 트랩 가드)
const cols = await c.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers'
    AND column_name IN ('rrn_enc','resident_id','rrn_re_encrypted_at','rrn_encryption_version','rrn_vault_id','clinic_id')
  ORDER BY column_name`);
console.log('[2] customers 컬럼:', cols.rows.map(r=>r.column_name).join(', '));

// 3) 기존 rrn_enc 데이터 현황 (버전 분포)
const dist = await c.query(`SELECT rrn_encryption_version, COUNT(*)::int AS n FROM public.customers
  WHERE rrn_enc IS NOT NULL GROUP BY 1 ORDER BY 1`);
console.log('[3] rrn_enc 버전 분포:', JSON.stringify(dist.rows));

// 4) auth.uid() 정의 확인 (jwt 설정명 파악)
const authuid = await c.query(`SELECT pg_get_functiondef('auth.uid()'::regprocedure) AS def`);
console.log('\n[4] auth.uid() 정의:\n' + authuid.rows[0].def);

// 5) Step5 검증 대상: rrn_enc 보유 고객 3건 (id + clinic_id)
const cust = await c.query(`SELECT id, clinic_id FROM public.customers
  WHERE rrn_enc IS NOT NULL ORDER BY created_at LIMIT 3`);
console.log('\n[5] 검증대상 고객(rrn_enc 보유) 3건:', JSON.stringify(cust.rows));

// 6) 해당 clinic 의 admin/manager/director user_profile (게이트 통과용 sub)
const clinicIds = [...new Set(cust.rows.map(r=>r.clinic_id))];
if (clinicIds.length) {
  const prof = await c.query(`SELECT id, role, clinic_id FROM public.user_profiles
    WHERE clinic_id = ANY($1::uuid[]) AND role IN ('admin','manager','director')
      AND COALESCE(active,true)=true ORDER BY role LIMIT 5`, [clinicIds]);
  console.log('[6] 게이트통과용 admin/manager 프로필:', JSON.stringify(prof.rows));
}

// 7) 기존 함수 시그니처 현황 (교체 전 스냅샷)
const fn = await c.query(`SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
  FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('rrn_decrypt','rrn_encrypt','rrn_encrypt_checkin') ORDER BY proname`);
console.log('[7] 기존 함수:', JSON.stringify(fn.rows));

// 8) fallback_log 테이블 존재 여부
const tbl = await c.query(`SELECT to_regclass('public.rrn_decrypt_fallback_log') AS exists`);
console.log('[8] rrn_decrypt_fallback_log:', JSON.stringify(tbl.rows));

await c.end();
console.log('\n✅ PRE-FLIGHT 완료 (write 0건)');
