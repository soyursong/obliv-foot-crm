import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  slotsForDate,
  slotWindowFor,
  isOpenDay,
} from '../../src/lib/schedule';
import type { Clinic, OperatingHoursGeneration } from '../../src/lib/types';

/**
 * T-20260817-foot-RESVSLOT-OPHOURS-0930 — forward-date PREVIEW render (reporter-confirm surface).
 *
 * 목적(planner NEW-SUBTASK MSG-20260817-134051-prfe):
 *   supervisor QA = CODE PASS(재수정 불요). 남은 GO-gate = reporter_screen_confirm(C35) + go_token.
 *   → reporter(김주연 총괄) 화면 컨펌을 **forward-date PREVIEW**로 충족(prod apply 前·persist-first).
 *
 * ★이 스펙은 PROD DB 를 건드리지 않는다. staged 마이그(20260817130000_foot_ophours_0930_start,
 *   open_time 09:30)가 만들 **09-01 세대 데이터**를 그대로 in-memory 로 주입하고, 실제 resolver
 *   (src/lib/schedule.ts — E2E 9/9 가 봉인한 그 표면)를 통과시켜 슬롯피커 렌더를 스크린샷한다.
 *   = "resolver 출력 스크린샷"(planner 수용 형태) · 로컬 프리뷰 · prod UPDATE 0.
 *
 * 산출: qa-evidence/T-20260817-foot-RESVSLOT-OPHOURS-0930/
 *   - preview_0901_tue.png : 09-01(화) 첫 09:30 · 마지막 19:00 · 30분
 *   - preview_0905_sat.png : 09-05(토) 첫 09:30 · 마지막 18:00 · 30분
 */

const SLOT_INTERVAL = 30;

// staged 마이그(open_time 09:30) 적용 후 09-01 세대 데이터. dry-run 값과 동일. 일(dow 0)=row-absent(휴무).
const GEN_20260901_0930: OperatingHoursGeneration[] = [
  { day_of_week: 1, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 2, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 3, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 4, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 5, open_time: '09:30', close_time: '20:00', last_booking_slot: '19:00', effective_from: '2026-09-01', effective_to: null },
  { day_of_week: 6, open_time: '09:30', close_time: '19:00', last_booking_slot: '18:00', effective_from: '2026-09-01', effective_to: null },
];

function makeClinic(): Clinic {
  return {
    id: '74967aea-a60b-4da3-a0e7-9c997a930bc8',
    open_time: '10:00',
    close_time: '20:30',
    weekend_close_time: '18:30',
    slot_interval: SLOT_INTERVAL,
    operating_hours: GEN_20260901_0930,
  } as unknown as Clinic;
}

const EVIDENCE_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../qa-evidence/T-20260817-foot-RESVSLOT-OPHOURS-0930',
);

function ensureDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

const KOR_DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 실제 resolver 출력을 태블릿 슬롯피커 스타일(teal-emerald)로 렌더 → 화면 컨펌용. */
function renderHtml(date: Date, clinic: Clinic): string {
  const win = slotWindowFor(date, clinic);
  const slots = slotsForDate(date, clinic);
  const open = isOpenDay(date, clinic);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dowLabel = KOR_DOW[date.getDay()];
  const first = slots[0] ?? '—';
  const last = slots[slots.length - 1] ?? '—';

  const chips = slots
    .map(
      (t, i) =>
        `<button class="slot ${i === 0 ? 'first' : ''} ${i === slots.length - 1 ? 'last' : ''}">${t}</button>`,
    )
    .join('');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; font-family: -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  body { margin: 0; background: #f0fdfa; padding: 28px; }
  .card { max-width: 720px; background: #fff; border-radius: 16px; box-shadow: 0 4px 18px rgba(13,148,136,.12);
          border: 1px solid #ccfbf1; overflow: hidden; }
  .head { background: linear-gradient(135deg, #0d9488, #10b981); color: #fff; padding: 18px 22px; }
  .head .title { font-size: 20px; font-weight: 800; }
  .head .sub { font-size: 13px; opacity: .92; margin-top: 4px; }
  .meta { display: flex; gap: 18px; padding: 14px 22px; background: #f0fdfa; border-bottom: 1px solid #ccfbf1;
          font-size: 13px; color: #0f766e; }
  .meta b { color: #134e4a; font-weight: 800; }
  .body { padding: 20px 22px 24px; }
  .body .label { font-size: 13px; font-weight: 700; color: #0f766e; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
  .slot { padding: 14px 6px; border-radius: 12px; border: 1.5px solid #99f6e4; background: #fff; color: #0f766e;
          font-size: 16px; font-weight: 700; text-align: center; }
  .slot.first { border-color: #0d9488; background: #0d9488; color: #fff; box-shadow: 0 2px 8px rgba(13,148,136,.35); }
  .slot.last  { border-color: #10b981; background: #ecfdf5; color: #047857; }
  .footnote { margin-top: 18px; font-size: 12px; color: #64748b; line-height: 1.6; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
           background: #ccfbf1; color: #0f766e; }
</style></head><body>
  <div class="card">
    <div class="head">
      <div class="title">신규 예약 시간 선택 — 종로 풋센터</div>
      <div class="sub">${y}년 ${m}월 ${d}일 (${dowLabel}) · 2026-09-01 이후 운영시간 · <span class="badge" style="background:rgba(255,255,255,.22);color:#fff;">미리보기</span></div>
    </div>
    <div class="meta">
      <div>운영 여부 <b>${open ? '영업' : '휴무'}</b></div>
      <div>첫 슬롯 <b>${first}</b></div>
      <div>마지막 슬롯 <b>${last}</b></div>
      <div>간격 <b>${SLOT_INTERVAL}분</b></div>
      <div>슬롯 수 <b>${slots.length}개</b></div>
    </div>
    <div class="body">
      <div class="label">예약 가능한 시간대 (오전 09:30 시작)</div>
      <div class="grid">${chips}</div>
      <div class="footnote">
        · 운영 window: ${win.open || '—'} ~ ${win.close || '—'} (마지막 예약 슬롯 포함)<br/>
        · 이 화면은 <b>실제 예약 화면의 시간 계산기</b>가 09-01 이후 운영시간(시작 09:30)으로 만든 결과입니다.<br/>
        · 확정 반영(운영 DB 적용) 전 미리보기 — 총괄 화면 컨펌용.
      </div>
    </div>
  </div>
</body></html>`;
}

test.describe('T-20260817-foot-RESVSLOT-OPHOURS-0930 forward-date PREVIEW (no prod apply)', () => {
  test('preview: 09-01(화) 첫 09:30 · 마지막 19:00', async ({ page }) => {
    ensureDir();
    const clinic = makeClinic();
    const date = new Date(2026, 8, 1); // 2026-09-01 (화)
    await page.setViewportSize({ width: 800, height: 720 });
    await page.setContent(renderHtml(date, clinic));
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'preview_0901_tue.png'), fullPage: true });

    // 렌더값 자가검증(스크린샷이 스펙과 일치함을 보증)
    const slots = slotsForDate(date, clinic);
    test.expect(slots[0]).toBe('09:30');
    test.expect(slots[slots.length - 1]).toBe('19:00');
    test.expect(slots.length).toBe(20); // 09:30~19:00 inclusive, 30분 → 570/30+1
  });

  test('preview: 09-05(토) 첫 09:30 · 마지막 18:00', async ({ page }) => {
    ensureDir();
    const clinic = makeClinic();
    const date = new Date(2026, 8, 5); // 2026-09-05 (토)
    await page.setViewportSize({ width: 800, height: 720 });
    await page.setContent(renderHtml(date, clinic));
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'preview_0905_sat.png'), fullPage: true });

    const slots = slotsForDate(date, clinic);
    test.expect(slots[0]).toBe('09:30');
    test.expect(slots[slots.length - 1]).toBe('18:00');
    test.expect(slots.length).toBe(18); // 09:30~18:00 inclusive, 30분 → 510/30+1
  });
});
