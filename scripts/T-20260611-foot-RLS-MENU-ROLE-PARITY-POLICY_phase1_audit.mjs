/**
 * T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY — Phase 1 전수감사 (READ-ONLY, 직접 pg)
 *
 * 목적 (정책 우산 티켓, audit-first):
 *   "권한 풀린(관리자·직원 모두 메뉴 진입) 메뉴는 그 안의 데이터 조회도 manager=staff 동일 보장."
 *   → Phase 1 은 변경 0. 현 prod 의 모든 public 테이블에 대해 SELECT RLS 정책을
 *     분류(parity / mgmt-only / role-tier / outlier / no-RLS / no-policy)하여
 *     "staff SELECT 누락(parity gap)" 후보를 기계적으로 산출한다.
 *   메뉴 매핑·공유여부·민감제외 판정은 FE PERM_MATRIX + App.tsx RoleGuard + 수기 검토와
 *     합쳐 매트릭스로 deliver. 본 스크립트는 그 DB측 절반(정책 분류)을 담당.
 *
 * ★ SELECT only. prod write 절대 금지. RLS 변경 없음 (Phase 1 게이트 전). ★
 *
 * 분류 규칙 (USING 식 텍스트 휴리스틱):
 *   PARITY     : is_approved_user() 만 (role 티어 없음) → manager=staff 동일 (이상적)
 *   MGMT_ONLY  : is_admin_or_manager() / current_user_role() IN (admin,manager,director) 만
 *   TIER       : is_consultant_or_above / is_coordinator_or_above / is_therapist_or_technician
 *   OUTLIER    : staff.user_id = auth.uid() (비정규 신원 소스 — health_q 버그 패턴)
 *   OPEN       : true / authenticated 전체 허용
 *   OTHER      : 위 어디에도 안 맞음 (수기 검토 필요)
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

function classify(qual) {
  if (qual == null) return 'OPEN'; // SELECT 정책 USING NULL = no restriction
  const q = qual.toLowerCase().replace(/\s+/g, ' ');
  const hasOutlier = /staff[^)]*user_id\s*=\s*auth\.uid\(\)/.test(q) || /user_id = auth.uid()/.test(q) && /staff/.test(q);
  const hasApproved = /is_approved_user\(\)/.test(q);
  const hasMgmt = /is_admin_or_manager\(\)/.test(q);
  const hasConsult = /is_consultant_or_above\(\)/.test(q);
  const hasCoord = /is_coordinator_or_above\(\)/.test(q);
  const hasTherTech = /is_therapist_or_technician\(\)/.test(q);
  const roleInMgmt = /current_user_role\(\)\s*in\s*\([^)]*'admin'[^)]*\)/.test(q) && !/'consultant'|'coordinator'|'therapist'|'technician'|'part_lead'|'staff'/.test(q);
  const isTrue = q === 'true' || q === '(true)';

  if (hasOutlier) return 'OUTLIER';
  if (hasMgmt || roleInMgmt) {
    // mgmt 헬퍼가 있고, 다른 비-mgmt 티어 헬퍼/role 이 OR 로 같이 있으면 사실상 공유
    if (hasConsult || hasCoord || hasTherTech || /'consultant'|'coordinator'|'therapist'|'technician'|'part_lead'|'staff'/.test(q)) return 'TIER';
    return 'MGMT_ONLY';
  }
  if (hasConsult || hasCoord || hasTherTech) return 'TIER';
  if (hasApproved) return 'PARITY';
  if (isTrue) return 'OPEN';
  return 'OTHER';
}

(async () => {
  await client.connect();
  console.log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

  // 1) public 스키마 모든 base table + RLS enabled 여부
  const tbls = await client.query(`
    SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
     ORDER BY c.relname`);

  // 2) SELECT 정책 전체
  const pols = await client.query(`
    SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
      FROM pg_policies WHERE schemaname='public'
     ORDER BY tablename, cmd, policyname`);

  // 3) 뷰 목록 (참고)
  const views = await client.query(`
    SELECT table_name FROM information_schema.views WHERE table_schema='public' ORDER BY table_name`);

  // 정책을 테이블별로 그룹
  const byTable = {};
  for (const p of pols.rows) {
    (byTable[p.tablename] ??= []).push(p);
  }

  const rows = [];
  for (const t of tbls.rows) {
    const ps = byTable[t.tablename] || [];
    const selPols = ps.filter((p) => p.cmd === 'SELECT' || p.cmd === 'ALL');
    let cls, detail;
    if (!t.rls_enabled) {
      cls = 'RLS_OFF'; detail = '(RLS 미적용)';
    } else if (selPols.length === 0) {
      cls = 'NO_SELECT_POLICY'; detail = '(SELECT 정책 없음 → 기본 deny)';
    } else {
      // 여러 SELECT 정책이면 가장 "느슨한" 쪽으로 분류 (permissive OR 결합)
      const classes = selPols.map((p) => classify(p.cmd === 'ALL' ? (p.qual ?? p.with_check) : p.qual));
      // 우선순위: OPEN > PARITY > TIER > MGMT_ONLY > OUTLIER > OTHER
      const order = ['OPEN', 'PARITY', 'TIER', 'MGMT_ONLY', 'OUTLIER', 'OTHER'];
      cls = order.find((o) => classes.includes(o)) || classes[0];
      detail = selPols.map((p) => `${p.policyname}[${p.cmd}]:${classify(p.qual ?? p.with_check)}`).join(' | ');
    }
    rows.push({ table: t.tablename, rls: t.rls_enabled, sel_class: cls, detail });
  }

  // ── 출력: 분류별 요약 ──
  console.log('══════════ 분류별 테이블 수 ══════════');
  const summary = {};
  for (const r of rows) summary[r.sel_class] = (summary[r.sel_class] || 0) + 1;
  for (const [k, v] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)}: ${v}`);
  }
  console.log(`  ── 총 base table: ${rows.length} / 뷰: ${views.rowCount}`);

  // ── 출력: parity gap 후보 (MGMT_ONLY / OUTLIER / NO_SELECT_POLICY) ──
  console.log('\n══════════ ★ parity 점검 우선 후보 (MGMT_ONLY / OUTLIER) ══════════');
  for (const r of rows.filter((r) => ['MGMT_ONLY', 'OUTLIER'].includes(r.sel_class)).sort((a,b)=>a.table.localeCompare(b.table))) {
    console.log(`  [${r.sel_class}] ${r.table}\n      ${r.detail}`);
  }

  console.log('\n══════════ NO_SELECT_POLICY (RLS on, SELECT 정책 부재 → staff·mgmt 모두 deny) ══════════');
  for (const r of rows.filter((r) => r.sel_class === 'NO_SELECT_POLICY').sort((a,b)=>a.table.localeCompare(b.table))) {
    console.log(`  ${r.table}`);
  }

  console.log('\n══════════ RLS_OFF (RLS 미적용 테이블) ══════════');
  for (const r of rows.filter((r) => r.sel_class === 'RLS_OFF').sort((a,b)=>a.table.localeCompare(b.table))) {
    console.log(`  ${r.table}`);
  }

  console.log('\n══════════ OTHER (수기 검토 필요) ══════════');
  for (const r of rows.filter((r) => r.sel_class === 'OTHER').sort((a,b)=>a.table.localeCompare(b.table))) {
    console.log(`  ${r.table}\n      ${r.detail}`);
  }

  // ── 전체 테이블 분류 (csv 형태) ──
  console.log('\n══════════ 전체 테이블 SELECT 분류 (table|rls|class|detail) ══════════');
  for (const r of rows.sort((a,b)=>a.table.localeCompare(b.table))) {
    console.log(`${r.table}\t${r.rls}\t${r.sel_class}\t${r.detail}`);
  }

  // ── 뷰 목록 ──
  console.log('\n══════════ 뷰 (security_invoker 여부는 별도 확인) ══════════');
  for (const v of views.rows) console.log(`  ${v.table_name}`);

  await client.end();
  console.log('\n✅ Phase 1 감사 종료 (write 없음, RLS 변경 없음)');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
