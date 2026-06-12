/**
 * E2E spec — T-20260612-foot-DOCDASH-RXCELL-REFINE
 * 진료대시보드(DoctorCallDashboard) 처방 칼럼 정밀화 4건 (문지은 대표원장).
 *   item1 처방·임상경과 칼럼 너비 우선 (colgroup) — 부모 FULLWIDTH-INLINE-EMOJI 정본, 본 spec 은 폭 우선 가드만.
 *   item2 처방 드롭다운: 행 전체폭 펼침행(<tr colSpan>) → 알약(처방 버튼) anchor portal+fixed 팝오버.   ← 본 티켓 신규 스코프
 *   item3 처방된 약 셀 1줄 미리보기 (RxConfirmedSummary plainText) — 부모 정본, 본 spec 은 보존 가드.
 *   item4 처방완료 → '처방완료' 파란글씨(버튼 박스 제거, plainText) — 부모 정본, 본 spec 은 보존 가드.
 *
 * 루트코즈(item2): showRx 펼침행이 `<td colSpan={DOCDASH_COLSPAN}>`(행 전체폭)으로 떠 다른 행을 밀어내고
 *   알약에 정밀 anchor 되지 않음. → 선례(QuickRxButton 툴팁 / CLINICAL-SINGLELINE-DROPDOWN-POS /
 *   PHRASE-SLASH-DROPDOWN-POS) 의 createPortal(document.body)+position:fixed+getBoundingClientRect+clamp 재사용.
 *
 * AC-2 처방 클릭 → 드롭다운이 행 전체폭이 아니라 알약 근처 팝오버(portal/fixed/z-index 최상위).
 *      하단 행에선 위로 열기(up flip) + viewport clamp.
 * AC-5 회귀 0: DISCHARGED-DASH-RXMUTATE-LOCK 게이트 prop / RxConfirmedSummary 취소동선 / 완료섹션 미처방 '-'
 *      (WAITELAPSED-POLISH AC-7 / WAITFILTER-UX7 AC-6) / QuickRxBar 저장·취소 로직 불변.
 * AC-6 실브라우저 육안검증(스크린샷)은 별도 수행(field-soak). 본 spec 은 좌표 불변식 + 실DOM portal/stacking + 소스 정적 가드(auth 불요).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// 정본: RxPopover 포지셔닝 (알약 버튼 경계 기준 → 팝오버 top/left + up/down placement)
//   소스 DoctorCallDashboard.tsx RxPopover.compute 와 동일 규칙.
// ─────────────────────────────────────────────────────────────────────────────
interface AnchorRect { top: number; bottom: number; left: number; }
const RX_POPOVER_W = 320;

function rxPopoverPos(
  r: AnchorRect,
  vw: number,
  vh: number,
  estH = 220,
): { top: number; left: number; placement: 'down' | 'up' } {
  const left = Math.max(8, Math.min(r.left, vw - RX_POPOVER_W - 8));
  const spaceBelow = vh - r.bottom;
  const spaceAbove = r.top;
  let placement: 'down' | 'up' = 'down';
  let top = r.bottom + 6;
  if (spaceBelow < estH + 12 && spaceAbove > spaceBelow) {
    placement = 'up';
    top = Math.max(8, r.top - estH - 6);
  }
  return { top, left, placement };
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2-(1,2): 상단/중단 행 → 알약 바로 아래(down), 좌측 정렬 + 우측 clamp
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 알약 anchor — 아래로 열기(down) + 좌표 clamp', () => {
  test('상단 행 처방 버튼 → 팝오버 알약 바로 아래(bottom+6), 알약 좌측 정렬', () => {
    // 알약 버튼: top=200, bottom=224(px-1 py-1 텍스트 버튼 ≈ 24px), 화면 800 → 아래 충분
    const r: AnchorRect = { top: 200, bottom: 224, left: 900 };
    const { top, left, placement } = rxPopoverPos(r, 1280, 800);
    expect(placement).toBe('down');
    expect(top).toBe(224 + 6); // 알약 바로 아래
    expect(left).toBe(900); // 알약 좌측 정렬(우측 화면 내)
  });

  test('우측 끝 처방 셀 → left viewport clamp(화면 밖 방지)', () => {
    // 처방 칼럼은 테이블 우측 — 알약이 화면 우측 끝(left=1200)이면 클램프
    const r: AnchorRect = { top: 200, bottom: 224, left: 1200 };
    const { left } = rxPopoverPos(r, 1280, 800);
    expect(left).toBeLessThanOrEqual(1280 - RX_POPOVER_W - 8);
    expect(left).toBe(1280 - RX_POPOVER_W - 8); // 952
  });

  test('좌측 8px 가드(음수/화면 밖 방지)', () => {
    const r: AnchorRect = { top: 200, bottom: 224, left: -50 };
    const { left } = rxPopoverPos(r, 1280, 800);
    expect(left).toBeGreaterThanOrEqual(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2-(4): 테이블 '맨 아래 행' → 아래 공간 부족 → 위로 열기(up flip) + clamp
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 하단 행 위로 열기(up flip) + clamp', () => {
  test('화면 하단 근처 알약 → 위로 flip(top - estH - 6)', () => {
    // 알약 bottom=790(vh=800) → 아래 10px 뿐, 위 754px → 위로
    const r: AnchorRect = { top: 766, bottom: 790, left: 900 };
    const { top, placement } = rxPopoverPos(r, 1280, 800);
    expect(placement).toBe('up');
    expect(top).toBe(766 - 220 - 6); // 540 (위로 열림)
    expect(top).toBeLessThan(r.top);
  });

  test('위/아래 모두 좁아도 상단 8px 가드', () => {
    const r: AnchorRect = { top: 40, bottom: 64, left: 900 };
    const { top } = rxPopoverPos(r, 1280, 800, 220);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  test('아래 공간 충분하면 위 공간이 더 넓어도 아래로 유지(불필요한 flip 금지)', () => {
    const r: AnchorRect = { top: 400, bottom: 424, left: 900 };
    const { placement } = rxPopoverPos(r, 1280, 1000); // 아래 576px 충분
    expect(placement).toBe('down');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2-(3): 실DOM — portal+fixed 팝오버가 다른 테이블 행보다 위(elementFromPoint)
//   "드롭다운이 다른 행/셀 뒤로 가려짐" 해소를 실제 브라우저 레이아웃으로 검증(auth 불요).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 실DOM portal stacking — 다른 행 위로 떠야 함', () => {
  test('portal+fixed(z-index:9999) 팝오버가 다음 행보다 최상위', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(`
      <table style="width:100%">
        <tr id="row1" style="position:relative; z-index:1; height:40px; background:#eef">
          <td style="text-align:right"><button id="rxbtn" style="height:24px">처방</button></td>
        </tr>
        <tr id="row2" style="position:relative; z-index:1; height:40px; background:#fee"><td>다음행</td></tr>
      </table>
    `);
    await page.evaluate(() => {
      const btn = document.getElementById('rxbtn')!;
      const r = btn.getBoundingClientRect();
      const W = 320;
      // 실 RxPopover 와 동일한 좌측 viewport clamp(우측 끝 셀에서도 화면 안).
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
      const pop = document.createElement('div');
      pop.id = 'pop';
      pop.setAttribute('data-testid', 'doctor-call-rx-popover');
      pop.style.position = 'fixed';
      pop.style.top = `${r.bottom + 6}px`;
      pop.style.left = `${left}px`;
      pop.style.width = `${W}px`;
      pop.style.height = '180px';
      pop.style.zIndex = '9999';
      pop.style.background = '#fff';
      pop.style.border = '1px solid #ccc';
      document.body.appendChild(pop); // portal=document.body
    });
    const pop = page.locator('#pop');
    await expect(pop).toBeVisible();
    const box = (await pop.boundingBox())!;
    const topId = await page.evaluate(
      ([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement | null)?.id ?? '',
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(topId).toBe('pop'); // row2 가 아니라 pop 이 최상위
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 소스 정적 가드: 펼침행(colSpan 행 전체폭) 폐지 + RxPopover portal/fixed/clamp + item3/4·게이트 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('소스 정적 가드 (회귀 락)', () => {
  const SRC = fs.readFileSync(
    path.join(process.cwd(), 'src/components/doctor/DoctorCallDashboard.tsx'),
    'utf-8',
  );

  test('AC-2: RxPopover = createPortal(document.body) + position:fixed + zIndex 9999', () => {
    const i = SRC.indexOf('function RxPopover');
    expect(i).toBeGreaterThan(0);
    const around = SRC.slice(i, i + 3000);
    expect(around).toContain('createPortal');
    expect(around).toContain("position: 'fixed'");
    expect(around).toContain('zIndex: 9999');
    expect(around).toContain('document.body');
  });

  test('AC-2: up/down flip(아래 공간 부족 → 위로) + viewport clamp 로직 존재', () => {
    const i = SRC.indexOf('function RxPopover');
    const around = SRC.slice(i, i + 3000);
    expect(around).toContain('spaceBelow');
    expect(around).toContain('spaceAbove');
    expect(around).toContain('window.innerHeight');
    expect(around).toContain('window.innerWidth');
    expect(around).toContain('getBoundingClientRect');
  });

  test('AC-2: 행 전체폭 펼침행(rx-expand-row colSpan) 폐지(회귀 금지)', () => {
    expect(SRC).not.toContain('doctor-call-rx-expand-row');
    expect(SRC).not.toContain('doctor-completed-rx-expand-row');
    // 호출/완료 처방 버튼이 RxPopover 로 anchor 됨
    expect(SRC).toContain('testId="doctor-call-rx-popover"');
    expect(SRC).toContain('testId="doctor-completed-rx-popover"');
  });

  test('AC-2: 처방 버튼이 anchorRef(rxBtnRef) 로 팝오버에 anchor', () => {
    expect(SRC).toContain('const rxBtnRef = useRef<HTMLButtonElement>(null)');
    expect(SRC).toContain('ref={rxBtnRef}');
    expect(SRC).toContain('anchorRef={rxBtnRef}');
  });

  test('AC-3/AC-4 보존: 처방완료 = RxConfirmedSummary plainText(약명 셀 미리보기 + 파란글씨)', () => {
    // 두 섹션(호출/완료) 모두 confirmed 시 plainText 미리보기 유지
    const matches = SRC.match(/RxConfirmedSummary/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(SRC).toContain('plainText');
    expect(SRC).toContain('items={checkIn.prescription_items}');
  });

  test('AC-5 보존: DISCHARGED-DASH-RXMUTATE-LOCK 게이트 prop(checkInStatus/checkInFlag/checkedInAt)', () => {
    expect(SRC).toContain('checkInStatus={checkIn.status}');
    expect(SRC).toContain('checkInFlag={checkIn.status_flag}');
    expect(SRC).toContain('checkedInAt={checkIn.checked_in_at}');
  });

  test('AC-5 보존: 완료섹션 미처방 = "-"(WAITELAPSED-POLISH AC-7 / WAITFILTER-UX7 AC-6)', () => {
    expect(SRC).toContain('data-testid="doctor-completed-no-rx"');
  });

  test('AC-1 보존: 처방·임상경과 칼럼 폭 우선(colgroup 처방 >= 20%, 임상경과 >= 22%)', () => {
    // 호출 colgroup: 처방=w-[20%], 임상경과=w-[22%] (부모 FULLWIDTH-INLINE-EMOJI 정본)
    expect(SRC).toContain('w-[20%]');
    expect(SRC).toContain('w-[22%]');
  });

  test('AC-5 보존: QuickRxBar 저장·취소 로직 불변(컨테이너만 변경 — compact/surface/onApplied 주입 유지)', () => {
    // 팝오버 children 으로 QuickRxBar 가 동일 prop 으로 주입됨
    expect(SRC).toContain('onApplied={onRefresh}');
    expect(SRC).toContain('surface="doctor_call_dashboard"');
    expect(SRC).toContain('compact');
  });
});
