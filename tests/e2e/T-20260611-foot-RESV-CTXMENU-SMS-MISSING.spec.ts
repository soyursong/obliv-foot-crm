import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-RESV-CTXMENU-SMS-MISSING — 예약관리 우클릭 메뉴 "문자" 항목 누락 복원
 * 원천: 김주연 총괄 MSG-20260611-155538-limm (#project-doai-crm-풋확장).
 * 선행 CANONICAL(deployed fbb843b) 의 5항목 strict 통일 AC 中 '문자'가 예약관리 surface 에서 누락된
 * 잔여 결함 → AC 완성 fix(재정의 아님). 정본 = Dashboard.tsx 의 동일 SendSmsDialog/canAccess 패턴 미러.
 *
 * canonical 5항목·고정순서: 고객차트 → 진료차트 → 예약상세 → 수납 → 문자
 *   예약관리(Reservations.tsx) CustomerQuickMenu 에 onSendSms prop + SendSmsDialog/canAccess 배선.
 *   '문자' 항목은 canAccess('manual_sms_send') 권한 보유 role(admin/manager) 한정 노출(미허용 시 prop 미전달 → 숨김).
 *
 * 거대-인라인 페이지(Reservations/Dashboard) 관례 = source-integrity gating(소스 정적 단언).
 * 실 브라우저 동작은 supervisor field-soak 로 닫음. DB 무관(FE-only, db_change=false).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const DASH_PAGE = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 예약관리 CustomerQuickMenu 에 '문자' 항목 노출(onSendSms prop 배선)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 예약관리 우클릭 메뉴 문자 항목 배선', () => {
  test('AC1-1: SendSmsDialog / canAccess import 존재 (CANONICAL 미러)', () => {
    expect(RESV_PAGE, "SendSmsDialog import 누락")
      .toContain("import SendSmsDialog from '@/components/SendSmsDialog'");
    expect(RESV_PAGE, "canAccess import 누락")
      .toContain("import { canAccess } from '@/lib/permissions'");
  });

  test('AC1-2: smsTarget 상태 + setSmsTarget 정의 존재', () => {
    expect(RESV_PAGE)
      .toContain('const [smsTarget, setSmsTarget] = useState<CheckIn | null>(null)');
  });

  test('AC1-3: CustomerQuickMenu 에 onSendSms prop 배선 존재', () => {
    expect(RESV_PAGE, "예약관리 메뉴 onSendSms prop 미배선 → 문자 항목 숨김")
      .toContain('onSendSms={');
    // 클릭 시 메뉴 닫고 smsTarget 세팅(Dashboard 타임라인 패턴과 동일)
    expect(RESV_PAGE).toContain('setResvContextMenu(null); setSmsTarget(ci);');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — '문자' 클릭 → SendSmsDialog 가 해당 고객(checkIn) 대상으로 열림
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: SendSmsDialog 렌더 + 대상 바인딩', () => {
  test('AC2-1: SendSmsDialog JSX 렌더 존재 (smsTarget 바인딩)', () => {
    expect(RESV_PAGE).toContain('<SendSmsDialog');
    expect(RESV_PAGE).toContain('open={smsTarget !== null}');
    expect(RESV_PAGE).toContain('checkIn={smsTarget}');
  });

  test('AC2-2: 모달 닫기 → smsTarget null 복귀', () => {
    expect(RESV_PAGE)
      .toContain('onOpenChange={(v) => { if (!v) setSmsTarget(null); }}');
  });

  test('AC2-3: clinicId 전달 (clinic?.id)', () => {
    // SendSmsDialog 렌더 블록 내 clinicId 바인딩 존재
    const dlgBlock = RESV_PAGE.slice(
      RESV_PAGE.indexOf('<SendSmsDialog'),
      RESV_PAGE.indexOf('<SendSmsDialog') + 400,
    );
    expect(dlgBlock).toContain("clinicId={clinic?.id ?? ''}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 권한 게이트 유지: canAccess('manual_sms_send')=false → 문자 항목 미노출
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 권한 게이트(manual_sms_send) 유지', () => {
  test('AC3-1: onSendSms 가 canAccess 게이트로 조건부 전달(미허용 시 undefined)', () => {
    expect(RESV_PAGE)
      .toContain("canAccess(profile?.role ?? '', 'manual_sms_send')");
    // 게이트 false → undefined → CustomerQuickMenu 가 문자 항목 숨김
    const gateBlock = RESV_PAGE.slice(
      RESV_PAGE.indexOf("canAccess(profile?.role ?? '', 'manual_sms_send')"),
      RESV_PAGE.indexOf("canAccess(profile?.role ?? '', 'manual_sms_send')") + 160,
    );
    expect(gateBlock).toContain(': undefined');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — CANONICAL 정합: 예약관리/대시보드 양쪽 동일 패턴(문자 항목 동등)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC4: 예약관리 ↔ 대시보드 문자 항목 정합', () => {
  test('AC4-1: 두 surface 모두 동일 canAccess 게이트로 onSendSms 배선', () => {
    expect(RESV_PAGE).toContain("canAccess(profile?.role ?? '', 'manual_sms_send')");
    expect(DASH_PAGE).toContain("canAccess(profile?.role ?? '', 'manual_sms_send')");
  });

  test('AC4-2: 두 surface 모두 SendSmsDialog 렌더 존재', () => {
    expect(RESV_PAGE).toContain('<SendSmsDialog');
    expect(DASH_PAGE).toContain('<SendSmsDialog');
  });
});
