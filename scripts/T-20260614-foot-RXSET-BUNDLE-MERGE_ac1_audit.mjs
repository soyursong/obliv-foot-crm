/**
 * T-20260614-foot-RXSET-BUNDLE-MERGE — AC-1 선행 감사 (READ-ONLY, NO WRITE)
 *
 * 목적(착수 전 필수): prescription_sets 중
 *   (1) items 길이 1 (단독약) 세트 개수 / 다종 세트 개수
 *   (2) folder 값 분포 (NULL=미분류 포함)
 *   (3) 옵션A 영향 범위: 단독약 세트 중 folder != '약' 인 = UPDATE 대상 건수
 *   (4) NAMEDESC 적용 상태 동시 점검 (items[0].name == name 인 비율 — 같은 테이블 충돌 조율용)
 *   (5) quick_rx_buttons 가 prescription_sets 를 참조하는지 (옵션A set id 불변이라 보존되는지 확인)
 *
 * *** 이 스크립트는 SELECT 만 수행. 어떤 write 도 하지 않는다. ***
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const arrLen = (items) => (Array.isArray(items) ? items.length : 0);
const norm = (v) => (v == null ? null : String(v));

async function main() {
  // 전체 처방세트 로드
  const { data: sets, error } = await sb
    .from('prescription_sets')
    .select('id, name, items, folder, is_active, sort_order')
    .order('sort_order', { nullsFirst: false });

  if (error) {
    console.error('LOAD ERROR:', error.message);
    process.exit(1);
  }

  const total = sets.length;
  const single = sets.filter((s) => arrLen(s.items) === 1);
  const multi = sets.filter((s) => arrLen(s.items) > 1);
  const zero = sets.filter((s) => arrLen(s.items) === 0);

  // (2) folder 분포 (전체)
  const folderDist = {};
  for (const s of sets) {
    const key = s.folder == null ? '∅(NULL/미분류)' : `"${s.folder}"`;
    folderDist[key] = (folderDist[key] || 0) + 1;
  }

  // folder 분포 (단독약 only)
  const singleFolderDist = {};
  for (const s of single) {
    const key = s.folder == null ? '∅(NULL/미분류)' : `"${s.folder}"`;
    singleFolderDist[key] = (singleFolderDist[key] || 0) + 1;
  }

  // (3) 옵션A UPDATE 대상: 단독약 세트 중 folder IS DISTINCT FROM '약'
  const optAtargets = single.filter((s) => s.folder !== '약');
  const alreadyDrugFolder = single.filter((s) => s.folder === '약');

  // (4) NAMEDESC 적용 상태: 단독약 세트 items[0].name === name?
  const namedescDone = single.filter(
    (s) => norm(s.items?.[0]?.name) === norm(s.name)
  );
  const namedescPending = single.filter(
    (s) => norm(s.items?.[0]?.name) !== norm(s.name)
  );

  // (5) quick_rx_buttons 참조 점검
  let qrxInfo = 'N/A';
  try {
    const { data: qrx, error: qErr } = await sb
      .from('quick_rx_buttons')
      .select('id, name, prescription_set_id')
      .limit(1000);
    if (qErr) {
      qrxInfo = `(조회 실패: ${qErr.message})`;
    } else {
      const single = sets.filter((s) => arrLen(s.items) === 1);
      const singleIds = new Set(single.map((s) => s.id));
      const refToSingle = qrx.filter((q) => singleIds.has(q.prescription_set_id)).length;
      qrxInfo = `rows=${qrx.length}, prescription_set_id 참조(FK ON DELETE CASCADE), 단독약세트참조=${refToSingle}건 (옵션A=id불변→보존 / 옵션B=해체시 CASCADE삭제)`;
    }
  } catch (e) {
    qrxInfo = `(예외: ${e.message})`;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('T-20260614-foot-RXSET-BUNDLE-MERGE — AC-1 선행 감사 (READ-ONLY)');
  console.log('실행시각:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('[1] items 길이 분포');
  console.log(`    total prescription_sets = ${total}`);
  console.log(`    단독약(items=1)          = ${single.length}  ← 옵션A 그룹핑 후보`);
  console.log(`    다종 묶음(items>1)       = ${multi.length}  ← 묶음처방 탭 유지 (대표원장 직접생성)`);
  console.log(`    빈(items=0)              = ${zero.length}`);
  console.log('');
  console.log('[2] folder 값 분포 (전체)');
  for (const [k, v] of Object.entries(folderDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(22)} : ${v}`);
  }
  console.log('');
  console.log('[2b] folder 값 분포 (단독약 only)');
  for (const [k, v] of Object.entries(singleFolderDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(22)} : ${v}`);
  }
  console.log('');
  console.log("[3] 옵션A UPDATE 영향 범위 (folder='약' 백필)");
  console.log(`    UPDATE 대상 (단독약 & folder≠'약') = ${optAtargets.length}`);
  console.log(`    이미 folder='약' (no-op)          = ${alreadyDrugFolder.length}`);
  console.log('');
  console.log('[4] NAMEDESC 적용 상태 (같은 테이블 충돌 조율)');
  console.log(`    단독약 中 items[0].name == name (이관완료) = ${namedescDone.length}`);
  console.log(`    단독약 中 items[0].name != name (미이관)   = ${namedescPending.length}`);
  console.log(
    namedescPending.length === 0
      ? '    → NAMEDESC 마이그 이미 적용된 것으로 보임 (충돌 위험 낮음)'
      : '    → NAMEDESC 미적용 추정. NAMEDESC 게이트 통과 후 진행 권장.'
  );
  console.log('');
  console.log('[5] quick_rx_buttons 참조 무결성 (옵션A=set id 불변→보존 기대)');
  console.log(`    ${qrxInfo}`);
  console.log('');
  console.log('─── 단독약 세트 샘플 (최대 10건) ───');
  single.slice(0, 10).forEach((s, i) => {
    console.log(
      `  ${i + 1}. id=${s.id} active=${s.is_active} name="${s.name}" folder=${
        s.folder == null ? 'NULL' : `"${s.folder}"`
      } item0.name="${s.items?.[0]?.name ?? ''}"`
    );
  });
  console.log('');
  console.log('─── 다종 묶음 세트 목록 (전부) ───');
  if (multi.length === 0) {
    console.log('  (없음)');
  } else {
    multi.forEach((s, i) => {
      console.log(
        `  ${i + 1}. id=${s.id} name="${s.name}" items=${arrLen(s.items)} folder=${
          s.folder == null ? 'NULL' : `"${s.folder}"`
        }`
      );
    });
  }
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
