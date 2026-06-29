/**
 * T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE — AC1 dry-run 트리아지 (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT 만. UPDATE/DELETE/ALTER/병합 일절 없음.
 *    AC3(대표원장 확인) + supervisor 게이트 GO 전까지 customers/FK 변경 절대 금지.
 *    본 스크립트는 동명 customer master 중복 3건(실명)의 무변경 인벤토리/판정근거만 산출.
 *
 * 대상 (QA가명 135건 제외, 실명 3건):
 *   ① 김규리   keep 7fa5dff1 vs dup 7cef3be8
 *   ② 김민경   check_in 10f10231(name=김민경)이 test고객 김구번 3da2d8ef 에 오연결 → 신원 혼입(최우선)
 *   ③ 김승현   keep fcdcd44f vs dup 53661ce0
 *
 * 케이스별 산출:
 *   - 정본/중복 판정근거: 생성시각 · phone 실유효(테스트번호 여부) · 연결자산 수
 *   - 중복/오연결 측에 매달린 check_in / package / payment / chart 전수
 *   - 병합 시 keep 으로 재귀속해야 할 FK 목록(24 참조테이블 + self-ref)
 *   - phone(clinic_id,phone) / chart_number unique 등 충돌 여부
 *
 * 산출: stdout 요약 + scripts/out/T-20260607-CUSTOMER-MASTER-DUP-TRIAGE_ac1.md (+ .json)
 * 실행: node scripts/T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE_ac1.mjs
 */
import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

// 테스트/더미 phone 패턴 (E.164 정규화 후 끝자리 판정)
const TEST_PHONE_RE = /(1234567[89]|11111111|99999999|00000000|22222222|12341234)$/;
const isTestPhone = (p) => TEST_PHONE_RE.test((p || '').replace(/[^0-9]/g, ''));

// 3 케이스 정의 (resolved full UUID)
const CASES = [
  {
    key: '김규리',
    type: 'dup_pair',
    keep: '7fa5dff1-85c0-4f60-88a1-103fca36fdd5',
    err: '7cef3be8-211f-4685-8c80-5141240328cf',
    note: '정본 2368-2507(returning,F-0800,05-30) vs 중복 1234-5679 test(new,F-0994,06-02)',
  },
  {
    key: '김민경',
    type: 'mislink_checkin',
    real_customer: '83ab4fe1-0bbc-4dfc-ab3b-f01378144707', // 진짜 김민경 (4316-0981, F-0177)
    wrong_customer: '3da2d8ef-97bc-4bc7-a55f-cd9bf8bc4251', // test 김구번 (9999-9999, F-0009) — 오연결 대상
    checkin: '10f10231-8e63-4002-bbfe-e353fd9a6a0e',
    note: 'check_in name=김민경 이나 customer_id=김구번(test). 신원 혼입 — 최우선 보고. 단순 병합 금지',
  },
  {
    key: '김승현',
    type: 'dup_pair',
    keep: 'fcdcd44f-51f0-4dd0-87f9-9e6b2fd90f5b',
    err: '53661ce0-5d3a-4da6-8459-121c36860d45',
    note: '정본 2849-0209(returning,F-0360,05-22) vs 중복 1111-1111 test(returning,F-0897,06-01)',
  },
];

(async () => {
  await client.connect();

  // 1) customers.id 참조 FK 전수 (self-ref 포함)
  const { rows: fks } = await client.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'customers' AND ccu.column_name = 'id'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;
  `);

  // unified_customer_id / designated_therapist_id 는 FK 미설정일 수 있으나 customers→customers 참조 → 수동 포함
  const SOFT_REFS = [
    { table_name: 'customers', column_name: 'unified_customer_id' },
    { table_name: 'customers', column_name: 'designated_therapist_id' },
  ];
  // (FK 목록에 referrer_id/transferred_to 는 이미 포함됨)

  // 2) 자식테이블 customer_id 컬럼이 포함된 UNIQUE 제약 (병합 시 충돌 위험)
  const { rows: childUniques } = await client.query(`
    SELECT tc.table_name, tc.constraint_name,
           array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS cols
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
    GROUP BY tc.table_name, tc.constraint_name
    HAVING bool_or(kcu.column_name = 'customer_id')
    ORDER BY tc.table_name;
  `);
  // partial unique index (idx) 중 customer_id 포함도 참고
  const { rows: childUniqIdx } = await client.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%customer_id%'
    ORDER BY tablename;
  `);

  const allRefs = [...fks, ...SOFT_REFS];

  // helper: 특정 customer_id 를 참조하는 행 수 + id 목록 (대표 50개까지)
  async function refRows(table, col, cid) {
    // payments/packages/check_ins 등은 추가 식별 컬럼 같이
    const extra =
      table === 'check_ins' ? ', status, visit_type, checked_in_at, customer_name, customer_phone'
      : table === 'payments' ? ', amount, status, created_at'
      : table === 'packages' ? ', name, total_sessions, used_sessions, status, created_at'
      : table === 'package_payments' ? ', amount, created_at'
      : table === 'medical_charts' ? ', visit_date' : '';
    try {
      const q = await client.query(
        `SELECT id${extra} FROM ${table} WHERE ${col} = $1 ORDER BY 1 LIMIT 50`, [cid]);
      return q.rows;
    } catch (e) {
      return [{ _error: e.message }];
    }
  }

  // medical_charts 는 customer_id FK 가 있는지 확인 (위 FK 목록에 없으면 customer_id, visit_date 로 별도 조회)
  const hasMcFk = fks.some((f) => f.table_name === 'medical_charts');

  async function customerCore(cid) {
    const r = await client.query(
      `SELECT id,name,phone,clinic_id,visit_type,chart_number,is_simulation,created_at,updated_at,
              unified_customer_id,referrer_id,designated_therapist_id
       FROM customers WHERE id=$1`, [cid]);
    return r.rows[0] || null;
  }

  // 한 customer 의 전체 참조 인벤토리
  async function inventory(cid) {
    const core = await customerCore(cid);
    const refs = {};
    let total = 0;
    for (const f of allRefs) {
      const rows = await refRows(f.table_name, f.column_name, cid);
      if (rows.length && !rows[0]?._error) {
        refs[`${f.table_name}.${f.column_name}`] = { n: rows.length, rows };
        total += rows.length;
      } else if (rows[0]?._error) {
        refs[`${f.table_name}.${f.column_name}`] = { n: 0, error: rows[0]._error };
      }
    }
    // medical_charts (FK 없을 경우 customer_id 컬럼 직접)
    if (!hasMcFk) {
      try {
        const mc = await client.query(
          `SELECT id, visit_date FROM medical_charts WHERE customer_id=$1 ORDER BY visit_date LIMIT 50`, [cid]);
        if (mc.rows.length) { refs['medical_charts.customer_id(soft)'] = { n: mc.rows.length, rows: mc.rows }; total += mc.rows.length; }
      } catch { /* table/col 없음 */ }
    }
    return { customer_id: cid, core, total_refs: total, refs };
  }

  const result = { generated_at: new Date().toISOString(), READ_ONLY: true, cases: [] };

  for (const cs of CASES) {
    if (cs.type === 'dup_pair') {
      const keepInv = await inventory(cs.keep);
      const errInv = await inventory(cs.err);
      // 판정근거
      const verdict = judgeDupPair(keepInv, errInv);
      // 충돌검사 (병합 가정: err 의 FK 를 keep 으로 재귀속 후 err 행 삭제)
      const conflicts = await mergeConflicts(keepInv, errInv, childUniques, childUniqIdx);
      result.cases.push({ key: cs.key, type: cs.type, note: cs.note, verdict, keep: keepInv, err: errInv, conflicts });
    } else {
      // mislink: check_in 자체 + wrong_customer 인벤토리 + real_customer 식별
      const ci = await client.query(
        `SELECT * FROM check_ins WHERE id=$1`, [cs.checkin]);
      const wrongInv = await inventory(cs.wrong_customer); // test 김구번 (오연결 대상의 현 보유 자산)
      const realCore = await customerCore(cs.real_customer);
      result.cases.push({
        key: cs.key, type: cs.type, note: cs.note,
        checkin: ci.rows[0] || null,
        wrong_customer: wrongInv,
        real_customer: realCore,
        verdict: {
          summary: 'check_in name=김민경 ↔ customer=김구번(test) 신원 불일치. 자동 병합 금지.',
          options: [
            'A) check_in.customer_id 를 진짜 김민경(83ab4fe1)로 재연결 — 단 check_in.customer_phone=+821099999999(test 9999)가 진짜 김민경 phone(+821043160981)과 불일치 → 동일인 확증 필요',
            'B) 김구번(test 3da2d8ef) 자체가 QA/테스트 고객이면 본 check_in 은 테스트 잔재 → 폐기 후보',
            'C) 김민경 신규 고객 의도였다면 신규 customers row 생성 후 연결',
          ],
          requires: '대표원장(문지은) 신원 확인 필수 — 어느 옵션도 자동 진행 불가',
        },
      });
    }
  }

  await client.end();

  // ── 판정 로직 ──
  function judgeDupPair(keepInv, errInv) {
    const k = keepInv.core, e = errInv.core;
    const kTest = isTestPhone(k.phone), eTest = isTestPhone(e.phone);
    // 점수: 실유효 phone(+4) · 연결자산 많음(+자산수) · 먼저 생성(선점 가점)
    const kScore = (kTest ? 0 : 4) + keepInv.total_refs + (new Date(k.created_at) < new Date(e.created_at) ? 1 : 0);
    const eScore = (eTest ? 0 : 4) + errInv.total_refs + (new Date(e.created_at) < new Date(k.created_at) ? 1 : 0);
    const proposedKeep = kScore >= eScore ? k.id : e.id;
    return {
      proposed_keep: proposedKeep,
      proposed_keep_matches_ticket: proposedKeep === k.id,
      basis: {
        keep: { id: k.id, phone: k.phone, phone_is_test: kTest, created_at: k.created_at, total_refs: keepInv.total_refs, chart: k.chart_number, visit_type: k.visit_type, score: kScore },
        err:  { id: e.id, phone: e.phone, phone_is_test: eTest, created_at: e.created_at, total_refs: errInv.total_refs, chart: e.chart_number, visit_type: e.visit_type, score: eScore },
      },
      note: kTest === eTest ? '양측 phone 유효성 동일 — 추가 확인 필요' : `${eTest ? '중복측' : '정본측'} phone 이 test 번호 → 판정 명확`,
    };
  }

  // 병합 충돌 분석 (무변경 — 가정만)
  async function mergeConflicts(keepInv, errInv) {
    const out = [];
    const k = keepInv.core, e = errInv.core;
    // customers (clinic_id, phone) unique: err 행을 DELETE 하므로 keep 유지 → 충돌 없음. 단 phone 동일 여부 참고
    out.push({
      constraint: 'idx_customers_clinic_phone (clinic_id,phone) UNIQUE',
      same_clinic: k.clinic_id === e.clinic_id,
      keep_phone: k.phone, err_phone: e.phone, phones_equal: k.phone === e.phone,
      risk: '병합=err행 DELETE 가정 → 신규 (clinic,phone) 충돌 없음. (keep phone 변경 시에만 위험)',
    });
    out.push({
      constraint: 'customers_chart_number_unique (chart_number)',
      keep_chart: k.chart_number, err_chart: e.chart_number,
      risk: 'err 행 DELETE → keep chart 유지. err chart 번호는 사용중지(공번). 재사용 불필요',
    });
    // 자식 unique(customer_id 포함) 충돌: 동일 보조키가 keep/err 양쪽에 있으면 재귀속 시 위반
    return out;
  }

  // ── 출력 ──
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'T-20260607-CUSTOMER-MASTER-DUP-TRIAGE_ac1.json'), JSON.stringify({ ...result, meta: { fks: allRefs, childUniques, childUniqIdx } }, null, 2));

  // markdown
  let md = `# AC1 dry-run 트리아지 — T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE\n\n`;
  md += `생성: ${result.generated_at} · **READ-ONLY (무변경)** · clinic=74967aea(종로 풋)\n`;
  md += `> ⚠️ AC3(대표원장 확인)+supervisor 게이트 GO 전까지 customers/FK UPDATE·DELETE·병합 절대 금지. 본 문서는 판정근거/인벤토리 only.\n\n`;
  md += `## 참조 FK 맵 (customers.id 를 참조하는 ${allRefs.length} 컬럼)\n`;
  md += allRefs.map((f) => `\`${f.table_name}.${f.column_name}\``).join(', ') + '\n\n';
  md += `### 자식 UNIQUE(customer_id 포함) — 병합 시 충돌 후보\n`;
  md += (childUniques.length ? childUniques.map((u) => `- \`${u.table_name}\`.${u.constraint_name} (${u.cols.join(',')})`).join('\n') : '_없음_') + '\n';
  md += (childUniqIdx.length ? '\n부분 UNIQUE 인덱스:\n' + childUniqIdx.map((i) => `- \`${i.tablename}\`.${i.indexname}`).join('\n') + '\n' : '') + '\n';

  for (const cs of result.cases) {
    md += `\n---\n\n## 케이스: ${cs.key} (${cs.type})\n`;
    md += `> ${cs.note}\n\n`;
    if (cs.type === 'dup_pair') {
      const v = cs.verdict;
      md += `### 판정\n`;
      md += `- **제안 정본(keep): \`${v.proposed_keep}\`** ${v.proposed_keep_matches_ticket ? '(티켓 지정과 일치 ✅)' : '(⚠️ 티켓 지정과 불일치 — planner 확인)'}\n`;
      md += `- 근거: ${v.note}\n\n`;
      md += `| 항목 | KEEP(정본) | ERR(중복) |\n|---|---|---|\n`;
      const b = v.basis;
      md += `| id | \`${b.keep.id}\` | \`${b.err.id}\` |\n`;
      md += `| phone | ${b.keep.phone} ${b.keep.phone_is_test ? '🧪test' : '✅실'} | ${b.err.phone} ${b.err.phone_is_test ? '🧪test' : '✅실'} |\n`;
      md += `| chart_number | ${b.keep.chart} | ${b.err.chart} |\n`;
      md += `| visit_type | ${b.keep.visit_type} | ${b.err.visit_type} |\n`;
      md += `| created_at | ${b.keep.created_at} | ${b.err.created_at} |\n`;
      md += `| 연결자산 합 | ${b.keep.total_refs} | ${b.err.total_refs} |\n`;
      md += `| 판정점수 | ${b.keep.score} | ${b.err.score} |\n\n`;
      md += `### 중복측(ERR \`${cs.err.customer_id}\`) 매달린 자산 — 병합 시 keep 으로 재귀속 대상\n`;
      md += renderRefs(cs.err.refs);
      md += `\n### 정본측(KEEP) 현 보유 자산 (참고)\n`;
      md += renderRefs(cs.keep.refs);
      md += `\n### 충돌 검사\n`;
      for (const c of cs.conflicts) {
        md += `- **${c.constraint}**: ${c.risk}`;
        if (c.keep_phone) md += ` (keep=${c.keep_phone} / err=${c.err_phone}, 동일=${c.phones_equal})`;
        if (c.keep_chart) md += ` (keep=${c.keep_chart} / err=${c.err_chart})`;
        md += `\n`;
      }
    } else {
      md += `### check_in (오연결 본체)\n`;
      const ci = cs.checkin;
      md += `- \`${ci.id}\` name=**${ci.customer_name}** phone=${ci.customer_phone} status=${ci.status} visit=${ci.visit_type} checked_in=${ci.checked_in_at}\n`;
      md += `- 현 customer_id=\`${ci.customer_id}\` → 이 고객은 **김구번(test)** 임 (name 불일치 = 신원 혼입)\n\n`;
      md += `### 진짜 김민경 customer (재연결 후보)\n`;
      const r = cs.real_customer;
      md += `- \`${r.id}\` ${r.name} phone=${r.phone} chart=${r.chart_number} created=${r.created_at}\n`;
      md += `- ⚠️ check_in phone(${ci.customer_phone}) ≠ 진짜 김민경 phone(${r.phone}) → 동일인 확증 불가\n\n`;
      md += `### 오연결 대상 김구번(test \`${cs.wrong_customer.customer_id}\`) 현 보유 자산 (영향 범위)\n`;
      md += renderRefs(cs.wrong_customer.refs);
      md += `\n### 판정\n- ${cs.verdict.summary}\n`;
      for (const o of cs.verdict.options) md += `  - ${o}\n`;
      md += `- **필수: ${cs.verdict.requires}**\n`;
    }
  }

  function renderRefs(refs) {
    const keys = Object.keys(refs).filter((k) => refs[k].n > 0);
    if (!keys.length) return '_연결 자산 없음_\n';
    let s = '';
    for (const k of keys) {
      const r = refs[k];
      s += `- \`${k}\`: **${r.n}건**`;
      const ids = (r.rows || []).slice(0, 10).map((row) => {
        const extra = row.status ? `:${row.status}` : row.amount != null ? `:${row.amount}원` : row.visit_date ? `:${String(row.visit_date).slice(0, 10)}` : row.name ? `:${row.name}` : '';
        return `${String(row.id).slice(0, 8)}${extra}`;
      });
      s += ` [${ids.join(', ')}${r.n > 10 ? ', …' : ''}]\n`;
    }
    return s;
  }

  writeFileSync(join(OUT_DIR, 'T-20260607-CUSTOMER-MASTER-DUP-TRIAGE_ac1.md'), md);

  // stdout 요약
  const sum = result.cases.map((c) => {
    if (c.type === 'dup_pair') return `${c.key}: keep=${c.verdict.proposed_keep.slice(0, 8)} (티켓일치=${c.verdict.proposed_keep_matches_ticket}) err자산=${c.err.total_refs} keep자산=${c.keep.total_refs}`;
    return `${c.key}: MISLINK — check_in→test고객, 신원확인 필요(자동금지). 김구번 보유자산=${c.wrong_customer.total_refs}`;
  });
  console.log(JSON.stringify({ READ_ONLY: true, generated_at: result.generated_at, cases: sum }, null, 2));
  console.log('\n📄 scripts/out/T-20260607-CUSTOMER-MASTER-DUP-TRIAGE_ac1.md (+ .json)');
})().catch((e) => { console.error('❌', e.message, e.stack); process.exitCode = 1; });
