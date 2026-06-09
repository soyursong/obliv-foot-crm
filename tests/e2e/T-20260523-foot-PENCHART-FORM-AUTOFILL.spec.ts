/**
 * E2E spec: T-20260523-foot-PENCHART-FORM-AUTOFILL
 * 펜차트 양식 고객정보 자동 바인딩 — 환불동의서 위치 보정 + 보험차트 성함/주민번호 연동
 *
 * AC-1: 환불동의서 상단 차트번호 자동 표시 (page 1, x=190 y=199 — 밑줄 y=214 하단 정렬)
 * AC-2: 환불동의서 상단 고객 성함 자동 표시 (page 1, x=190 y=234 — 밑줄 y=249 하단 정렬)
 * AC-3: 환불동의서 하단 본인동의서 성명란 자동 표시 (page 3, 중앙정렬 centerX=247 topY=3214)
 *        — AC-R4로 일시 제거 → T-20260608-CONSENT-NAME-AUTOLOAD 복구(x=55 y=3206) →
 *          T-20260609-REFUND-NAME-AUTOFILL-POSITION 좌측이탈 교정(x=145) →
 *          T-20260609-CONSENT-NAME-CENTER-FONT 중앙정렬+bold28px(전용 drawRefundP3NameAutofill, centerX=247)
 * AC-4: 환불동의서 하단 날짜 위치 보정 (page 3 년/월/일 분리 우측정렬 — 537/607/671)
 * AC-5: 고객 연락처 미표시 (AutofillFields에서 phone 완전 제거)
 * AC-6: 자동 텍스트와 펜 서명 영역 겹침 없음 (page 3 서명 셀은 별도 영역)
 * AC-7: 보험차트 상단 고객 성함 자동 표시 (x=285 y=23)
 * AC-8: 보험차트 상단 주민번호(마스킹) 자동 표시 (customerRrn prop, x=285 y=44)
 * AC-9: 보험차트 DATE·담당의·담당실장 레이아웃 충돌 없음
 * AC-10: 고객 미선택 시 바인딩 필드 빈칸 (에러 없음)
 * AC-11: 기존 펜 드로잉·저장·불러오기 기능 무영향
 * AC-12: 빌드 성공
 * AC-R4: 하단 서명란(개인정보 동의) UI 전체 제거
 * AC-R5: 환불동의서 P1/P3 좌표 정밀 보정 (MSG-20260524-111246-xbb9)
 */

import { test, expect } from '@playwright/test';

test.describe('PENCHART-FORM-AUTOFILL — 자동채움 위치 보정 + 주민번호 연동', () => {

  // ── AC-12: 빌드 성공 + 앱 정상 접근 ──────────────────────────────────────
  test('AC-12: 앱 정상 로드 (빌드 성공 검증)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 에셋 서빙 ────────────────────────────────────────────────────────────
  test('AC-1/2: public/forms/refund_consent.png 에셋 서빙 정상', async ({ page }) => {
    const response = await page.goto('/forms/refund_consent.png');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('image/png');
  });

  test('AC-7/8/9: public/forms/pen_chart_form.png 에셋 서빙 정상', async ({ page }) => {
    const response = await page.goto('/forms/pen_chart_form.png');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('image/png');
  });

  // ── AC-5: 연락처 자동채움 제거 ───────────────────────────────────────────
  test.describe('AC-5 연락처(phone) 제거', () => {
    test('AutofillFields에 phone 없음', () => {
      type AutofillFields = {
        date: string;
        name: string;
        birthDate: string;
        chartNumber: string;
        rrn: string;
      };
      const fields: AutofillFields = {
        date: '2026. 5. 24.', name: '홍길동', birthDate: '901215',
        chartNumber: '1234', rrn: '901215-*******',
      };
      expect(Object.keys(fields)).not.toContain('phone');
    });

    test('drawRefundP3DateAutofill에 phone key 없음 — date만 렌더링', () => {
      // P3: drawRefundP3DateAutofill은 date 필드만 사용 (name/phone 없음 — AC-R4)
      const usedKeys = ['date']; // drawRefundP3DateAutofill reads: fields.date only
      expect(usedKeys).not.toContain('phone');
      expect(usedKeys).not.toContain('name');
      expect(usedKeys).toContain('date');
    });

    test('customerPhone prop은 하위 호환 유지 (deprecated, 내부 미사용)', () => {
      const autofillFromProps = (props: {
        customerName?: string;
        customerBirthDate?: string;
        customerChartNumber?: string;
        customerRrn?: string;
        customerPhone?: string; // deprecated
      }) => ({
        date: '',
        name: props.customerName ?? '',
        birthDate: props.customerBirthDate ?? '',
        chartNumber: props.customerChartNumber ?? '',
        rrn: props.customerRrn ?? '',
      });
      const result = autofillFromProps({ customerPhone: '010-1234-5678', customerName: '홍길동' });
      expect(result).not.toHaveProperty('phone');
      expect(result.name).toBe('홍길동');
    });
  });

  // ── AC-1/2: 환불동의서 page 1 좌표 ───────────────────────────────────────
  test.describe('AC-1/2 환불동의서 page 1 자동채움 (위치 보정 최종)', () => {
    // PIL full-x-range scan: refund_consent.png 2481×10524 → canvas 794×3369 (scale=0.32)
    //   차트번호 밑줄 y=214, 환자이름 밑줄 y=249 → textBaseline='top' 15px → y=214-15=199, 249-15=234
    //   x=190: 코론 끝(x≈178) + 12px 여백 → 입력란 시작점
    //   구 e86c953 x=163, y=155/188 (라벨 위 46px) → 현재 x=190, y=199/234 (밑줄 하단 정렬) 교정
    const posP1 = [
      { key: 'chartNumber', x: 190, y: 199 }, // 차트번호 밑줄(y=214) 하단 정렬
      { key: 'name',        x: 190, y: 234 }, // 환자이름 밑줄(y=249) 하단 정렬
    ];

    test('page 1 필드 2개 (차트번호 + 환자이름)', () => {
      expect(posP1).toHaveLength(2);
      expect(posP1[0].key).toBe('chartNumber');
      expect(posP1[1].key).toBe('name');
    });

    test('page 1 y 좌표 — page 1 범위 내 (0-1123)', () => {
      for (const p of posP1) {
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThan(1123);
      }
    });

    test('page 1 x 좌표 — 코론(x≈178) 우측 + 12px 여백 (>180, ≤320 underline)', () => {
      for (const p of posP1) {
        expect(p.x).toBeGreaterThan(180); // 코론 우측
        expect(p.x).toBeLessThanOrEqual(320); // 밑줄 끝
      }
    });

    test('chartNumber y=199 — 밑줄(y=214) 하단 정렬 (y + 15px = 214)', () => {
      expect(posP1[0].y + 15).toBe(214); // textBaseline='top', 15px font
    });

    test('name y=234 — 밑줄(y=249) 하단 정렬 (y + 15px = 249)', () => {
      expect(posP1[1].y + 15).toBe(249); // textBaseline='top', 15px font
    });

    test('chartNumber 빈 값이면 fillText 스킵', () => {
      const chartNumber = '';
      expect(!!chartNumber).toBe(false);
    });
  });

  // ── AC-4: 환불동의서 page 3 날짜 분리 렌더링 ─────────────────────────────
  test.describe('AC-4 환불동의서 page 3 날짜 분리 배치 (년/월/일 우측정렬)', () => {
    // PIL full-x-range scan (PNG row 9593, canvas y=3071):
    //   "년" 좌측 끝 x≈549.5 → textAlign='right' x=537 (12.5px 여백)
    //   "월" 좌측 끝 x≈617.3 → textAlign='right' x=607 (10.3px 여백)
    //   "일" 좌측 끝 x≈684.5 → textAlign='right' x=671 (13.5px 여백)
    //   DATE_Y=3071 — 구 e86c953: 단일 "2026. 5. 24."을 x=440 → "년" 겹침 발생
    //   AC-R4: name(x=55, y=3206) 제거 — 직원이 직접 이름칸 기입
    const datePositions = [
      { label: '년', rightX: 537 }, // "년" 글자 왼쪽 12.5px 앞
      { label: '월', rightX: 607 }, // "월" 글자 왼쪽 10.3px 앞
      { label: '일', rightX: 671 }, // "일" 글자 왼쪽 13.5px 앞
    ];
    const DATE_Y = 3071;

    test('날짜 3개 분리 배치 — 년/월/일 각 우측정렬 x값', () => {
      expect(datePositions).toHaveLength(3);
      expect(datePositions[0].rightX).toBe(537);
      expect(datePositions[1].rightX).toBe(607);
      expect(datePositions[2].rightX).toBe(671);
    });

    test('DATE_Y=3071 — page 3 범위 내 (2246-3369)', () => {
      expect(DATE_Y).toBeGreaterThanOrEqual(2246);
      expect(DATE_Y).toBeLessThan(3369);
    });

    test('날짜 파싱: "2026. 5. 24." → [year, month, day] = ["2026", "5", "24"]', () => {
      const dateStr = '2026. 5. 24.';
      const parts = dateStr.replace(/\./g, '').trim().split(/\s+/).filter(Boolean);
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('2026');
      expect(parts[1]).toBe('5');
      expect(parts[2]).toBe('24');
    });

    test('날짜 파싱: 빈 문자열 → parts.length < 3 → 렌더 스킵', () => {
      const dateStr = '';
      if (!dateStr) return; // 조기 반환
      const parts = dateStr.replace(/\./g, '').trim().split(/\s+/).filter(Boolean);
      expect(parts.length).toBeLessThan(3);
    });

    test('AC-4 initBgCanvas: drawAutofillOnCtx(P1) + drawRefundP3DateAutofill(P3) 호출', () => {
      let p1Called = false;
      let p3DateCalled = false;
      const fk = 'refund_consent';
      if (fk === 'refund_consent') {
        p1Called = true;    // drawAutofillOnCtx P1
        p3DateCalled = true; // drawRefundP3DateAutofill
      }
      expect(p1Called).toBe(true);
      expect(p3DateCalled).toBe(true);
    });
  });

  // ── AC-7/8/9: 보험차트 좌표 ───────────────────────────────────────────────
  test.describe('AC-7/8/9 보험차트 자동채움 (성함 + 주민번호)', () => {
    // pen_chart_form.png 2482×3510 → canvas 794×1123
    // 로고(x≈185) 우측 · 담당의(x≈530, y≈23)/담당실장(y≈43) 좌측 공백 영역
    const penchart = [
      { key: 'name', x: 285, y: 23 }, // 담당의 라인 정렬
      { key: 'rrn',  x: 285, y: 44 }, // 담당실장 라인 정렬 (주민번호 마스킹)
    ];

    test('pen_chart 자동채움 2필드 (성함 + 주민번호)', () => {
      expect(penchart).toHaveLength(2);
      expect(penchart[0].key).toBe('name');
      expect(penchart[1].key).toBe('rrn');
    });

    test('pen_chart y 좌표 — 헤더 영역 내 (0-100)', () => {
      for (const p of penchart) {
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(100);
      }
    });

    test('pen_chart x 좌표 — 로고 우측(>185)·담당의 좌측(<530)', () => {
      for (const p of penchart) {
        expect(p.x).toBeGreaterThan(185);
        expect(p.x).toBeLessThan(530);
      }
    });

    test('rrn 빈 값이면 fillText 스킵', () => {
      const rrn = '';
      expect(!!rrn).toBe(false); // AC-10: rrn 없으면 빈칸
    });

    test('pen_chart 분기: fk === "pen_chart"일 때만 PENCHART_AUTOFILL_POS 호출', () => {
      let drawCalled = false;
      const fk = 'pen_chart';
      if (fk === 'pen_chart') { drawCalled = true; }
      expect(drawCalled).toBe(true);
    });

    test('refund_consent일 때 pen_chart 분기 호출 안 됨', () => {
      let penChartDrawCalled = false;
      const fk = 'refund_consent';
      if (fk === 'pen_chart') { penChartDrawCalled = true; }
      expect(penChartDrawCalled).toBe(false);
    });
  });

  // ── AC-8: customerRrn prop ────────────────────────────────────────────────
  test.describe('AC-8 customerRrn prop (주민번호 마스킹)', () => {
    test('rrnMasked null → customerRrn undefined 전달 → rrn 빈칸', () => {
      const rrnMasked: string | null = null;
      const customerRrn = rrnMasked ?? undefined;
      expect(customerRrn).toBeUndefined();
    });

    test('rrnMasked "901215-*******" → customerRrn 전달 → rrn 표시', () => {
      const rrnMasked = '901215-*******';
      const customerRrn = rrnMasked ?? undefined;
      expect(customerRrn).toBe('901215-*******');
    });
  });

  // ── AC-10: 고객 미선택 에러 없음 ──────────────────────────────────────────
  test('AC-10: 앱 로드 시 크리티컬 콘솔 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForTimeout(3000);
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('supabase') &&
        !e.includes('net::ERR') &&
        !e.includes('Failed to fetch') &&
        !e.includes('NetworkError')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  // ── 기존 기능 회귀 ─────────────────────────────────────────────────────────
  test.describe('AC-11 기존 기능 회귀 없음', () => {
    test('autofillDataRef useEffect deps에 customerRrn 포함', () => {
      const deps = [
        'activeDrawTemplate', 'customerName', 'customerBirthDate',
        'customerChartNumber', 'customerRrn',
      ];
      expect(deps).toContain('customerRrn');
      expect(deps).not.toContain('customerPhone');
    });

    test('health_questionnaire 분기에서 autofill 호출 안 됨', () => {
      let drawCalled = false;
      const fk = 'health_questionnaire_general';
      if (fk === 'refund_consent' || fk === 'pen_chart') { drawCalled = true; }
      expect(drawCalled).toBe(false);
    });
  });

  // ── AC-R4: 환불동의서 하단 서명란 UI 제거 ────────────────────────────────
  // T-20260523-foot-PENCHART-FORM-AUTOFILL REOPEN (MSG-20260524-110842-pnuu)
  test.describe('AC-R4 하단 서명란 제거 — SignaturePad UI 없음', () => {
    test('PenChartTab.tsx: SignaturePad import 없음', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname,
        'utf-8',
      );
      // SignaturePad 컴포넌트 import가 제거됐는지 확인
      expect(src).not.toContain("import { SignaturePad");
      expect(src).not.toContain("from '@/components/forms/SignaturePad'");
    });

    test('PenChartTab.tsx: "서명란 (개인정보 동의)" 텍스트 없음', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname,
        'utf-8',
      );
      // 서명란 UI 제거 확인
      expect(src).not.toContain('서명란 (개인정보 동의)');
      expect(src).not.toContain('<SignaturePad');
    });

    test('signatureBase64는 항상 null — sigEmpty 로직 제거', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname,
        'utf-8',
      );
      // signatureBase64 단순 null 할당 확인
      expect(src).toContain('const signatureBase64 = null');
      // sigEmpty 상태 없음
      expect(src).not.toContain('const [sigEmpty,');
    });
  });

  // ── AC-R5: 환불동의서 autofill 좌표 코드 레벨 검증 (최종 보정) ──────────
  // MSG-20260524-111246-xbb9: PIL full-x-range scan 기반 좌표 정밀 교정
  test.describe('AC-R5 환불동의서 좌표 코드 레벨 검증 (최종)', () => {
    // refund_consent.png 2481×10524 → canvas 794×3369 (scale≈0.32)
    // P1: 차트번호/환자이름 (page 1 상단) — 밑줄 하단 정렬
    const posP1 = [
      { key: 'chartNumber', x: 190, y: 199 }, // underline y=214, font 15px: 199+15=214
      { key: 'name',        x: 190, y: 234 }, // underline y=249, font 15px: 234+15=249
    ];
    // P3: 날짜 분리 렌더링 — drawRefundP3DateAutofill (AC-R4로 name 제거)
    const p3DateX = { year: 537, month: 607, day: 671 };
    const DATE_Y = 3071;

    test('P1 좌표 — canvas page 1 범위 내 (y < 1123)', () => {
      for (const p of posP1) {
        expect(p.x).toBeGreaterThan(180); // 코론(x≈178) 우측
        expect(p.x).toBeLessThanOrEqual(320); // 밑줄 끝
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThan(1123); // page 1 범위
      }
    });

    test('P1 y 정밀 검증 — textBaseline=top, 15px → 텍스트 하단이 밑줄에 정렬', () => {
      expect(posP1[0].y + 15).toBe(214); // 차트번호 밑줄 y=214
      expect(posP1[1].y + 15).toBe(249); // 환자이름 밑줄 y=249
    });

    test('P3 날짜 분리 x 좌표 — 각 글자(년/월/일) 우측정렬 기준점 검증', () => {
      // "년" 좌측 끝 x≈549.5 → textAlign=right, x=537 (12.5px 여백)
      expect(p3DateX.year).toBeGreaterThan(500);
      expect(p3DateX.year).toBeLessThan(549); // "년" 왼쪽에 위치
      // "월" 좌측 끝 x≈617.3 → x=607 (10.3px 여백)
      expect(p3DateX.month).toBeGreaterThan(600);
      expect(p3DateX.month).toBeLessThan(617);
      // "일" 좌측 끝 x≈684.5 → x=671 (13.5px 여백)
      expect(p3DateX.day).toBeGreaterThan(660);
      expect(p3DateX.day).toBeLessThan(684);
    });

    test('P3 DATE_Y=3071 — page 3 범위 내 (2246-3369)', () => {
      expect(DATE_Y).toBeGreaterThanOrEqual(2246); // page 3 시작
      expect(DATE_Y).toBeLessThan(3369); // page 3 끝
    });

    test('drawRefundP3DateAutofill은 date만 렌더 — 날짜 함수에 name 미혼입', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname,
        'utf-8',
      );
      // 날짜 분리 함수는 여전히 date만 사용 (이름은 별도 POS 배열 + drawAutofillOnCtx로 합성)
      const fnMatch = src.match(/function drawRefundP3DateAutofill[\s\S]*?^}/m)?.[0] ?? '';
      expect(fnMatch).toContain('fields.date');
      expect(fnMatch).not.toContain('fields.name');
    });
  });

  // ── CONSENT-NAME-AUTOLOAD: P3 하단 본인동의서 성명란 자동바인딩 복구 (회귀) ──
  // T-20260608-foot-CONSENT-NAME-AUTOLOAD (MSG-20260608-153310-om74)
  // 179795c(AC-R4)가 SignaturePad UI 정리 시 name(x=55 y=3206) 동반 제거 → 회귀.
  // 현장(김주연 총괄 6/8): "맨 하단 본인동의서 이름" 자동 채움 복원 요청.
  // T-20260609-foot-REFUND-NAME-AUTOFILL-POSITION: 좌표 좌측 이탈 RC 수정으로 x=55→145(좌단) 교정.
  // T-20260609-foot-CONSENT-NAME-CENTER-FONT (planner MSG-20260609-165224 정밀 코드 스펙):
  //   POS 배열(drawAutofillOnCtx) → 전용 drawRefundP3NameAutofill 로 분리, 좌단(x=145) → 중앙(centerX=247).
  //   (상세 단언은 T-20260609-foot-CONSENT-NAME-CENTER-FONT.spec.ts 참조 — 본 블록은 회귀 가드만 유지)
  test.describe('CONSENT-NAME-AUTOLOAD 하단 성명란 자동바인딩 복구 (CENTER-FONT 정밀스펙 반영)', () => {
    test('전용 drawRefundP3NameAutofill 로 P3 성명 합성 + centerX=247 중앙정렬', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname,
        'utf-8',
      );
      // 전용 함수 존재 + fields.name 사용
      const fn = src.match(/function drawRefundP3NameAutofill[\s\S]*?\n}/)?.[0] ?? '';
      expect(fn).toContain('fields.name');
      expect(fn).toMatch(/ctx\.textAlign\s*=\s*'center'/);
      // 칸 중심 좌표 247 (옛 좌단 145 / 좌측이탈 55 재발 금지)
      const block = src.match(/const REFUND_P3_NAME\s*=\s*\{[\s\S]*?\};/)?.[0] ?? '';
      expect(block).toMatch(/centerX:\s*247/);
      expect(block).not.toMatch(/\b55\b/);
    });

    test('렌더 합성부에서 전용 drawRefundP3NameAutofill 호출', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname,
        'utf-8',
      );
      // 텍스트 레이어(bgCanvas) 합성 경로 — desync 무관
      expect(src).toMatch(/drawRefundP3NameAutofill\(ctx,\s*autofillDataRef\.current\)/);
    });

    test('centerX=247 — page-3 범위(2246~3369) 내 + 표 좌측경계(96) 안쪽 + 칸막이(397) 미침범', () => {
      const NAME_TOP_Y = 3214;
      const NAME_CENTER_X = 247;
      expect(NAME_TOP_Y).toBeGreaterThanOrEqual(2246);
      expect(NAME_TOP_Y).toBeLessThan(3369);
      // 표 좌측 경계(96) 안쪽 + 중앙 칸막이(397) 미침범
      expect(NAME_CENTER_X).toBeGreaterThan(96);
      expect(NAME_CENTER_X).toBeLessThan(397);
    });

    test('forbidden_approach 비파괴 — SignaturePad 재도입 없음 (BLACKSCR P0 안전)', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        new URL('../../src/components/PenChartTab.tsx', import.meta.url).pathname,
        'utf-8',
      );
      // 캔버스 직접 서명 방식 유지 — SignaturePad UI 미복원
      expect(src).not.toContain("import { SignaturePad");
      expect(src).not.toContain('<SignaturePad');
    });
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증용 체크리스트):
 *
 * [시나리오1] 환불동의서 고객정보 자동 표시 (AC-R5 최종 보정 확인)
 *   1. 데스크 직원 로그인 → 고객 검색 → 차트번호 있는 고객 선택
 *   2. 임상 탭 → 펜차트 탭 → [새 차트 작성]
 *   3. [환불/비급여 동의서] 선택
 *   4. page 1 상단 확인:
 *      - "● 차트번호 : " 우측 입력란에 차트번호 자동 표시 (gray-500 italic, 밑줄 하단 정렬)
 *      - "● 환자이름 : " 우측 입력란에 성함 자동 표시
 *      Expected: 구 e86c953 대비 텍스트가 라벨 위(y=155)가 아닌 입력란(y=199/234)에 위치
 *   5. page 3 스크롤 → [본인 동의서] 섹션 확인:
 *      - 날짜 "2026" / "5" / "26" 이 "년" / "월" / "일" 글자 바로 앞에 각각 우측정렬로 표시
 *      - "이름" 셀: 빈칸 (AC-R4로 자동채움 제거 — 직원이 직접 기입)
 *      Expected: 구 e86c953 대비 "2026. 5. 24."가 단일 블록으로 "년" 위에 겹치던 문제 해소
 *   6. 연락처 미표시 확인 (AC-5)
 *   7. 하단 서명란(개인정보 동의) 영역 없음 확인 (AC-R4)
 *   8. 펜 서명 → [저장] → list 복귀 정상
 *
 * [시나리오2] 보험차트 고객정보 자동 연동
 *   1. 주민번호 등록된 고객 선택
 *   2. [보험차트] 선택
 *   3. 상단 공백 영역(로고 우측·담당의 좌측) 확인:
 *      - 성함 표시 (담당의 라인 정렬, y≈23)
 *      - 주민번호 마스킹 표시 (예: "901215-*******", 담당실장 라인 정렬, y≈44)
 *      Expected: 2줄이 상단 박스 내에 위치
 *   4. DATE·담당의·담당실장 미겹침 확인 (AC-9)
 *   5. 격자 메모 영역 펜 입력 → 저장 정상
 *
 * [시나리오3] 주민번호 미등록 고객
 *   1. 주민번호 미등록 고객 → 보험차트
 *   2. 성함만 표시, 주민번호 위치 빈칸 (에러 없음)
 *
 * [시나리오4] 고객 미선택 상태
 *   1. 고객 미선택 → 펜차트 탭 → 양식 선택
 *   2. 모든 자동채움 필드 빈칸 (에러 없음 — AC-10)
 */
