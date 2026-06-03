/**
 * T-20260530-supv-RRN-STAGE0-PRECHECK — 풋 RRN Stage 0 진단 (READ-ONLY)
 *
 * 안전성: SELECT / pg_get_functiondef 만. 어떤 데이터·스키마·키도 변경하지 않음.
 *         키 rotation·함수 변경은 Stage 1+ (supervisor 승인 후) — 본 스크립트 범위 밖.
 * 평문 키 회신 금지 — 지문(첫4·끝4)만 출력.
 *
 * 실행: SUPABASE_DB_PASSWORD=… node scripts/rrn_stage0_diag_20260603.mjs
 *   (보안 작업이므로 DB 비밀번호는 하드코딩하지 않고 env 로 주입한다.)
 */
import pg from 'pg';

const PW = process.env.SUPABASE_DB_PASSWORD;
if (!PW) {
  console.error('❌ SUPABASE_DB_PASSWORD env 미설정 — .env 값 주입 후 실행');
  process.exit(1);
}

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: PW,
  ssl: { rejectUnauthorized: false },
});

function fp(v) {
  if (v == null) return '(null)';
  const s = String(v);
  if (s.length <= 8) return `len=${s.length} <redacted>`;
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

const out = (label, val) => console.log(`\n### ${label}\n` + JSON.stringify(val, null, 2));

try {
  await client.connect();
  console.log('🔌 connected: rxlomoozakkjesdqjtvd (foot — single shared DB)');

  // ── 0.2 row count ─────────────────────────────────────────────
  // 실제 스키마 컬럼 확인 먼저
  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers'
      AND (column_name ILIKE '%rrn%' OR column_name ILIKE '%vault%' OR column_name ILIKE '%ssn%')
    ORDER BY column_name;
  `);
  out('0.2a customers rrn-related columns', cols.rows);

  const rc = await client.query(`
    SELECT COUNT(*) AS total_customers,
      COUNT(*) FILTER (WHERE rrn_enc IS NOT NULL) AS with_rrn_enc,
      COUNT(*) FILTER (WHERE rrn_vault_id IS NOT NULL) AS with_vault_id
    FROM public.customers;
  `).catch(e => ({ error: e.message }));
  out('0.2b row count', rc.rows ?? rc);

  // ── 0.4 키 동일성 + 함수 본체 ─────────────────────────────────
  const guc = await client.query(`
    SELECT current_setting('app.rrn_key', true) AS k;
  `);
  const gucVal = guc.rows[0]?.k;
  out('0.4a GUC app.rrn_key', {
    guc_set: gucVal != null && gucVal !== '',
    fingerprint: fp(gucVal),
  });

  // DB-level setting 저장 위치 확인 (ALTER DATABASE / ALTER ROLE)
  const dbset = await client.query(`
    SELECT d.datname AS scope, s.setconfig
    FROM pg_db_role_setting s
    LEFT JOIN pg_database d ON d.oid = s.setdatabase
    WHERE EXISTS (
      SELECT 1 FROM unnest(s.setconfig) c WHERE c ILIKE 'app.rrn_key=%'
    );
  `).catch(e => ({ error: e.message }));
  out('0.4b app.rrn_key persisted scope (ALTER DATABASE/ROLE)', (dbset.rows ?? []).map(r => ({
    scope: r.scope ?? '(role-level)',
    config: (r.setconfig || []).filter(c => /^app\.rrn_key=/.test(c)).map(c => 'app.rrn_key=' + fp(c.split('=').slice(1).join('='))),
  })));

  for (const fn of ['public.rrn_decrypt(uuid)', 'public.rrn_encrypt(uuid, text)']) {
    try {
      const def = await client.query(`SELECT pg_get_functiondef($1::regprocedure) AS def;`, [fn]);
      const body = def.rows[0].def;
      const hasHardcoded = body.includes('obliv_foot_rrn_key_2026');
      const hasRaise = /RAISE EXCEPTION/.test(body);
      out(`0.4c function ${fn}`, {
        hardcoded_fallback_obliv_foot_rrn_key_2026: hasHardcoded,
        raises_when_unset: hasRaise,
        uses_guc_app_rrn_key: body.includes("app.rrn_key"),
        body_chars: body.length,
      });
    } catch (e) {
      out(`0.4c function ${fn}`, { error: e.message });
    }
  }

  // ── 0.5 Vault / pgsodium 활성 ─────────────────────────────────
  const ext = await client.query(`
    SELECT extname, extversion FROM pg_extension
    WHERE extname IN ('supabase_vault','pgsodium','pgcrypto');
  `);
  out('0.5a extensions', ext.rows);

  const vault = await client.query(`SELECT count(*)::int AS n FROM vault.secrets;`)
    .catch(e => ({ error: e.message }));
  out('0.5b vault.secrets count', vault.rows ?? vault);

  // ── 0.8 연계: nhis-lookup 흐름은 코드 레벨 점검 (별도) ─────────
  console.log('\n🏁 진단 완료 (read-only). 변경 0건.');
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
