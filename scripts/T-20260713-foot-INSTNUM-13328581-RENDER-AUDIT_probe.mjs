/**
 * T-20260713-foot-OBLIVORIGIN-SEAL-INSTNUM-REGISTER — RENDER AUDIT probe (READ-ONLY)
 *
 * 목적(부모 T-20260714-ops-INSTNUM-13328581-ALLCRM-SWEEP):
 *   요양기관번호 13328581 종로 등록 후 (a) DB 정본 확인, (b) 스코프 가드(종로만, 송도·타지점 null 유지)
 *   id↔slug 재검증. 렌더는 전부 clinics.nhis_code 데이터 구동(하드코딩 없음)이므로
 *   DB 정본 = 모든 서류(EDI header institution_code / print form clinic_nhis_code·clinic_code) 렌더값.
 *
 * READ-ONLY: SELECT only. 원장 write 없음.
 * author: dev-foot / 2026-07-14
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

// 1) 전 지점 nhis_code 전수 (id, slug, name, nhis_code) — 스코프 가드 근거
const clinics = await q(`SELECT id, slug, name, nhis_code FROM clinics ORDER BY slug;`);
console.log('=== clinics 전수 (id↔slug↔nhis_code) ===');
console.table(clinics.map(c => ({ id: c.id, slug: c.slug, name: c.name, nhis_code: c.nhis_code })));

// 2) 스코프 가드 판정
const jongno = clinics.find(c => c.slug.startsWith('jongno'));
const others = clinics.filter(c => !c.slug.startsWith('jongno'));
const jongnoOk = jongno && jongno.nhis_code === '13328581';
const othersNull = others.every(c => c.nhis_code == null);
console.log('\n=== 스코프 가드 판정 ===');
console.log('jongno(id=' + (jongno?.id ?? '?') + ') nhis_code =', JSON.stringify(jongno?.nhis_code), jongnoOk ? '✓ 13328581' : '✗ MISMATCH');
for (const c of others) {
  console.log(`${c.slug}(id=${c.id}) nhis_code =`, JSON.stringify(c.nhis_code), c.nhis_code == null ? '✓ null(미변경)' : '✗ NON-NULL — 스코프 위반!');
}
console.log('\nSUMMARY:', jongnoOk && othersNull ? 'PASS — 종로만 13328581, 타지점 null 유지' : 'FAIL — 확인 필요');
