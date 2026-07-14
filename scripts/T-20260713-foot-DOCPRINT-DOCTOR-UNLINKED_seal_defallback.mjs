/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN#3, B안 field-confirm 2026-07-14T10:22 KST]
 * 김주연 총괄(U0ATDB587PV): "문지은 원장님 도장은 요청한 적 없는데 기존 대표 도장 어디갔어?"
 *   → 미지정 폴백 도장 = 문지은 원장 개인직인 거부·제거 → 오블리브오리진 법인 인감(빨간) 복원.
 *
 * 조치(데이터 정합): 대표원장(문지은, is_default) clinic_doctors.seal_image_url = NULL 로 복원한다.
 *   법인 인감은 autoBindContext getStampUrl()(jongno-foot-stamp.png, priority-2) = OBLIVORIGIN 법인
 *   전자인감과 byte-identical(md5 0b206e2d) 로 이미 in-repo → 개인직인 pointer만 비우면 자동 재렌더
 *   ('기존 대표 도장' 히스토리컬 상태 복원, 7-13 이전 상태). 신규 이미지/업로드 불요.
 *   ※ 문지은 is_default 플래그·이름은 무변경(이름 폴백 유지 = AC-8/9 공란 방지).
 *   ※ 한동훈/김윤기/김상은 개인 도장 seal_image_url 무변경(지정 진료의 개인 도장 유지, AC-5).
 * db_change=false — 旣존 컬럼(seal_image_url) 값 clear(data-write), DDL 0, 신규 스키마 0(AC-7).
 *
 * 사용:
 *   node ..._seal_defallback.mjs dry       # 현행 4행 seal 상태 조회(무영속)
 *   node ..._seal_defallback.mjs apply      # backup(문지은 현행 값) → seal_image_url=NULL → verify
 *   node ..._seal_defallback.mjs verify     # 문지은=NULL, 지정 3인=값 유지 확인
 *   node ..._seal_defallback.mjs rollback   # backup에서 문지은 seal_image_url 원복
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const FALLBACK_NAME = '문지은';               // is_default 대표원장 (폴백 슬롯 — 개인직인 제거 대상)
const KEEP_NAMES = ['한동훈', '김윤기', '김상은']; // 지정 진료의 (개인 도장 유지 — 불변 검증)
const BK = path.join(REPO, 'evidence/seal-swap/defallback-backup.json');

async function all() {
  const { data, error } = await sb.from('clinic_doctors')
    .select('id,name,is_default,seal_image_url').eq('clinic_id', CLINIC);
  if (error) throw new Error(error.message);
  return data;
}
async function dry() {
  for (const d of await all()) {
    const tag = d.name === FALLBACK_NAME ? '→ NULL 대상(폴백 개인직인 제거)' : KEEP_NAMES.includes(d.name) ? '유지(지정 개인 도장)' : '';
    console.log(`  ${d.is_default ? '★' : ' '} ${d.name.padEnd(6)} seal=${d.seal_image_url || 'NULL'} ${tag}`);
  }
}
async function apply() {
  const rows = await all();
  const target = rows.find((d) => d.name === FALLBACK_NAME && d.is_default);
  if (!target) throw new Error(`대상 미발견: is_default=${FALLBACK_NAME}`);
  fs.mkdirSync(path.dirname(BK), { recursive: true });
  fs.writeFileSync(BK, JSON.stringify({ id: target.id, name: target.name, seal_image_url: target.seal_image_url, ts: 'apply' }, null, 2));
  console.log(`  backup: ${target.name} seal=${target.seal_image_url || 'NULL'} → ${BK}`);
  if (target.seal_image_url === null) { console.log('  이미 NULL — no-op'); return verify(); }
  const { error } = await sb.from('clinic_doctors').update({ seal_image_url: null }).eq('id', target.id);
  if (error) throw new Error(error.message);
  console.log(`  ✅ ${target.name} seal_image_url → NULL`);
  await verify();
}
async function verify() {
  const rows = await all();
  const fb = rows.find((d) => d.name === FALLBACK_NAME);
  let ok = true;
  if (fb.seal_image_url !== null) { console.log(`  ✗ ${FALLBACK_NAME} seal != NULL (${fb.seal_image_url})`); ok = false; }
  else console.log(`  ✓ ${FALLBACK_NAME}(is_default) seal=NULL → 법인 인감(getStampUrl) 폴스루`);
  for (const n of KEEP_NAMES) {
    const r = rows.find((d) => d.name === n);
    if (!r?.seal_image_url) { console.log(`  ✗ ${n} 개인 도장 seal 소실!(${r?.seal_image_url})`); ok = false; }
    else console.log(`  ✓ ${n} 개인 도장 유지 (${r.seal_image_url.slice(0, 40)}…)`);
  }
  console.log(ok ? '  === VERIFY PASS ===' : '  === VERIFY FAIL ===');
  if (!ok) process.exit(1);
}
async function rollback() {
  if (!fs.existsSync(BK)) throw new Error('backup 없음');
  const b = JSON.parse(fs.readFileSync(BK, 'utf8'));
  const { error } = await sb.from('clinic_doctors').update({ seal_image_url: b.seal_image_url }).eq('id', b.id);
  if (error) throw new Error(error.message);
  console.log(`  ↩ rollback ${b.name} seal_image_url → ${b.seal_image_url || 'NULL'}`);
}
const cmd = process.argv[2] || 'dry';
({ dry, apply, verify, rollback })[cmd]?.() ?? (console.error(`unknown: ${cmd}`), process.exit(1));
