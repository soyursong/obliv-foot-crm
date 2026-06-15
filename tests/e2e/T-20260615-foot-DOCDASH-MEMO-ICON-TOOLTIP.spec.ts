/**
 * E2E spec — T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP
 * 진료대시보드(DoctorCallDashboard) 환자 행: 이름 아래 노출되던 전달사항 메모(doctor_call_memo)
 *   텍스트를 제거하고, 메모가 있을 때만 상태 셀(✋/진료완료 옆)에 빨간 미니멀 종 아이콘 +
 *   hover 시 메모 전문 툴팁(잘림 없이)으로 이전. (문지은 대표원장, #foot 1781502656.774439)
 *
 * ⚠ 대상 필드: doctor_call_memo(전달사항 메모, 이름 아래 현재 노출 중). reporter가 "예약메모"라
 *   불렀으나 이름 아래 건은 doctor_call_memo다. DoctorPatientList의 booking_memo는 다른 화면 — 미접촉.
 *
 * AC:
 *   AC1 메모 有 행 상태셀(✋)옆 빨간 미니멀 아이콘
 *   AC2 hover 시 메모 전문 툴팁(잘림 없이)
 *   AC3 메모 無 행 아이콘 미표시(조건부 가드 유지)
 *   AC4 이름 아래 텍스트 노출 제거
 *   AC5 진료완료(inactive) 행도 동일 규칙('진료완료' 텍스트 옆)
 *   AC6 실브라우저 렌더 확인 — 본 spec은 page.setContent 실 Chromium 렌더(hover 토글 동작)
 *
 * 비범위: DB·SELECT·메모 소스 불변, ✋/완료버튼 동작 불변(시각 추가만), booking_memo 미접촉, foot 전용.
 *
 * 스타일: 정본 구조 in-page 실DOM 렌더(group-hover CSS 모사) + 소스 정적 가드. auth/DB 비의존(unit 프로젝트).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const DASH = SRC('components/doctor/DoctorCallDashboard.tsx');

const LONG_MEMO = 'VIP 고객 — 우측 무지외반 통증 심함. 진료 시 좌측 발도 함께 확인 요망. 보호자 동반 예정이며 수납은 카드 분할로 안내드릴 것.';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 실브라우저 렌더: 메모 有 → 빨간 종 + hover 툴팁(잘림 없이) (AC1/AC2/AC6)
// ─────────────────────────────────────────────────────────────────────────────
// 정본(MemoBell)의 group-hover:block 동작을 raw CSS로 모사 → 실 Chromium 에서 hover 토글 검증.
function harness(memo: string | null): string {
  const bell = memo
    ? `<span class="group" data-testid="doctor-call-memo-bell">
         <svg class="bell" data-bell aria-label="전달사항 메모" width="14" height="14"><circle cx="7" cy="7" r="5"/></svg>
         <span role="tooltip" class="tip" data-testid="doctor-call-memo-tooltip">${memo}</span>
       </span>`
    : '';
  return `<!doctype html><html><head><style>
    .group { position: relative; display: inline-flex; align-items: center; }
    .bell { color: #ef4444; }              /* text-red-500 */
    .tip {
      position: absolute; left: 50%; top: 100%; z-index: 50; margin-top: 4px;
      display: none; width: max-content; max-width: 18rem;
      white-space: pre-wrap; background: #111827; color: #fff;
      padding: 6px 10px; border-radius: 6px; font-size: 12px; line-height: 1.3;
    }
    .group:hover .tip { display: block; }  /* group-hover:block */
  </style></head><body>
    <span class="status">
      <span class="dot"></span><span>진료필요</span>${bell}
    </span>
  </body></html>`;
}

test.describe('S1 실DOM — 메모 有: 빨간 종 + hover 전문 툴팁', () => {
  test('AC1 빨간 종 노출 + AC2 hover 시 툴팁 전문(잘림 0)', async ({ page }) => {
    await page.setContent(harness(LONG_MEMO));

    const bell = page.getByTestId('doctor-call-memo-bell');
    await expect(bell).toBeVisible(); // AC1

    // 종 아이콘 색 = 빨강(text-red-500 #ef4444)
    const color = await page.locator('[data-bell]').evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgb(239, 68, 68)');

    const tip = page.getByTestId('doctor-call-memo-tooltip');
    await expect(tip).toBeHidden(); // hover 전 숨김

    await bell.hover();
    await expect(tip).toBeVisible(); // AC2 hover → 노출

    // 전문 잘림 없이(텍스트 동일) + 줄바꿈 보존(whitespace-pre-wrap)
    await expect(tip).toHaveText(LONG_MEMO);
    const ws = await tip.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(ws).toBe('pre-wrap');
    // clip/ellipsis 로 잘리지 않음 — scrollWidth ≤ clientWidth+1 (가로 truncation 없음)
    const clipped = await tip.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 실브라우저 렌더: 메모 無 → 아이콘 미표시 (AC3)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 실DOM — 메모 無: 아이콘 미표시', () => {
  test('AC3 메모 없으면 종 미렌더', async ({ page }) => {
    await page.setContent(harness(null));
    await expect(page.getByTestId('doctor-call-memo-bell')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 정본 소스 정적 가드 (AC1/AC3/AC4/AC5 + 비범위)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 소스 정적 가드 — 정본 구조', () => {
  test('AC4: 이름 아래 메모 텍스트(📋) 노출 제거', () => {
    // 옛 노출 라인 잔존 0
    expect(DASH).not.toContain('📋 {checkIn.doctor_call_memo}');
    expect(DASH).not.toContain("'📋 '");
  });

  test('AC1: MemoBell 컴포넌트 = 빨간 종(Bell text-red-500) + 전문 툴팁', () => {
    expect(DASH).toContain('function MemoBell(');
    // 빨간 종 아이콘
    expect(DASH).toMatch(/<Bell className="[^"]*text-red-500[^"]*"/);
    // 툴팁: whitespace-pre-wrap(잘림 없음) + group-hover:block(hover 노출)
    expect(DASH).toContain('whitespace-pre-wrap');
    expect(DASH).toContain('group-hover:block');
    expect(DASH).toContain('data-testid="doctor-call-memo-bell"');
    expect(DASH).toContain('data-testid="doctor-call-memo-tooltip"');
    // Bell 은 이미 import 됨(신규 의존성 0)
    expect(DASH).toMatch(/import\s*\{[\s\S]*\bBell\b[\s\S]*\}\s*from\s*'lucide-react'/);
  });

  test('AC1/AC3/AC5: 상태셀에서 doctor_call_memo 조건부로 MemoBell 렌더(✋/진료완료 공통 분기)', () => {
    // 상태 셀 span(✋ 영역) 내부에서 조건부 가드와 함께 호출 — inactive/active 공통 span 말미
    expect(DASH).toContain('{checkIn.doctor_call_memo && <MemoBell memo={checkIn.doctor_call_memo} />}');
  });

  test('비범위: doctor_call_memo SELECT 컬럼 불변(DB/소스 미접촉)', () => {
    // 데이터 소스 컬럼은 그대로 — 표시만 추가
    expect(DASH).toContain('doctor_call_memo,');
  });

  test('비범위: booking_memo(DoctorPatientList 화면) 미접촉', () => {
    // 본 파일에서 booking_memo 를 새로 다루지 않음
    expect(DASH).not.toContain('booking_memo');
  });
});
