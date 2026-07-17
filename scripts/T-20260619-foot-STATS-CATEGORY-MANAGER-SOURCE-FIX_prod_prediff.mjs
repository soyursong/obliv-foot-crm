/**
 * T-20260619-foot-STATS-CATEGORY-MANAGER-SOURCE-FIX — 적용 직전 prod prosrc 재diff (READ-ONLY)
 *
 * supervisor GATE-CLEAR 조건 #1: 07-06 Migration Ledger Reconciliation(20260706120000) 이후
 *   foot_stats_consultant 계열 prod 변동(divergence) 여부 확인. divergence 발견 시 적용 중단.
 *
 * 판정:
 *   - prod def 가 rollback.sql(=직전 20260430110000 LEFT JOIN 정의)와 본문 동치 → PRE_APPLY(정상 baseline)
 *   - prod def 가 up.sql(INNER JOIN 정의)와 본문 동치                         → ALREADY_APPLIED(멱등)
 *   - 그 외                                                                    → DIVERGENCE(적용 중단)
 * 절대 write 금지. SELECT only (Management API database/query).
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const FN = 'foot_stats_consultant';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

// 함수 본문(prosrc)만 비교 — 시그니처/GRANT/COMMENT 노이즈 제거, 공백 정규화
const norm = s => (s || '').replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim().toLowerCase();
// 핵심 동작 지문: staff LEFT/INNER JOIN ticketed
const joinKind = src => {
  const n = norm(src);
  if (/from staff s .*? left join ticketed t on t\.consultant_id = s\.id/.test(n)) return 'LEFT';
  if (/from staff s .*? join ticketed t on t\.consultant_id = s\.id/.test(n) && !/left join ticketed t/.test(n)) return 'INNER';
  return 'UNKNOWN';
};

try {
  console.log(`✅ Management API 연결(${REF}) — READ-ONLY pre-diff\n`);

  // 1) prod 함수 실재 + prosrc
  const rows = await q(`SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc, obj_description(p.oid) AS comment
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='${FN}'`);
  if (!rows.length) { console.error('❌ prod 에 함수 부재 — DIVERGENCE(예상 밖). 적용 중단.'); process.exit(2); }
  if (rows.length > 1) { console.error(`❌ 동명 오버로드 ${rows.length}개 — DIVERGENCE. 적용 중단.`); rows.forEach(r=>console.error('  args:',r.args)); process.exit(2); }
  const prod = rows[0];
  console.log('prod args   :', prod.args);
  console.log('prod comment:', prod.comment);
  const prodJoin = joinKind(prod.prosrc);
  console.log('prod JOIN   :', prodJoin);

  // 2) up.sql / rollback.sql 본문 prosrc 추출 (AS $$ ... $$ 사이)
  const bodyOf = f => {
    const raw = fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
    const m = raw.match(/AS \$\$([\s\S]*?)\$\$;/);
    return m ? m[1] : '';
  };
  const upBody = bodyOf('20260619020000_foot_stats_consultant_session_presence.sql');
  const rbBody = bodyOf('20260619020000_foot_stats_consultant_session_presence.rollback.sql');
  console.log('up.sql  JOIN:', joinKind(upBody), '(기대 INNER)');
  console.log('rb.sql  JOIN:', joinKind(rbBody), '(기대 LEFT)');

  // 3) prod prosrc 를 rollback 본문과 정규화 비교
  const eqRollback = norm(prod.prosrc) === norm(rbBody);
  const eqUp = norm(prod.prosrc) === norm(upBody);
  console.log('\nprod == rollback(직전 LEFT 정의) :', eqRollback);
  console.log('prod == up(INNER 신정의)         :', eqUp);

  // 4) schema_migrations 원장에 20260619020000 존재 여부
  const led = await q(`SELECT version FROM supabase_migrations.schema_migrations WHERE version LIKE '20260619%' ORDER BY version`)
    .catch(() => q(`SELECT version FROM schema_migrations WHERE version LIKE '20260619%' ORDER BY version`).catch(()=>[]));
  console.log('\nledger 20260619* :', JSON.stringify(led));

  console.log('\n================ 판정 ================');
  if (eqUp || prodJoin === 'INNER') {
    console.log('🟡 ALREADY_APPLIED — prod 이미 INNER JOIN(신정의). 적용 멱등(재적용 무해) 또는 skip.');
    process.exit(10);
  } else if (eqRollback && prodJoin === 'LEFT') {
    console.log('🟢 PRE_APPLY(정상 baseline) — prod == 직전 LEFT 정의. 07-06 이후 divergence 없음. 적용 GO.');
    process.exit(0);
  } else {
    console.log('🔴 DIVERGENCE — prod prosrc 가 직전 LEFT 정의와 불일치(예상 밖 변동). 적용 중단 + supervisor 회신.');
    console.log('--- prod prosrc (정규화) 앞 400자 ---');
    console.log(norm(prod.prosrc).slice(0, 400));
    process.exit(3);
  }
} catch (e) {
  console.error('❌ 실패:', e.message);
  process.exit(1);
}
