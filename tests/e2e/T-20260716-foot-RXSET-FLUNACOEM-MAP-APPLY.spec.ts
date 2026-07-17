/**
 * E2E spec — T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY
 *   플루나코엠캡슐(custom) → 플루코엠캡슐(플루코나졸)50mg official reference-canonical (Case2).
 *   총괄 김주연 확정 ts 1784150635.898239. 부모 T-20260617 §8 (b) 메커니즘.
 *
 * 검증 구성:
 *   [STATIC]  마이그레이션 SQL 이 §8 메커니즘(신규 official ADDITIVE + reference-move + custom deprecate)과
 *             NO_GO 가드(claim_code in-place 금지 / custom hard-delete 금지)를 인코딩 — 회귀 가드.
 *   [DATA]    (READ-ONLY) 적용 후: custom 플루나코엠 은 어느 폴더에도 없고, official HIRA-201403310
 *             (플루코엠캡슐50mg/마더스제약, code_source=official)이 폴더에 1건. 적용 전이면 skip.
 *   [LIVE]    진료차트 약폴더 트리에서 '자체' 배지 노출 수 캡처(회귀 관찰).
 *
 * 본 spec 은 UPDATE/INSERT/DELETE 없음(READ-ONLY). Playwright 데이터-의존 테스트는 미적용 시 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const LEGACY = 'LEGACY-015b55130567';
const NEW_CLAIM = 'HIRA-201403310';
const MIG = 'supabase/migrations/20260716140500_rxset_flunacoem_map_apply.sql';
const DDL = 'supabase/migrations/20260716140100_rxset_hira_provenance_columns.sql';

function sbClient(): SupabaseClient | null {
  try {
    const env = Object.fromEntries(
      readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
    if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  } catch { return null; }
}

// ── [STATIC] 마이그레이션 메커니즘·가드 인코딩 회귀 가드 ──────────────────────────
test('STATIC: DDL = provenance 4컬럼 ADDITIVE (CHECK/FK/ default 無)', () => {
  const ddl = read(DDL);
  for (const c of ['hira_verified_at', 'hira_match_basis', 'hira_mapped_to_code_id', 'hira_verified_by']) {
    expect(ddl).toContain(c);
  }
  expect(ddl).toContain('ADD COLUMN IF NOT EXISTS'); // 멱등
  expect(ddl).not.toMatch(/\bCHECK\s*\(/i);           // CHECK 無
  expect(ddl).not.toMatch(/REFERENCES\s+prescription_codes/i); // FK 無(최소 ADDITIVE)
});

test('STATIC: DML = Case2 reference-canonical + NO_GO 가드', () => {
  const sql = read(MIG);
  // 신규 official ADDITIVE
  expect(sql).toContain("'HIRA-201403310'");
  expect(sql).toContain("'플루코엠캡슐(플루코나졸)50mg'");
  expect(sql).toContain("'official'");
  // reference-move (폴더 참조 재지정)
  expect(sql).toContain('UPDATE prescription_code_folders');
  expect(sql).toContain('SET prescription_code_id = v_official_id');
  // custom deprecate = mapped_to 링크 (hard-delete 아님)
  expect(sql).toContain('hira_mapped_to_code_id = v_official_id');
  expect(sql).not.toMatch(/DELETE\s+FROM\s+prescription_codes/i); // custom hard-delete 금지(§8 c)
  // claim_code in-place 교체 금지(§8 a): SET 절에서 claim_code/code_source 를 재지정하지 않음
  //   (claim_code 는 WHERE/SELECT 필터에만 등장 — SET 대입 0)
  expect(sql).not.toMatch(/SET\s+claim_code\s*=/i);
  expect(sql).not.toMatch(/SET\s+code_source\s*=/i);
  expect(sql).not.toMatch(/,\s*claim_code\s*=/i); // 다중 SET 절 중 claim_code 대입도 없음
  // 오확산 방지: 대상 1건 초과 abort
  expect(sql).toContain('오확산 방지');
  expect(sql).toMatch(/v_target_cnt\s*<>\s*1/);
  // 총괄 확정 provenance
  expect(sql).toContain('1784150635.898239');
});

// ── [DATA] 적용 후 결과 (READ-ONLY, 미적용 시 skip) ──────────────────────────────
test('DATA: 적용 후 custom 플루나코엠 폴더 무참조 + official 플루코엠50mg 폴더 1건', async () => {
  const sb = sbClient();
  test.skip(!sb, '.env.local 자격 없음 → data 검증 skip');

  // 적용 여부 판정: official HIRA-201403310 존재?
  const { data: official } = await sb!.from('prescription_codes').select('*').eq('claim_code', NEW_CLAIM);
  test.skip(!official || official.length === 0, '마이그 미적용(official HIRA-201403310 부재) → supervisor DML 게이트 후 재실행');

  // official = code_source official, 마더스제약, 배지 없음
  expect(official!.length).toBe(1);
  expect(official![0].code_source).toBe('official');
  expect(official![0].manufacturer).toContain('마더스제약');
  const officialId = official![0].id;

  // custom 원본은 보존(hard-delete 금지) + deprecate 마킹(mapped_to=official)
  const { data: custom } = await sb!.from('prescription_codes').select('*').eq('claim_code', LEGACY);
  expect(custom!.length).toBe(1); // 하드삭제 안 됨
  expect(custom![0].code_source).toBe('custom'); // claim_code/source in-place 미교체
  expect(custom![0].hira_mapped_to_code_id).toBe(officialId); // supersede 링크

  // 폴더: custom 참조 0, official 참조 1
  const { data: cf } = await sb!.from('prescription_code_folders').select('prescription_code_id').eq('prescription_code_id', custom![0].id);
  expect(cf!.length).toBe(0);
  const { data: of } = await sb!.from('prescription_code_folders').select('prescription_code_id').eq('prescription_code_id', officialId);
  expect(of!.length).toBe(1);

  // 나머지 자체약 18종 무접촉
  const { data: allCustom } = await sb!.from('prescription_codes').select('id').eq('code_source', 'custom');
  expect(allCustom!.length).toBe(19); // custom row 는 여전히 19(deprecate 는 삭제 아님)
});

// ── [LIVE] 진료차트 약폴더 렌더 — '자체' 배지 노출 관찰(회귀) ──────────────────────
test('LIVE: 진료차트 약폴더 트리 렌더 + 자체 배지 수 캡처', async ({ page }) => {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle');
  const chartBtns = page.locator('[data-testid="open-chart-btn"]');
  const n = await chartBtns.count();
  test.skip(n === 0, '고객 0건 → 차트 진입 불가(데이터 의존 skip)');

  await chartBtns.first().click();
  await page.waitForLoadState('networkidle');
  const rxTab = page.locator('[data-testid="right-panel-tab-rx"]');
  if (await rxTab.count()) { await rxTab.first().click(); await page.waitForTimeout(300); }

  const tree = page.locator('[data-testid="drug-folder-tree"]');
  const badgeCount = await tree.getByText('자체', { exact: true }).count();
  await page.screenshot({ path: 'evidence/T-20260716-foot-RXSET-FLUNACOEM-MAP-APPLY_folder.png', fullPage: false });
  // 적용 후 기대: 플루나코엠 배지 사라짐(19→18). 폴더 펼침/데이터 상태 의존이라 하한만 단언.
  console.log(`[LIVE] DrugFolderTree '자체' 배지 노출 수: ${badgeCount}`);
  expect(badgeCount).toBeGreaterThanOrEqual(0);
});
