/**
 * T-20260715-meta-PHI-SYSTEMIC-PATIENT-IDENTIFIER-SWEEP — TRIAGE (READ-ONLY, mutation 0)
 * 소관: dev-foot (foot CRM = authoritative "실 chart-bearing 환자?" 판정처)
 * 근거: da_ruling_phi_systemic_patient_identifier_sweep_20260715.md §2 TRIAGE 게이트 / phi_redaction_standard v1.9 §1 LOW 조항.
 *
 * 입력 cohort:
 *   - STATS-RESVCOUNT desync freeze-set 12 ccid (dopamine cue_card.id = foot reservations.external_id)
 *   - C2Z1 티켓 앵커 chart F-4571 / F-4631
 * 판정: 각 customers 행 → real(실 chart-bearing 환자) vs synthetic(합성 seed/픽스처).
 *   근거키 = is_simulation / phone_dummy / chart_number(F-46xx) / created_by / name pattern.
 *   fail-closed toward privacy: 모호 = real(redact). confirmed synthetic만 KEEP.
 * phone: TRIAGE 불요 — cohort 전량 redact 대상. 목록만 산출.
 *
 * 출력: OFF-GIT only (~/phi-offgit/…) 평문 성명/phone 포함. 콘솔은 count/UUID/chart만(PHI-free, git-safe).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { try { TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,''); } catch {} }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
async function qok(sql){ const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}); const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`); return JSON.parse(t); }
const rows = x => x.result ?? x;

const CCIDS = [
  '438b6d2a-4a6b-4a77-b637-df1e1287127f','ce1402fb-248a-4ae9-b03f-0fbdbc341721',
  'a0d7bad0-cd5c-4647-9324-96f2eddbebbb','f9778815-045c-4d11-974f-f1cb5a09864c',
  '91bd82b1-ab84-485a-a784-c1b7e45a592b','de3e4be5-bdbf-4aa1-98a6-5f2bc941a4d2',
  '86043dea-2cba-4c4a-80ae-b78f95432259','0e0f71fc-3f6b-4f8a-b857-f4ff0c94e61c',
  'c47efbd5-235c-4e35-b3a5-c455371f53ed','5bf4ba7d-c85a-4e7d-90e7-a0f329e895c6',
  '27b75af4-28c2-4922-87f3-efa14ae193d3','1e0709d6-742c-4ad1-b82b-9cd190c538bc',
];
const CHARTS = ['F-4571','F-4631'];

// synthetic name 패턴 (테스트 픽스처형)
const SYN_NAME = /(테스트|더미|dummy|test|샘플|sample|시뮬|가짜|\*|시연|데모|demo|픽스처|fixture|홍길동)/i;
const rname  = n => n==null ? 'NULL' : (String(n).slice(0,1)+'·'+(String(n).length>1?'*'.repeat(String(n).length-1):''));
const rphone = p => p==null ? 'NULL' : String(p).replace(/\d(?=\d{2})/g,'•');

async function main(){
  const outDir = `${homedir()}/phi-offgit/T-20260715-meta-PHI-SYSTEMIC-PATIENT-IDENTIFIER-SWEEP`;
  mkdirSync(outDir, { recursive: true });

  console.log('=== PHI SYSTEMIC TRIAGE (READ-ONLY, foot CRM) ===');
  console.log('git-safe 콘솔: count/UUID/chart만. 평문은 off-git 파일에만.\n');

  // 0) customers provenance 컬럼
  const cols = rows(await qok(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' ORDER BY ordinal_position;`));
  const colset = new Set(cols.map(c=>c.column_name));
  const prov = ['id','name','phone','chart_number','is_simulation','phone_dummy','created_by','created_at','source_system','is_dummy','test_flag']
    .filter(c=>colset.has(c));
  console.log('0) customers provenance 컬럼:', prov.join(', '));
  const sel = prov.join(', ');

  // 1) freeze-set 12 ccid → foot reservations 매칭 → customer_id
  const resv = rows(await qok(`
    SELECT r.external_id, r.customer_id, r.reservation_date, r.status, r.updated_at
    FROM public.reservations r
    WHERE r.external_id = ANY(ARRAY[${CCIDS.map(x=>`'${x}'`).join(',')}]::text[])
    ORDER BY r.reservation_date;`));
  console.log(`\n1) freeze-set 12 ccid → foot reservations 매칭: ${resv.length}건`);
  const custIds = [...new Set(resv.map(r=>r.customer_id).filter(Boolean))];
  console.log(`   distinct customer_id: ${custIds.length}`);

  // 2) 해당 customers + chart F-4571/F-4631 조회
  const custById = custIds.length ? rows(await qok(`
    SELECT ${sel} FROM public.customers
    WHERE id = ANY(ARRAY[${custIds.map(x=>`'${x}'`).join(',')}]::uuid[]);`)) : [];
  const custByChart = rows(await qok(`
    SELECT ${sel} FROM public.customers
    WHERE chart_number = ANY(ARRAY[${CHARTS.map(x=>`'${x}'`).join(',')}]::text[]);`));

  // merge distinct by id
  const merged = new Map();
  for (const c of [...custById, ...custByChart]) merged.set(c.id, c);
  const all = [...merged.values()];
  console.log(`\n2) TRIAGE 대상 distinct customers: ${all.length}건 (freeze-set ${custById.length} + chart-anchor ${custByChart.length}, dedup)`);

  // 3) 분류
  const classify = c => {
    const reasons = [];
    let synthetic = false;
    if (c.is_simulation === true) { synthetic = true; reasons.push('is_simulation=true'); }
    if (c.is_dummy === true) { synthetic = true; reasons.push('is_dummy=true'); }
    if (c.test_flag === true) { synthetic = true; reasons.push('test_flag=true'); }
    if (c.phone_dummy === true) reasons.push('phone_dummy=true(참고)');
    if (c.name && SYN_NAME.test(String(c.name))) { synthetic = true; reasons.push('name=synthetic-pattern'); }
    const hasChart = c.chart_number && /^F-?\d{3,}/i.test(String(c.chart_number));
    if (hasChart) reasons.push(`chart_number=${c.chart_number}(실차트 지표)`);
    // fail-closed: 실차트 있으면 무조건 real 취급(합성 플래그와 상충 시 real 우선)
    let verdict;
    if (hasChart) { verdict = 'REAL'; if (synthetic) reasons.push('⚠상충: 합성플래그 있으나 실차트 존재→fail-closed REAL'); }
    else if (synthetic) verdict = 'SYNTHETIC';
    else { verdict = 'REAL'; reasons.push('모호(합성근거 없음)→fail-closed REAL'); }
    return { verdict, reasons };
  };

  const report = all.map(c => {
    const { verdict, reasons } = classify(c);
    const ccid = (resv.find(r=>r.customer_id===c.id)||{}).external_id || null;
    return { ...c, _verdict: verdict, _reasons: reasons, _ccid: ccid };
  });

  const realN = report.filter(r=>r._verdict==='REAL').length;
  const synN  = report.filter(r=>r._verdict==='SYNTHETIC').length;
  console.log(`\n3) 분류 결과: REAL(redact 대상)=${realN} / SYNTHETIC(KEEP)=${synN}`);

  // ── 콘솔: PHI-free (UUID+chart+verdict+reason) ──
  console.log('\n--- git-safe 요약 (UUID/chart/verdict, 성명·phone 없음) ---');
  for (const r of report) {
    console.log(`  ${r._verdict.padEnd(9)} id=${r.id} chart=${r.chart_number||'∅'} ccid=${r._ccid?r._ccid.slice(0,8):'∅'}  근거=[${r._reasons.join(' | ')}]`);
  }

  // ── OFF-GIT: 평문 성명 + phone + 근거 ──
  const stamp = new Date().toISOString();
  const lines = [];
  lines.push('# OFF-GIT TRIAGE SNAPSHOT — PHI 평문 포함 · git-track 절대 금지');
  lines.push(`# T-20260715-meta-PHI-SYSTEMIC-PATIENT-IDENTIFIER-SWEEP · dev-foot · ${stamp}`);
  lines.push(`# 소스: foot CRM customers (READ-ONLY). DB 파괴 0.`);
  lines.push(`# 분류: REAL=redact 대상 / SYNTHETIC=KEEP 예외. fail-closed toward privacy.`);
  lines.push(`# 총 ${report.length}건 (REAL ${realN} / SYNTHETIC ${synN})`);
  lines.push('');
  lines.push('## 성명별 분류');
  for (const r of report) {
    lines.push(`- [${r._verdict}] name="${r.name}" phone="${r.phone||'NULL'}" chart=${r.chart_number||'∅'} id=${r.id} ccid=${r._ccid||'∅'} is_simulation=${r.is_simulation} phone_dummy=${r.phone_dummy}`);
    lines.push(`    근거: ${r._reasons.join(' | ')}`);
  }
  lines.push('');
  lines.push('## REDACT 대상 식별자 (git grep worklist — 성명)');
  for (const r of report.filter(x=>x._verdict==='REAL')) lines.push(`  성명: ${r.name}   (id=${r.id}, chart=${r.chart_number||'∅'})`);
  lines.push('');
  lines.push('## REDACT 대상 식별자 (phone — TRIAGE 불요, 전량 redact)');
  for (const r of report) if (r.phone) lines.push(`  phone: ${r.phone}   (E.164/국내표기 파생 포함, name=${r.name})`);
  lines.push('');
  lines.push('## KEEP 예외 (confirmed synthetic)');
  const keeps = report.filter(x=>x._verdict==='SYNTHETIC');
  if (keeps.length) for (const r of keeps) lines.push(`  KEEP: name="${r.name}" id=${r.id} 근거=${r._reasons.join(' | ')}`);
  else lines.push('  (없음 — 전건 REAL)');

  const outFile = `${outDir}/triage_snapshot_${stamp.replace(/[:.]/g,'').slice(0,15)}.md`;
  writeFileSync(outFile, lines.join('\n')+'\n');
  console.log(`\n✅ OFF-GIT 스냅샷 기록: ${outFile}`);
  console.log(`   (평문 성명/phone은 이 파일에만. 콘솔·git 로그엔 count/UUID/chart만.)`);

  // ccid → reservation 매칭 누락 진단
  const matchedCcids = new Set(resv.map(r=>r.external_id));
  const missing = CCIDS.filter(x=>!matchedCcids.has(x));
  console.log(`\n4) freeze-set ccid 매칭 진단: 매칭 ${matchedCcids.size}/12, 미매칭 ${missing.length}`);
  if (missing.length) console.log('   미매칭 ccid(foot reservations.external_id 부재):', missing.map(x=>x.slice(0,8)).join(', '));
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1);});
