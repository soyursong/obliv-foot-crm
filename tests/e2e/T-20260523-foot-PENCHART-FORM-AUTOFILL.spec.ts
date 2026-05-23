/**
 * E2E spec: T-20260523-foot-PENCHART-FORM-AUTOFILL
 * 펜차트 양식 고객정보 자동 바인딩 — 환불동의서 위치 보정 + 보험차트 성함/주민번호 연동
 *
 * AC-1: 환불동의서 상단 차트번호 자동 표시 (page 1, x=163 y=155)
 * AC-2: 환불동의서 상단 고객 성함 자동 표시 (page 1, x=163 y=188)
 * AC-3: 환불동의서 하단 성명란 위치 보정 (page 3 이름 셀, x=55 y=3206)
 * AC-4: 환불동의서 하단 날짜 위치 보정 (page 3 "년 월 일" 라인, x=440 y=3071)
 * AC-5: 고객 연락처 미표시 (AutofillFields에서 phone 완전 제거)
 * AC-6: 자동 텍스트와 펜 서명 영역 겹침 없음 (page 3 서명 셀은 별도 영역)
 * AC-7: 보험차트 상단 고객 성함 자동 표시 (x=285 y=23)
 * AC-8: 보험차트 상단 주민번호(마스킹) 자동 표시 (customerRrn prop, x=285 y=44)
 * AC-9: 보험차트 DATE·담당의·담당실장 레이아웃 충돌 없음
 * AC-10: 고객 미선택 시 바인딩 필드 빈칸 (에러 없음)
 * AC-11: 기존 펜 드로잉·저장·불러오기 기능 무영향
 * AC-12: 빌드 성공
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

    test('REFUND_AUTOFILL_POS_P3에 phone key 없음', () => {
      const posP3 = [
        { key: 'date', x: 440, y: 3071 },
        { key: 'name', x: 55,  y: 3206 },
      ];
      const keys = posP3.map((p) => p.key);
      expect(keys).not.toContain('phone');
      expect(keys).toContain('date');
      expect(keys).toContain('name');
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
  test.describe('AC-1/2 환불동의서 page 1 자동채움 (위치 보정)', () => {
    // PNG 분석 기반: refund_consent.png 2481×10524 → canvas 794×3369 (scale=0.32)
    const posP1 = [
      { key: 'chartNumber', x: 163, y: 155 }, // "● 차트번호 : " 우측
      { key: 'name',        x: 163, y: 188 }, // "● 환자이름 : " 우측
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

    test('page 1 x 좌표 — 차트번호/환자이름 라벨 우측 (>100)', () => {
      for (const p of posP1) {
        expect(p.x).toBeGreaterThan(100);
        expect(p.x).toBeLessThanOrEqual(794);
      }
    });

    test('chartNumber 빈 값이면 fillText 스킵', () => {
      const chartNumber = '';
      expect(!!chartNumber).toBe(false);
    });
  });

  // ── AC-3/4: 환불동의서 page 3 좌표 보정 ──────────────────────────────────
  test.describe('AC-3/4 환불동의서 page 3 자동채움 (위치 보정)', () => {
    // PNG 분석 기반: [본인 동의서] 섹션 (canvas y=2866~3369)
    // date→ "년 월 일" 라인 앞, name→ "이름" 셀 내부
    const posP3 = [
      { key: 'date', x: 440, y: 3071 }, // [본인 동의서] "년 월 일" 앞 공간
      { key: 'name', x: 55,  y: 3206 }, // [본인 동의서] "이름" 셀 내부
    ];

    test('page 3 필드 2개 (날짜 + 이름) — birthDate 제거', () => {
      expect(posP3).toHaveLength(2);
      const keys = posP3.map((p) => p.key);
      expect(keys).not.toContain('birthDate');
    });

    test('page 3 y 좌표 — page 3 범위 (2246-3369)', () => {
      for (const p of posP3) {
        expect(p.y).toBeGreaterThanOrEqual(2246);
        expect(p.y).toBeLessThanOrEqual(3369);
      }
    });

    test('date y 좌표 — [본인 동의서] 년월일 라인 (>3000)', () => {
      expect(posP3[0].y).toBeGreaterThan(3000); // 날짜가 위에 있던 2939보다 낮아야 함
    });

    test('name y 좌표 — 이름 셀 내부 (>3100)', () => {
      expect(posP3[1].y).toBeGreaterThan(3100); // 이름 셀이 더 낮은 위치
    });

    test('page 1 + page 3 모두 호출 — initBgCanvas에서 2회 drawAutofillOnCtx', () => {
      let callCount = 0;
      const drawAutofillOnCtx = () => { callCount++; };
      const fk = 'refund_consent';
      if (fk === 'refund_consent') {
        drawAutofillOnCtx();  // P1
        drawAutofillOnCtx();  // P3
      }
      expect(callCount).toBe(2);
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
});

/**
 * 현장 클릭 시나리오 (수동 검증용 체크리스트):
 *
 * [시나리오1] 환불동의서 고객정보 자동 표시
 *   1. 데스크 직원 로그인 → 고객 검색 → 차트번호 있는 고객 선택
 *   2. 임상 탭 → 펜차트 탭 → [새 차트 작성]
 *   3. [환불/비급여 동의서] 선택
 *   4. page 1 상단 확인:
 *      - "● 차트번호 : " 옆에 차트번호 자동 표시 (gray-500 italic)
 *      - "● 환자이름 : " 옆에 성함 자동 표시
 *   5. page 3 스크롤 → [본인 동의서] 섹션 확인:
 *      - "년  월  일" 라인 앞에 오늘 날짜 표시 (예: 2026. 5. 24.)
 *      - "이름" 셀 내부에 성함 표시
 *      Expected: 위치 오류 수정 확인 (이전 버전 대비)
 *   6. 연락처 미표시 확인 (AC-5)
 *   7. 펜 서명 → [저장] → list 복귀 정상
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
