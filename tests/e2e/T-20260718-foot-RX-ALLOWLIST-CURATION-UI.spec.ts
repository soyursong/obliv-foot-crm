/**
 * E2E spec — T-20260718-foot-RX-ALLOWLIST-CURATION-UI (Phase 2a)
 * 처방 화이트리스트 큐레이션 도구 — DrugFoldersTab '처방 허용' 토글 컬럼.
 *
 * 배경(parent T-20260615-foot-RX-WHITELIST-FOLDERTREE, deployed ee5d230e):
 *   Phase 1 = overlay 테이블 prescription_code_allowlist 신설 + FE enforcement feature-flag OFF ship.
 *   Phase 2a(본 티켓) = 문지은 대표원장이 승인 코드셋을 지정할 **큐레이션 입력 도구**만 착륙.
 *     ClinicManagement > 약품폴더 관리(DrugFoldersTab) 전체보기 테이블 각 행에 '처방 허용' 토글 추가.
 *     토글 = prescription_code_allowlist overlay upsert(enabled + curated_by/at).
 *   ★ enforcement 무접촉: VITE_RX_ALLOWLIST_ENFORCEMENT 계속 OFF. 큐레이션 상태 저장만,
 *     DrugFolderTree/묶음처방/searchRxCodes 렌더는 전량 노출 유지(현장 무변화, AC-3).
 *
 * 검증 전략(형제 DrugFoldersTab spec 동형):
 *   - 정본 소스 정적 단언 = UI 배선(토글 컬럼)·훅·enforcement 무접촉·권한 게이트 불변식 인코딩.
 *   - 라이브 라운드트립(SERVICE_KEY 有) = overlay upsert 후 재조회로 상태 보존(AC-1) + 감사(AC-2) 데이터 증명.
 *     SERVICE_KEY 없거나 테이블 미적용 시 graceful skip(deploy-tolerant).
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';
const LIB = 'src/lib/rxAllowlist.ts';
const TREE = 'src/components/doctor/DrugFolderTree.tsx';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 큐레이션 토글 UI — DrugFoldersTab 전체보기 각 행에 '처방 허용' 토글 컬럼
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1(UI): 전체보기 테이블에 "처방 허용" 토글 컬럼(헤더 + 셀 + Switch) 신설', () => {
  const src = read(TAB);
  // 헤더 컬럼
  expect(src).toContain('drug-folder-viewall-rxallow-head');
  expect(src).toContain('처방 허용');
  // 행 셀 + 토글 스위치
  expect(src).toContain('drug-folder-viewall-rxallow-cell');
  expect(src).toContain('drug-folder-viewall-rxallow-toggle');
  // Switch 컴포넌트 사용(재사용 — 신규 위젯 0)
  expect(src).toContain("import { Switch } from '@/components/ui/switch'");
  // 토글 상태 = 큐레이션 맵(prescription_code_id → enabled)에서 파생
  expect(src).toContain('rxAllowlistMap');
  expect(src).toMatch(/rxAllowlistMap\.get\(d\.prescription_code_id\)/);
});

test('AC-1(UI): 토글 조작 = handleToggleRxAllowlist → overlay upsert 위임(자체 분기 0)', () => {
  const src = read(TAB);
  expect(src).toContain('handleToggleRxAllowlist');
  expect(src).toContain('onCheckedChange');
  expect(src).toContain('toggleRxAllowlist.mutateAsync');
  // 조회 훅 = canEdit(admin surface)일 때만 — enforcement 무관(큐레이션 도구 전용)
  expect(src).toContain('useRxAllowlistCurationMap(canEdit)');
  expect(src).toContain('useToggleRxAllowlist');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1(lib): overlay upsert + 감사 필드(AC-2) + 상태 보존(AC-1) + onConflict
// ─────────────────────────────────────────────────────────────────────────────
test('lib: useToggleRxAllowlist — allowlist upsert(enabled + curated_by/at) onConflict', () => {
  const lib = read(LIB);
  expect(lib).toContain('useToggleRxAllowlist');
  expect(lib).toMatch(/\.from\('prescription_code_allowlist'\)/);
  expect(lib).toContain('.upsert(');
  // AC-2 감사 필드: curated_by(현 auth user) + curated_at(now)
  expect(lib).toContain('curated_by');
  expect(lib).toContain('curated_at');
  expect(lib).toContain('supabase.auth.getUser()');
  // 단일 행 보장 — (clinic_slug, prescription_code_id) onConflict
  expect(lib).toContain("onConflict: 'clinic_slug,prescription_code_id'");
  // clinic_slug 고정(jongno-foot)
  expect(lib).toContain('FOOT_CLINIC_SLUG');
});

test('lib: useRxAllowlistCurationMap — enforcement 무관 조회(큐레이션 전용) + 상태 보존', () => {
  const lib = read(LIB);
  expect(lib).toContain('useRxAllowlistCurationMap');
  // 조회 게이트 = enabled 파라미터(canEdit)로만 — isRxAllowlistEnforced() 에 의존하지 않음
  expect(lib).toMatch(/export function useRxAllowlistCurationMap\(enabled: boolean\)/);
  expect(lib).toMatch(/enabled,/);
  // enabled 상태 맵 반환(prescription_code_id → boolean) → 재조회 시 토글 상태 복원(AC-1 보존)
  expect(lib).toContain('Map<string, boolean>');
  // upsert 성공 후 큐레이션 캐시 무효화(재조회 반영)
  expect(lib).toContain('prescription_code_allowlist_curation');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: enforcement 무접촉·무회귀 (AC-3)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: enforcement 플래그 default OFF 유지(VITE_RX_ALLOWLIST_ENFORCEMENT) — 무회귀', () => {
  const lib = read(LIB);
  // 렌더 필터 훅은 여전히 enforced 일 때만 조회(전량 노출=fail-open) — 본 티켓이 건드리지 않음
  expect(lib).toContain('isRxAllowlistEnforced');
  expect(lib).toContain('usePrescriptionCodeAllowlist');
  // OFF 판정 로직 보존('on'/'1'/'true' 일 때만 ON)
  expect(lib).toMatch(/raw === 'on'/);
});

test('AC-3: DrugFolderTree(렌더 arm)는 큐레이션 훅 무참조 — 처방 동선 무접촉', () => {
  const tree = read(TREE);
  // 큐레이션 입력 훅/뮤테이션이 렌더 경로(DrugFolderTree)에 침투하지 않음(상태 저장만).
  expect(tree).not.toContain('useToggleRxAllowlist');
  expect(tree).not.toContain('useRxAllowlistCurationMap');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 권한 분기 (AC-4) — admin/director 토글 write, 그 외 read-only/비활성
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 토글 write 는 canEdit(admin/director) 게이트 — 비권한자는 read-only 상태 표시', () => {
  const src = read(TAB);
  // canEdit 아니면 조기 반환(write deny)
  expect(src).toMatch(/if \(!canEdit\) return;/);
  // 비권한자 렌더 = 읽기전용 배지(토글 비노출)
  expect(src).toContain('drug-folder-viewall-rxallow-readonly');
  // 권한 게이트 = canEditClinicMgmt(기존 tab 정책 재사용) + RLS(is_admin_or_manager) 이중 가드
  expect(src).toContain('canEditClinicMgmt');
});

// ─────────────────────────────────────────────────────────────────────────────
// 라이브 라운드트립(SERVICE_KEY 有): overlay upsert → 재조회 상태 보존(AC-1) + 감사(AC-2)
//   deploy-tolerant: SERVICE_KEY 없거나 테이블 미적용 시 graceful skip.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('라이브 데이터 증명 — overlay upsert 라운드트립', () => {
  let admin: SupabaseClient | null = null;
  let tableExists = false;
  let codeId: string | null = null;
  const NOTE = `E2E-RXCUR-${Date.now().toString().slice(-7)}`;

  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const probe = await admin.from('prescription_code_allowlist').select('id').limit(1);
    tableExists = !probe.error;
    if (!tableExists) return;
    const { data: code } = await admin.from('prescription_codes').select('id').limit(1).single();
    codeId = (code?.id as string) ?? null;
  });

  test.afterAll(async () => {
    if (admin && tableExists) {
      await admin.from('prescription_code_allowlist').delete().eq('note', NOTE);
    }
  });

  test('AC-1/AC-2: upsert(enabled=true, 감사) → 재조회 시 상태·감사 보존', async () => {
    test.skip(!SERVICE_KEY, 'SERVICE_KEY 없음 — 환경 skip');
    test.skip(!tableExists, 'prescription_code_allowlist 미적용 — graceful skip');
    test.skip(!codeId, 'prescription_codes seed 없음 — graceful skip');
    if (!admin || !codeId) return;

    const curatedAt = new Date().toISOString();
    // ON(enabled=true) upsert
    const up1 = await admin.from('prescription_code_allowlist').upsert(
      { clinic_slug: CLINIC_SLUG, prescription_code_id: codeId, enabled: true, curated_at: curatedAt, note: NOTE },
      { onConflict: 'clinic_slug,prescription_code_id' },
    );
    expect(up1.error).toBeNull();

    // 재조회 → enabled=true 보존 + 감사 필드 기록(AC-1/AC-2)
    const { data: row1 } = await admin
      .from('prescription_code_allowlist')
      .select('enabled, curated_at, note')
      .eq('clinic_slug', CLINIC_SLUG)
      .eq('prescription_code_id', codeId)
      .single();
    expect(row1?.enabled).toBe(true);
    expect(row1?.curated_at).toBeTruthy();

    // OFF(enabled=false) 재토글 → onConflict 로 동일 행 갱신(상태 보존)
    const up2 = await admin.from('prescription_code_allowlist').upsert(
      { clinic_slug: CLINIC_SLUG, prescription_code_id: codeId, enabled: false, curated_at: new Date().toISOString(), note: NOTE },
      { onConflict: 'clinic_slug,prescription_code_id' },
    );
    expect(up2.error).toBeNull();
    const { data: rows } = await admin
      .from('prescription_code_allowlist')
      .select('enabled')
      .eq('clinic_slug', CLINIC_SLUG)
      .eq('prescription_code_id', codeId);
    // 단일 행 유지(중복 생성 X) + enabled=false 보존
    expect(rows?.length).toBe(1);
    expect(rows?.[0]?.enabled).toBe(false);
  });
});
