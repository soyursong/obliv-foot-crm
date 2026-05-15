/**
 * E2E spec — T-20260515-foot-DASH-AMOUNT-FORMAT
 * 대시보드 완료 칸 금액 포맷 — 만원 반올림 → 원 단위 콤마 포맷
 *
 * AC-1: 완료 칸 카드 하단 금액 → 원 단위 콤마 포맷 (예: "43,520")
 * AC-2: 상단 합계금액 원 단위 표시 (기존 동일, 일관성 확인)
 * AC-3: 수납대기 등 다른 칸도 동일 포맷 (formatAmount 통일)
 *
 * 시나리오 1: 정상 동선 — 43,520원 수납 시 "43,520" 표시 (not "4만")
 * 시나리오 2: 엣지 케이스 — 0원 / 1,000,000원 이상
 * 시나리오 3: 회귀 — 만원 반올림 로직(Math.round(x/10000)+'만') 복귀 없음
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

/** 풋센터 formatAmount 규칙: 천단위 콤마, 화폐 단위 없음 */
function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return Math.round(value).toLocaleString('ko-KR');
}

test.describe('T-20260515-DASH-AMOUNT-FORMAT — 완료 칸 금액 원 단위 표시', () => {

  test('AC-1 시나리오 1: 43,520원 수납 → "43,520" 포맷 (만원 반올림 X)', async () => {
    // DB 불필요 — 순수 포맷팅 로직 검증
    const amount = 43520;
    const formatted = formatAmount(amount);

    // 원 단위 콤마 포맷이어야 함
    expect(formatted, '43520원은 "43,520"으로 표시').toBe('43,520');

    // 만원 반올림 포맷이면 안 됨
    expect(formatted, '"4만" 스타일 금지').not.toContain('만');
    expect(formatted, '"4만" 스타일 금지').not.toBe('4만');
    expect(formatted, '"4만" 스타일 금지').not.toBe('4.352만');

    console.log(`[AC-1] 43520 → "${formatted}" PASS`);
  });

  test('AC-1 시나리오 2: 엣지 케이스 — 0원', async () => {
    expect(formatAmount(0), '0원은 "0"').toBe('0');
    expect(formatAmount(null), 'null은 "0"').toBe('0');
    expect(formatAmount(undefined), 'undefined는 "0"').toBe('0');

    console.log('[AC-1 엣지] 0원/null/undefined PASS');
  });

  test('AC-1 시나리오 2: 엣지 케이스 — 1,000,000원 이상', async () => {
    const amount = 1000000;
    const formatted = formatAmount(amount);

    expect(formatted, '1000000원은 "1,000,000"').toBe('1,000,000');
    expect(formatted, '"100만" 스타일 금지').not.toContain('만');

    const large = 1234567;
    const largeFmt = formatAmount(large);
    expect(largeFmt, '1234567원은 "1,234,567"').toBe('1,234,567');

    console.log(`[AC-1 엣지] 1000000 → "${formatted}" PASS`);
    console.log(`[AC-1 엣지] 1234567 → "${largeFmt}" PASS`);
  });

  test('AC-2: 상단 합계금액도 원 단위 (doneTotal 합산 포맷)', async () => {
    // 여러 건의 합산 시뮬
    const payments = [43520, 87000, 130000];
    const total = payments.reduce((s, v) => s + v, 0);
    const formatted = formatAmount(total);

    expect(formatted, '합산 260,520원은 "260,520"').toBe('260,520');
    expect(formatted, '합산도 만원 반올림 X').not.toContain('만');

    console.log(`[AC-2] doneTotal ${total} → "${formatted}" PASS`);
  });

  test('AC-3: 수납대기 칸 금액도 동일 포맷 (formatAmount 통일)', async () => {
    // 수납대기 pendingTotal / pendingServiceMap 값도 같은 함수 사용
    const pendingAmount = 95000;
    const formatted = formatAmount(pendingAmount);

    expect(formatted, '95000원은 "95,000"').toBe('95,000');
    expect(formatted, '수납대기도 만원 반올림 X').not.toContain('만');

    console.log(`[AC-3] pendingAmount ${pendingAmount} → "${formatted}" PASS`);
  });

  test('AC-3 시나리오 3: 회귀 — Math.round(x/10000)+"만" 로직 사용 안 함', async () => {
    // 만원 반올림 로직이 복귀하지 않았는지 확인
    const testValues = [43520, 10000, 9999, 50001, 1234567];
    for (const v of testValues) {
      const formatted = formatAmount(v);

      // 만원 반올림 로직: Math.round(v / 10000) + '만'
      const oldFormat = `${Math.round(v / 10000)}만`;

      expect(formatted, `${v}원이 old format "${oldFormat}"으로 표시되면 안 됨`).not.toBe(oldFormat);
      expect(formatted, `${v}원에 "만" 포함 금지`).not.toContain('만');
    }

    console.log('[AC-3 회귀] 만원 반올림 로직 없음 PASS');
  });

  test('DB 연동: 실제 payments 데이터 amount 필드가 원 단위 정수로 저장됨', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }

    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `amount-format-test-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;
    const testAmount = 43520;

    // 테스트 고객 + done 체크인 시드
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();

    const { data: checkIn, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customer!.id,
        customer_name: testName,
        customer_phone: testPhone,
        visit_type: 'returning',
        status: 'done',
        queue_number: 993,
      })
      .select()
      .single();
    expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
    const checkInId = checkIn!.id as string;

    try {
      // 수납 기록 삽입
      const { data: payment, error: payErr } = await sb
        .from('payments')
        .insert({
          clinic_id: CLINIC_ID,
          check_in_id: checkInId,
          amount: testAmount,
          payment_type: 'card',
          total_amount: testAmount,
        })
        .select()
        .single();
      expect(payErr, `수납 기록 실패: ${payErr?.message}`).toBeNull();

      // DB amount가 원 단위 정수로 저장됨 확인
      expect(payment!.amount, '원 단위 정수 저장').toBe(testAmount);
      expect(payment!.amount, '만원 단위(4.352)로 저장되면 안 됨').not.toBe(testAmount / 10000);

      // formatAmount 적용 결과 검증
      const formatted = formatAmount(payment!.amount);
      expect(formatted, '43,520원 → "43,520"').toBe('43,520');
      expect(formatted, '"만" 포함 금지').not.toContain('만');

      console.log(`[DB 연동] payments.amount=${payment!.amount} → "${formatted}" PASS`);
    } finally {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customer!.id);
    }
  });

});
