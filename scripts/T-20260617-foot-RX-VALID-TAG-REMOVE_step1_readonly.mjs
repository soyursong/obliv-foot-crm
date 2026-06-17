/**
 * T-20260617-foot-RX-VALID-TAG-REMOVE — Step 1 READ-ONLY grounding (SELECT only)
 *
 * 목적: "검증 태그" 데이터 정체 확정 + 모집단 COUNT. DML 0건 (SELECT 전용).
 *   - is_verified/verified_at 컬럼 존재 여부
 *   - code_type='이관약'(='이관' 배지) COUNT
 *   - code_source='custom'(='자체' 배지) COUNT
 *   - 교집합(이관약 ∩ custom), 차집합
 *   - HIRA-MAP 모집단(19종) 대조: code_source='custom' 분해
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

const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const q = async (sql) => (await client.query(sql)).rows;

await client.connect();
console.log(`READ-ONLY grounding ${new Date().toISOString()} (SELECT only, 영속 변경 0)\n`);

// [1] 검증/verified 컬럼 존재 여부
const cols = await q(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='prescription_codes' ORDER BY ordinal_position`);
console.log('── [1] prescription_codes 컬럼 ──');
console.log(cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));
const hasVerified = cols.some(c => /verif/i.test(c.column_name));
console.log(`검증/verified 컬럼 존재? ${hasVerified ? 'YES' : 'NO (가설B 컬럼 없음)'}\n`);

// [2] 모집단 COUNT
const total = (await q(`SELECT count(*) n FROM prescription_codes`))[0].n;
const byType = await q(`SELECT coalesce(code_type,'<null>') code_type, count(*) n
  FROM prescription_codes GROUP BY 1 ORDER BY n DESC`);
const bySource = await q(`SELECT coalesce(code_source,'<null>') code_source, count(*) n
  FROM prescription_codes GROUP BY 1 ORDER BY n DESC`);
console.log('── [2] 모집단 ──');
console.log(`전체 prescription_codes = ${total}`);
console.log('code_type 분포:', byType.map(r => `${r.code_type}=${r.n}`).join(', '));
console.log('code_source 분포:', bySource.map(r => `${r.code_source}=${r.n}`).join(', '), '\n');

// [3] 이관약(='이관' 배지) vs custom(='자체' 배지) 교차
const x = (await q(`SELECT
    count(*) FILTER (WHERE code_type='이관약')                              AS migrated,
    count(*) FILTER (WHERE code_source='custom')                          AS custom,
    count(*) FILTER (WHERE code_type='이관약' AND code_source='custom')    AS migrated_and_custom,
    count(*) FILTER (WHERE code_type='이관약' AND code_source<>'custom')   AS migrated_not_custom,
    count(*) FILTER (WHERE code_source='custom' AND code_type IS DISTINCT FROM '이관약') AS custom_not_migrated
  FROM prescription_codes`))[0];
console.log('── [3] 이관(code_type=이관약) vs 자체(code_source=custom) 교차 ──');
console.log(`이관약(이관 배지)              = ${x.migrated}`);
console.log(`custom(자체 배지)             = ${x.custom}`);
console.log(`이관약 ∩ custom               = ${x.migrated_and_custom}`);
console.log(`이관약 - custom(이관but공식)  = ${x.migrated_not_custom}`);
console.log(`custom - 이관약(자체but비이관)= ${x.custom_not_migrated}\n`);

// [4] 이관약 claim_code 패턴 (RXMIG = 신규생성 vs 기존재사용)
const rxmig = await q(`SELECT
    count(*) FILTER (WHERE claim_code LIKE 'RXMIG-%') AS rxmig,
    count(*) FILTER (WHERE claim_code NOT LIKE 'RXMIG-%') AS non_rxmig
  FROM prescription_codes WHERE code_type='이관약'`);
console.log('── [4] 이관약 claim_code 패턴 ──');
console.log(`RXMIG-(자유텍스트 신규생성)=${rxmig[0].rxmig}, 그외=${rxmig[0].non_rxmig}\n`);

// [5] 이관약 insurance_status 분포 (청구안전 — HIRA코드 보유 여부 proxy)
const ins = await q(`SELECT coalesce(insurance_status,'<null>') s, count(*) n
  FROM prescription_codes WHERE code_type='이관약' GROUP BY 1 ORDER BY n DESC`);
console.log('── [5] 이관약 insurance_status 분포 ──');
console.log(ins.map(r => `${r.s}=${r.n}`).join(', '), '\n');

await client.end();
console.log('DONE (영속 변경 0)');
