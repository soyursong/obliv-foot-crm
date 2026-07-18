/**
 * T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE — supervisor DML 게이트 DRY-RUN (READ-ONLY)
 *
 * 목적: 파괴적 DELETE 적용 前, LIVE prod 상태가 dev Step1 freeze 와 여전히 일치하는지 재검증.
 *   (a) 동명 census: name_ko LIKE '대웅푸루나졸%' = 1  (freeze=1)
 *   (b) 대상 정확 식별: code_source=custom AND claim_code=LEGACY-12d7730e32e8
 *   (c) 임상/청구 abort 4종 = 0 (금기 FK / 화이트 FK / 묶음 JSONB / 처방이력 JSONB)
 *   (d) 폴더 FK = 계측만(비-abort). CASCADE 자동정리 + archive-first 스냅샷 = 가역(FIX-REQUEST 옵션①).
 * *** SELECT 만. write 0. *** 판정만 출력.
 *
 * rev 2026-07-19 (supervisor DML게이트 NO_GO → FIX-REQUEST 반영):
 *   최초(7-18) 러너는 폴더를 abort 합산(refTotal)에 포함 → 폴더=1 로 NO_GO.
 *   정정: 폴더 '처방세트 이관'은 조직용 배지(FK ON DELETE CASCADE)로 임상/청구 무결성과 무관.
 *   폴더를 abort 합산에서 제외(계측만)하고 archive-first 1단에서 폴더 멤버십도 스냅샷 → 가역.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REF = 'rxlomoozakkjesdqjtvd';
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const ACCESS_TOKEN = envVal('SUPABASE_ACCESS_TOKEN');
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN 필요');

async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const num = (rows, k = 'n') => Number(rows?.[0]?.[k] ?? -1);

async function main() {
  const out = [];
  const log = (s) => { console.log(s); out.push(s); };
  log('# DAEWOONG-PLURANAZOLE-REMOVE — supervisor DML gate DRY-RUN (READ-ONLY)');
  log(`- prod: ${REF} | ${new Date().toISOString()}`);

  // (a) 동명 census
  const census = num(await runSQL(`select count(*)::int as n from public.prescription_codes where name_ko like '대웅푸루나졸%';`));
  log(`\n[a] 동명 census (name_ko LIKE '대웅푸루나졸%') = ${census}  (freeze=1)`);

  // (b) 대상 식별 + 전체 동명 목록(규격 드리프트 감시)
  const list = await runSQL(`select id, name_ko, code_source, claim_code from public.prescription_codes where name_ko like '대웅푸루나졸%' order by name_ko;`);
  log(`[b] 동명 전체 행:`);
  for (const r of (list ?? [])) log(`     - ${r.id} | ${r.name_ko} | src=${r.code_source} | claim=${r.claim_code}`);
  const target = (list ?? []).find(r => r.code_source === 'custom' && r.claim_code === 'LEGACY-12d7730e32e8');
  log(`[b] 대상 식별(custom / LEGACY-12d7730e32e8): ${target ? target.id : 'NOT FOUND'}`);

  let refs = { contra: -1, folder: -1, allow: -1, set: -1, chart: -1 };
  if (target) {
    const tid = target.id;
    refs.contra = num(await runSQL(`select count(*)::int as n from public.prescription_contraindications where prescription_code_id = '${tid}';`));
    // 나머지 4종은 존재 가드 후
    const reg = async (tbl) => num(await runSQL(`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='${tbl}';`));
    if (await reg('prescription_code_folders'))
      refs.folder = num(await runSQL(`select count(*)::int as n from public.prescription_code_folders where prescription_code_id = '${tid}';`));
    else refs.folder = 0;
    if (await reg('prescription_code_allowlist'))
      refs.allow = num(await runSQL(`select count(*)::int as n from public.prescription_code_allowlist where prescription_code_id = '${tid}';`));
    else refs.allow = 0;
    if (await reg('prescription_sets'))
      refs.set = num(await runSQL(`select count(*)::int as n from public.prescription_sets s where exists (select 1 from jsonb_array_elements(coalesce(s.items,'[]'::jsonb)) e where e->>'prescription_code_id' = '${tid}');`));
    else refs.set = 0;
    if (await reg('medical_charts'))
      refs.chart = num(await runSQL(`select count(*)::int as n from public.medical_charts m where exists (select 1 from jsonb_array_elements(coalesce(m.prescription_items,'[]'::jsonb)) e where e->>'prescription_code_id' = '${tid}');`));
    else refs.chart = 0;
  }
  // abort 합산 = 임상/청구 4종만(폴더 제외). 폴더는 CASCADE·비-abort → 계측만.
  const abortRefTotal = refs.contra + refs.allow + refs.set + refs.chart;
  const refTotal = abortRefTotal + refs.folder; // 참고(총 참조), 판정엔 미사용
  log(`\n[c] 임상/청구 abort 4종: 금기=${refs.contra} 화이트=${refs.allow} 묶음=${refs.set} 처방이력=${refs.chart}  → abort 합계=${abortRefTotal}`);
  log(`[d] 폴더(비-abort·CASCADE): ${refs.folder}  (archive-first 스냅샷으로 롤백 원복 가역 → 판정 제외)`);

  const verdict = (census === 1 && target && abortRefTotal === 0) ? 'GO' : 'NO_GO';
  log(`\n=== DML GATE DRY-RUN VERDICT: ${verdict} ===`);
  log(`   census==1: ${census === 1} | target found: ${!!target} | abortRefs==0: ${abortRefTotal === 0} | folder(비-abort)=${refs.folder}`);

  const dir = join(__dirname, 'out');
  mkdirSync(dir, { recursive: true });
  const evidence = { ticket: 'T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE', ts: new Date().toISOString(),
    census, target_id: target?.id ?? null, target_row: target ?? null, refs,
    abortRefTotal, refTotal, folder_nonabort: refs.folder, verdict,
    verdict_policy: 'folder(prescription_code_folders)=CASCADE badge → abort 합산 제외, archive-first 스냅샷으로 가역(FIX-REQUEST 옵션①)',
    all_named: list };
  writeFileSync(join(dir, 'daewoong_dmlgate_dryrun.json'), JSON.stringify(evidence, null, 2));
  log(`\n[evidence] scripts/out/daewoong_dmlgate_dryrun.json`);
  process.exit(verdict === 'GO' ? 0 : 2);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
