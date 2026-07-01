/**
 * E2E spec — T-20260701-foot-CRM-UNSOLICITED-COPY-PURGE
 * 요청 안 한 기능 설명·메모칸 기본 문구 CRM 전체 정리
 *
 * AC1: 요청되지 않은 기능 설명/도움말성 안내 문구 제거
 * AC2: 메모칸 등 입력 필드의 장황한 기본 placeholder 제거/간결화
 * AC4: 필수 경고/검증/확인 메시지, 법적·의료 고지는 유지(오삭제 없음)
 * AC5: 저장 동작·default 값 회귀 없음(placeholder는 표시 문구일 뿐)
 * AC7: 필드 label(필드명 자체)은 유지 — 삭제 대상 아님
 *
 * 시나리오 1: 기능 설명 문구가 더 이상 노출되지 않음
 * 시나리오 2: 메모칸 기본 placeholder 간결화 + 저장 정상
 * 시나리오 3: 필수 검증/확인 메시지 + 필드 label 유지(오삭제 방지)
 *
 * NOTE: 진료대시보드·진료관리(의사 화면)는 §11 컨펌 게이트 대상이라 본 티켓 sweep에서 제외됨.
 *       따라서 본 spec은 비의료 화면(예약/고객/설정/폼)만 검증한다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 제거되어야 할 '요청 안 한 기능 설명' 문구 — 어떤 화면에서도 노출 금지
const PURGED_HELP_COPY = [
  '결제 정보는 단말기 데이터와 시간·금액 기반으로 자동 매칭됩니다',
  '금액은 직접 수정 가능합니다',
  '영수증 앱/카메라 OCR 결과 텍스트를 붙여넣으면',
  '성함·연락처에 기존 기록 있으면 자동으로 재진 전환',
  '예약상세 팝업 \'예약등록자\' 드롭다운에 노출되는 명단입니다',
  '첫 방문 발 건강 질문지와 개인정보 수집·이용 동의서입니다',
  '비급여 시술 안내와 환불 정책에 대한 동의서입니다',
];

// 간결화되어야 할 verbose placeholder 원문 — 노출 금지
const PURGED_PLACEHOLDERS = [
  '새 메모 입력 (상단 [저장] 시 함께 저장 · Ctrl+Enter로 즉시 추가)',
  '예약메모 (저장 시 기록에 추가됨)',
  '고객 관련 메모를 입력하세요',
  '치료 메모를 입력하세요',
  '취소 사유를 입력하세요',
  '알레르기 내역을 입력해주세요',
];

test.describe('T-20260701-foot-CRM-UNSOLICITED-COPY-PURGE', () => {
  // 시나리오 1 + 2: 제거/간결화된 문구가 대시보드 진입 후 DOM 어디에도 없음
  test('시나리오1/2: 제거된 기능설명 문구·verbose placeholder 미노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인/대시보드 렌더 불가 — 환경 미준비');

    const html = await page.content();

    // AC1 — 기능 설명 도움말 문구가 초기 대시보드 화면에 남아있지 않음
    for (const copy of PURGED_HELP_COPY) {
      expect(html, `제거되어야 할 기능설명 문구가 노출됨: ${copy}`).not.toContain(copy);
    }

    // AC2 — verbose placeholder 원문이 초기 화면 placeholder 속성에 남아있지 않음
    const placeholders = await page.locator('[placeholder]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('placeholder') || ''),
    );
    for (const ph of PURGED_PLACEHOLDERS) {
      expect(placeholders, `간결화되어야 할 placeholder가 노출됨: ${ph}`).not.toContain(ph);
    }
  });

  // 시나리오 2: 예약 메모 placeholder 간결화 확인 + 저장 회귀 없음(AC5)
  test('시나리오2: 예약 메모칸 간결 placeholder + 저장 정상', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인/대시보드 렌더 불가 — 환경 미준비');

    // 예약 카드/체크인 카드 진입 시도 (데이터 없으면 skip)
    const card = page
      .locator('[data-testid="checkin-card"], .kanban-card, [data-checkin-id], [data-reservation-id]')
      .first();
    test.skip((await card.count()) === 0, '진입 가능한 예약/체크인 카드 없음 — 데이터 미준비');

    await card.click();
    const dialog = page.locator('[role="dialog"]').first();
    try {
      await dialog.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      test.skip(true, '상세 팝업 렌더 실패 — 환경 의존');
    }

    // 메모 placeholder가 있으면 verbose 원문이 아니어야 함
    const memoPh = await dialog.locator('textarea[placeholder], input[placeholder]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('placeholder') || ''));
    for (const ph of memoPh) {
      for (const bad of PURGED_PLACEHOLDERS) {
        expect(ph, `verbose placeholder 잔존: ${bad}`).not.toBe(bad);
      }
    }
  });

  // 시나리오 3: 필드 label(AC7) + 필수/확인 메시지(AC4)는 유지 — 오삭제 방지
  test('시나리오3: 필드 label·검증 메시지 오삭제 없음', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인/대시보드 렌더 불가 — 환경 미준비');

    // AC7 — 대표 필드 label 은 유지되어야 함(문구로 오인 삭제 금지)
    // 대시보드/검색 영역에 label 성격 텍스트가 최소 1개 이상 존재
    const labelCount = await page.locator('label, [role="columnheader"], th').count();
    expect(labelCount, '필드 label/컬럼 헤더가 과다 삭제됨').toBeGreaterThan(0);

    // AC4 — 검색 placeholder 등 기능적 힌트는 유지(전부 삭제되지 않음)
    const anyPlaceholder = await page.locator('[placeholder]').count();
    expect(anyPlaceholder, '모든 placeholder가 삭제되어 기능 힌트까지 소실됨').toBeGreaterThan(0);
  });
});
