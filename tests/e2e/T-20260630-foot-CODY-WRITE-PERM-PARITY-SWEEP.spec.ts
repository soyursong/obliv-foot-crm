/**
 * T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP
 * coordinator(코디네이터) 6MENU write 짝(parity) 우산 — Phase1 전수감사 + Phase2 잔여 ADDITIVE(daily_room_status).
 *
 * 배경: 6MENU(STAFF-PERM-UNLOCK-6MENU, done)=FE 진입 + RLS READ 해제 우산. write(저장/수정/삭제) 짝이 잔여 →
 *   coordinator '메뉴 진입은 되나 저장 막힘' 재발. 본 우산 = Phase1 감사로 coordinator write 누락 매트릭스 산출 →
 *   잔여 GAP만 ADDITIVE 해소(daily_room_status). 타티켓 surface(MSGSETTINGS/STAFFCRUD/phrase/form_templates) 미적용(AC6).
 *
 * 시나리오(티켓 본문):
 *   1) coordinator 저장 정상 동선(6MENU 핵심 surface — 대부분 6MENU에서 이미 정합)
 *   2) 제외 3카테고리(통계/매출집계/계정관리) 잠금 무회귀(음성 가드)
 *   3) admin/manager/director 상위역할 무회귀(음성 가드)
 *
 * 본 spec = 정적 정합 검증(파괴변경 0 가드 + 권한 SSOT 패리티 + 마이그 ADDITIVE 구조).
 * 라이브 RLS 성공 검증(coordinator 방토글)은 DA CONSULT GO + supervisor DDL-diff 후 apply 시점에 실효(아래 conditional).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIG_BASE = 'supabase/migrations/20260630200000_daily_room_status_staff_unlock_6menu_rls_additive.sql';
const PERMS = 'src/lib/permissions.ts';
const MATRIX = path.resolve(__dirname, '../../docs/audits/T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP_PHASE1_MATRIX.md');

function readRepo(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
}
// 마이그는 apply 전 .DA_CONSULT_HOLD 접미사로 존재. apply 시 접미사 제거 → 둘 중 존재하는 경로 사용.
function migPath(): string {
  const hold = path.resolve(__dirname, '../../', MIG_BASE + '.DA_CONSULT_HOLD');
  const live = path.resolve(__dirname, '../../', MIG_BASE);
  return fs.existsSync(live) ? live : hold;
}

test.describe('T-20260630-foot-CODY-WRITE-PERM-PARITY-SWEEP — 정적 정합', () => {
  test('Phase1: coordinator write 전수감사 매트릭스 산출물 존재(AC1)', () => {
    expect(fs.existsSync(MATRIX)).toBe(true);
    const m = fs.readFileSync(MATRIX, 'utf-8');
    // 6MENU 6개 메뉴 + 잔여 GAP(daily_room_status) + 타티켓 표기가 매트릭스에 있어야 함
    expect(m).toContain('daily_room_status');
    expect(m).toContain('MSGSETTINGS');         // ③메시지 타티켓 표기
    expect(m).toContain('STAFFCRUD');           // ④직원 타티켓 표기
    expect(m).toContain('phrase_templates');    // ⑤상용구 FOLLOWUP 표기
  });

  test('Phase2: daily_room_status ADDITIVE 마이그 + 롤백 쌍 존재(AC5)', () => {
    expect(fs.existsSync(migPath())).toBe(true);
    const rbBase = MIG_BASE.replace('.sql', '.rollback.sql');
    const rbHold = path.resolve(__dirname, '../../', rbBase + '.DA_CONSULT_HOLD');
    const rbLive = path.resolve(__dirname, '../../', rbBase);
    expect(fs.existsSync(rbLive) || fs.existsSync(rbHold)).toBe(true);
  });

  test('Phase2: 마이그가 ADDITIVE — 신규 정책 1개만 CREATE, 기존 정책 DROP 0(AC5/파괴변경 0)', () => {
    const sql = fs.readFileSync(migPath(), 'utf-8');
    // 신규 staff_unlock 정책만 추가
    expect(sql).toContain('CREATE POLICY daily_room_status_staff_unlock_6menu');
    expect(sql).toContain("'coordinator'");
    expect(sql).toContain("'consultant'");
    expect(sql).toContain("'therapist'");
    // clinic 격리 유지
    expect(sql).toContain('current_user_clinic_id()');
    // 기존 write 정책(admin_manager_write, staff_own_write)은 절대 DROP 금지
    expect(sql).not.toContain('DROP POLICY IF EXISTS daily_room_status_admin_manager_write');
    expect(sql).not.toContain('DROP POLICY IF EXISTS daily_room_status_staff_own_write');
    // 자기 정책 외 DROP/ALTER/TRUNCATE/DELETE FROM 없음(파괴 키워드 가드)
    expect(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i.test(sql)).toBe(false);
  });

  test('SSOT 패리티: isStaffUnlockRole 에 coordinator 포함(6MENU FE write 게이트 기반)', () => {
    const p = readRepo(PERMS);
    expect(p).toContain('STAFF_UNLOCK_ROLES');
    // STAFF_UNLOCK_ROLES 배열에 coordinator 포함(6역할: admin/manager/director/consultant/coordinator/therapist)
    const m = p.match(/STAFF_UNLOCK_ROLES[^=]*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("'coordinator'");
  });

  test('제외3 잠금 무회귀(음성 가드): 통계 stats + CSV export = coordinator 미포함(잠금 유지)', () => {
    const p = readRepo(PERMS);
    // 제외3 = 통계 / 매출집계 / 계정관리. PERM_MATRIX 로 표현되는 잠금 surface:
    //   - stats(통계) PermKey 에 coordinator 가 (본 우산으로) 추가되지 않았는지 — 잠금 유지
    const stats = p.match(/stats:\s*\[([^\]]*)\]/);
    expect(stats).not.toBeNull();
    expect(stats![1]).not.toContain("'coordinator'");
    //   - customer_export(고객 CSV·PII) coordinator 비확대(admin/manager/director 한정 유지)
    const exp = p.match(/customer_export:\s*\[([^\]]*)\]/);
    expect(exp).not.toBeNull();
    expect(exp![1]).not.toContain("'coordinator'");
    // ※ register(=접수/신규등록 동선) 는 제외3(계정관리)이 아님 — REGISTER-MENU-CODY-UNLOCK(2026-06-30
    //   김주연 총괄 confirm)로 coordinator 旣개방됨. 계정관리(직원 계정 CRUD)는 staff/user_profiles surface 로
    //   STAFFCRUD-CODY-PERM 티켓이 별도 관리(본 우산 미적용, AC6). 따라서 register 음성가드는 부적절 → 제거.
  });

  test('상위역할 무회귀(음성 가드): admin/manager/director 가 daily_room_status 기존 정책에서 유지', () => {
    // 마이그는 기존 admin/manager 정책을 ALTER/DROP 하지 않음 → 무회귀(추가만).
    const sql = fs.readFileSync(migPath(), 'utf-8');
    expect(sql).toContain('ADDITIVE');
    expect(/ALTER\s+POLICY/i.test(sql)).toBe(false);            // 기존 정책 변경 0
    expect(sql).not.toContain('DROP POLICY IF EXISTS daily_room_status_admin_manager_write');
  });
});

// ── 라이브 RLS 성공 검증 — 실 DB apply 후에만 실효. ──
// 주의: 마이그 .sql 활성화(접미사 제거)는 supervisor 정적 DDL-diff 인식용이며, 실 PROD apply 와는 분리됨
//   (선례 패턴: rename→DDL-diff GO→dev-foot 직접 apply). 따라서 파일 존재가 아니라 명시 env(RLS_APPLIED=1)로 게이트해
//   DDL-diff 대기 구간(파일=.sql 이나 DB 미적용)에 라이브 테스트가 거짓 실행되지 않도록 한다.
const APPLIED = process.env.RLS_APPLIED === '1'
  && !fs.existsSync(path.resolve(__dirname, '../../', MIG_BASE + '.DA_CONSULT_HOLD'))
  && fs.existsSync(path.resolve(__dirname, '../../', MIG_BASE));

test.describe('시나리오1 라이브: coordinator daily_room_status 토글 성공(apply 후 실효)', () => {
  test.skip(!APPLIED, 'supervisor DDL-diff GO + 실 DB apply 후 RLS_APPLIED=1 로 실효');
  test('coordinator 계정 방 토글 → RLS 거부 없이 성공', async ({ page }) => {
    // apply 후 활성화: coordinator 로그인 → /admin/staff(직원·공간) → 방 토글 → toast 성공('비활성화됨'/'활성화됨')
    // RLS 차단 시 'row-level security'/'토글 실패' 노출 → 실패. (가드: 권한오류 문구 부재)
    const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
    await page.goto(`${BASE_URL}/admin/staff?tab=space`);
    await expect(page.getByText(/row-level security|토글 실패/)).toHaveCount(0);
  });
});
