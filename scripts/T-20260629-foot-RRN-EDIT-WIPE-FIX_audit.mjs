// T-20260629-foot-RRN-EDIT-WIPE-FIX — Phase 1.5-① PROD READ-ONLY 데이터 유실 실태 점검
//   목적: 06-29 배포(f75bb44d, 12:44) 이후 직원 계정 RRN 수정·저장으로 customers.rrn_enc 의
//         backhalf 가 blank/NULL 로 손상됐는지 판별.
//   ★PHI 가드★: rrn_decrypt 호출 금지. 평문 RRN 로깅/출력 금지. rrn_enc(암호문)은 NULL 여부 +
//              octet_length(바이트수)만 집계 — 암호문 내용 자체도 출력하지 않음.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
const env = { ...config({ path: '.env' }).parsed, ...config({ path: '.env.local' }).parsed };
const URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) { console.error('env 누락'); process.exit(1); }
const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });

const DEPLOY_TS = '2026-06-29T03:44:19Z'; // f75bb44d 배포(12:44 KST = 03:44 UTC)

// 1) 전체 customers + rrn_enc NULL/길이 분포 (암호문 hex → 바이트수만)
const { data: rows, error } = await sb
  .from('customers')
  .select('id, chart_number, clinic_id, created_at, updated_at, rrn_enc')
  .order('updated_at', { ascending: false });
if (error) { console.error('query err:', error.message); process.exit(1); }

let total = rows.length, encNull = 0, encPresent = 0;
const lenHist = {};         // 암호문 바이트수 분포
const shortEnc = [];        // 비정상적으로 짧은 암호문(=빈문자열 암호화 의심)
const recentEdited = [];    // 배포 이후 updated_at 변경 레코드

// pgp_sym_encrypt('') 도 헤더+패딩으로 보통 50바이트 이상. 정상 13자리 RRN 암호문은 그보다 큼.
// 안전 임계: 40바이트 미만 = 의심(빈/부분값 암호화 가능성). (절대 복호 안 함)
const SHORT_THRESHOLD = 40;

for (const r of rows) {
  const hex = r.rrn_enc; // PostgREST bytea → '\\x...' hex 문자열 (또는 null)
  if (!hex) { encNull++; continue; }
  encPresent++;
  const clean = String(hex).replace(/^\\x/, '');
  const bytes = Math.floor(clean.length / 2);
  lenHist[bytes] = (lenHist[bytes] || 0) + 1;
  if (bytes < SHORT_THRESHOLD) shortEnc.push({ id: r.id, chart: r.chart_number, bytes, updated_at: r.updated_at });
  if (r.updated_at && r.updated_at > DEPLOY_TS) {
    recentEdited.push({ id: r.id, chart: r.chart_number, clinic_id: r.clinic_id, updated_at: r.updated_at, encBytes: bytes });
  }
}
// 배포 이후 rrn_enc=NULL 이면서 updated 된 건 (유실 의심) — 별도 집계
const recentNullEnc = rows.filter(r => !r.rrn_enc && r.updated_at && r.updated_at > DEPLOY_TS)
  .map(r => ({ id: r.id, chart: r.chart_number, clinic_id: r.clinic_id, updated_at: r.updated_at }));

console.log('═══ T-20260629 RRN-EDIT-WIPE 데이터 유실 감사 (read-only, 복호 없음) ═══');
console.log(`총 customers: ${total}`);
console.log(`rrn_enc 존재: ${encPresent} / NULL: ${encNull}`);
console.log(`암호문 바이트수 분포:`, JSON.stringify(lenHist));
console.log(`\n── 의심 짧은 암호문(<${SHORT_THRESHOLD}B, 빈/부분값 암호화 의심): ${shortEnc.length}건 ──`);
console.log(JSON.stringify(shortEnc, null, 2));
console.log(`\n── 배포(06-29 12:44 KST) 이후 updated_at 변경 + rrn_enc 보유: ${recentEdited.length}건 ──`);
console.log(JSON.stringify(recentEdited, null, 2));
console.log(`\n── ★유실 의심★ 배포 이후 updated 됐는데 rrn_enc=NULL: ${recentNullEnc.length}건 ──`);
console.log(JSON.stringify(recentNullEnc, null, 2));

// 2) rrn_decrypt 함수 게이트(A2) 가 prod 에 live 한지 정의 조회 (복호 호출 아님, 함수 소스만)
const { data: fnDef, error: fnErr } = await sb.rpc('exec_sql_readonly', {
  q: "select pg_get_functiondef(oid) as def from pg_proc where proname='rrn_decrypt'"
}).then(r => r, e => ({ error: e }));
if (fnErr || !fnDef) {
  console.log('\n[rrn_decrypt 정의 조회는 exec RPC 부재로 스킵 — 마이그 소스로 게이트 확인]');
} else {
  const def = String(JSON.stringify(fnDef));
  console.log('\nrrn_decrypt A2 게이트 live:', def.includes('coordinator') ? 'YES(coordinator 포함)' : 'NO(미포함=drift)');
}
console.log('\n═══ 감사 종료 ═══');
