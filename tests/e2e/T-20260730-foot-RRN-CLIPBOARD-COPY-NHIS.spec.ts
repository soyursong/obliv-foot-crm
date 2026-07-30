/**
 * T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS — 주민번호 클립보드 복사 (건보 포털 붙여넣기)
 *
 * 이은상 팀장 2026-07-30 (G-1 현장 PASS: 보안키보드 차단 없음 → 클립보드 방식 유효).
 *
 * 배경: 2번차트는 `911216-*******` 마스킹만 표시. 공단 포털 자격조회는 주민번호(앞6/뒷7)를
 *   입력해야 하는데 CRM에서 뒷자리를 볼 방법도 복사할 방법도 없어, 데스크·코디가 펜차트 배지에서
 *   눈으로 읽고 13자리 수기 타이핑하는 더 위험한 우회로로 밀려났다.
 *   → 화면 마스킹은 그대로 두고, 이미 세션 메모리에 있는 복호값(rrnFull)을 클립보드로만 전달하는
 *     [앞자리]/[뒷자리] 복사 버튼을 신설. 실질 노출면 축소.
 *
 * PHI 불변식(핸드오프 §5·§6): 평문 RRN 을 테스트가 DOM 으로 다루지 않고 소스 권위(SRC)로 검증.
 *
 * ★AC-4(감사 SECDEF RPC)는 G-2 DA CONSULT GO 대기 → 본 스펙은 소스 형상(RPC 호출 순서·형상)만 가드.
 *
 * 시나리오 = 핸드오프 §7 (1~9).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const COPY = fs.readFileSync(path.resolve('src/components/insurance/RrnCopyButtons.tsx'), 'utf-8');
const PANEL = fs.readFileSync(path.resolve('src/components/insurance/NhisCapturePanel.tsx'), 'utf-8');
const CHART = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');
const PERM = fs.readFileSync(path.resolve('src/lib/permissions.ts'), 'utf-8');

test.describe('§7-1: RRN_VIEW_ROLES 에 coordinator 포함 (FE↔DB union 회귀 가드)', () => {
  test('coordinator 가 RRN 조회권(STAFF_UNLOCK_ROLES)에 포함', () => {
    // RRN_VIEW_ROLES = STAFF_UNLOCK_ROLES, 그 안에 coordinator 존재 (A2 역할 복원)
    expect(PERM).toContain('export const RRN_VIEW_ROLES: UserRole[] = [...STAFF_UNLOCK_ROLES]');
    const unlockBlock = PERM.slice(
      PERM.indexOf('export const STAFF_UNLOCK_ROLES'),
      PERM.indexOf('export const STAFF_UNLOCK_ROLES') + 300,
    );
    expect(unlockBlock, 'coordinator 가 조회권에서 누락되면 코디는 복사할 값이 없음').toContain('coordinator');
  });
});

test.describe('§7-2: 복사 버튼 렌더 조건 = rrnFull truthy (없으면 DOM 부재, disabled 아님)', () => {
  test('rrnFull falsy 시 early-return null (버튼 자체 미렌더)', () => {
    expect(COPY).toContain('if (!rrnFull) return null;');
    // disabled 방식 금지 — 버튼에 disabled 속성이 없어야 함
    expect(COPY, 'disabled 방식 금지 — falsy 시 미렌더').not.toContain('disabled=');
  });
  test('양쪽 호출부 모두 rrnFull 을 컴포넌트에 전달', () => {
    // AC-1 (2번차트)
    expect(CHART).toContain('<RrnCopyButtons rrnFull={rrnFull} customerId={customer.id} customerName={customer.name} />');
    // AC-2 (건보 패널)
    expect(PANEL).toContain('<RrnCopyButtons rrnFull={rrnFull} customerId={customerId} customerName={customerName} />');
  });
});

test.describe('§7-3: 복사 버튼 화면에서 평문 RRN 렌더 0', () => {
  test('공용 컴포넌트가 rrnFull 을 화면 텍스트로 렌더하지 않음', () => {
    // JSX 텍스트 노드로 rrnFull/복사값을 출력하는 패턴 부재
    expect(COPY).not.toMatch(/>\s*\{?\s*rrnFull/);
    expect(COPY).not.toMatch(/>\s*\{?\s*v\s*\}/);      // 복사값 v 를 렌더하지 않음
    // 라벨은 '앞자리'/'뒷자리' 고정 — 자릿수 노출 금지
    expect(COPY).toContain('앞자리');
    expect(COPY).toContain('뒷자리');
  });
  test('건보 패널이 rrnFull 을 화면에 렌더하지 않음', () => {
    expect(PANEL).not.toMatch(/>\s*\{?\s*rrnFull/);
  });
});

test.describe('§7-4: 마스킹 표시 -******* 불변 (마스킹 무접촉)', () => {
  test('2번차트 마스킹 span 원형 보존', () => {
    expect(CHART).toContain("{rrnMasked === undefined ? '...' : (rrnMasked ?? '미입력')}");
    // 마스킹 해제(rrnFull 을 마스킹 자리에 렌더) 금지
    expect(CHART).not.toContain("{rrnMasked === undefined ? '...' : (rrnFull");
  });
});

test.describe('§7-5: 묵음 회귀 가드 — toast.success 부재 / toast.confirm 존재', () => {
  test('공용 핸들러가 toast.confirm 사용, toast.success/info 부재', () => {
    expect(COPY).toContain('toast.confirm(');
    expect(COPY, 'toast.success 는 묵음 → 피드백 0').not.toContain('toast.success(');
    expect(COPY).not.toContain('toast.info(');
    // 토스트에 값 미포함 — 고정 문구
    expect(COPY).toContain('주민번호 앞자리가 복사되었습니다');
    expect(COPY).toContain('주민번호 뒷자리가 복사되었습니다');
  });
});

test.describe('§7-6: gesture 순서 가드 — clipboard.writeText 가 rpc( 보다 먼저', () => {
  test('핸들러에서 writeText 가 supabase.rpc 앞에 등장', () => {
    const iWrite = COPY.indexOf('navigator.clipboard.writeText(');
    const iRpc = COPY.indexOf("supabase.rpc('log_rrn_clipboard_copy'");
    expect(iWrite, 'clipboard.writeText 누락').toBeGreaterThan(-1);
    expect(iRpc, '감사 RPC 호출 누락').toBeGreaterThan(-1);
    expect(iWrite, 'writeText 는 감사 RPC await 보다 반드시 먼저(user gesture 소실 방지)').toBeLessThan(iRpc);
    // RPC 는 fire-and-forget(void, 미await)
    expect(COPY).toContain("void supabase.rpc('log_rrn_clipboard_copy', { p_customer_id: customerId })");
  });
});

test.describe('§7-7: 클립보드 실패 경로에 평문 폴백(prompt/alert) 부재', () => {
  test('catch 블록이 toast.error 만 — prompt/alert/execCommand 폴백 금지', () => {
    expect(COPY).toContain("toast.error('복사에 실패했습니다");
    expect(COPY).not.toContain('prompt(');
    expect(COPY).not.toContain('alert(');
    expect(COPY).not.toContain('execCommand');
    expect(COPY).not.toContain('.select()');
  });
});

test.describe('§7-8: 감사 RPC 형상 = 형제 log_nhis_eligibility_lookup 과 동일(역할 게이트 부재)', () => {
  // AC-4 SQL 자체는 G-2 대기 → 파일 존재 시에만 형상 검증. FE 호출 인자 형상은 상시 가드.
  test('FE 호출은 인자 1개(p_customer_id)만 — by/role/clinic 서버측 파생', () => {
    expect(COPY).toContain("supabase.rpc('log_rrn_clipboard_copy', { p_customer_id: customerId })");
    // FE 에서 역할/clinic 을 인자로 넘기지 않음(anti-IDOR 서버 파생)
    expect(COPY).not.toMatch(/log_rrn_clipboard_copy',\s*\{[^}]*role/);
    expect(COPY).not.toMatch(/log_rrn_clipboard_copy',\s*\{[^}]*clinic/);
  });
  test('AC-4 마이그 존재 시 형제와 동일 형상(SECDEF·search_path·역할게이트 부재)', () => {
    const p = path.resolve('supabase/migrations/20260730190000_foot_rrn_clipboard_copy_audit_rpc.sql');
    if (!fs.existsSync(p)) {
      test.info().annotations.push({ type: 'skip-reason', description: 'AC-4 G-2 DA CONSULT 대기 중 — 마이그 미착수' });
      return;
    }
    const SQL = fs.readFileSync(p, 'utf-8');
    expect(SQL).toContain('SECURITY DEFINER');
    expect(SQL).toContain('SET search_path = public, pg_temp');
    expect(SQL).toContain("access_type,");
    expect(SQL).toContain("'rrn_clipboard_copy'");
    // 형제와 발산 금지: 역할 게이트(current_user_role 로 분기 차단) 부재 — clinic scope 만 확인
    expect(SQL).toContain('c.clinic_id = v_clinic_id');
  });
});

test.describe('§7-9: 기존 PHI 가드 3개(§6) 파일 GREEN 전제 — 마스킹 불가침 소스 보존', () => {
  test('AC-3 신원 에코 확장 — 이름·생년월일·차트번호', () => {
    // 오조회 방어: 대상 신원 3축 에코
    expect(PANEL).toContain('data-testid="nhis-capture-identity"');
    expect(PANEL).toContain('customerBirthDate');
    expect(PANEL).toContain('customerChartNumber');
    expect(PANEL).toContain('birthLabel');
    // 버튼 title 에 대상 이름 병기(AC-3)
    expect(COPY).toContain('주민번호 앞자리 복사');
    expect(COPY).toContain('${nameLabel}');
  });
  test('기존 PHI 가드 스펙 파일 3개 실재(삭제·skip 금지)', () => {
    expect(fs.existsSync(path.resolve('tests/e2e/T-20260630-foot-RRN-GENDER-DIGIT-UNMASK.spec.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve('tests/e2e/T-20260629-foot-RRN-SAVE-NOREFLECT.spec.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve('tests/e2e/T-20260618-foot-STAFF-CHART2-RRN-NOSAVE.spec.ts'))).toBe(true);
  });
});
