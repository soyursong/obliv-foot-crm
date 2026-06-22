/**
 * E2E spec — T-20260614-foot-DOCPATIENTLIST-COLWIDTH-RATIO-TUNE (문지은 대표원장)
 * LISTCOL-WIDTH-SHRINK(취소) canonical 대체. 진료 환자목록 테이블(DoctorCallDashboard) 4컬럼 비율 축소.
 *
 * 기준: EXPAND-QUICKEDIT 배포본(commit f8ad7a9, bundle DoctorTools-DJDZh6-y.js).
 *   feed   = 5·9·11·9·8·9·6·24·14·5 (방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과·시간)
 *   complt = 5·10·12·9·8·9·6·25·16 (방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과)
 *
 * 비율: 방 ×0.75 · 상태 ×0.75 · 이름 ×0.50 · 처방 ×0.50.
 * 해방된 ~20%p(feed) / ~21%p(complt) 전량을 임상경과 본문(우선)에 재분배. 나머지 컬럼 불변.
 *   feed   → 4·7·6·9·8·9·6·12·34·5 (합 100)
 *   complt → 4·8·6·9·8·9·6·13·37   (합 100)
 *
 * ⚠ GUARD: CSS-only. DB 무변경, 신규 컴포넌트 0, colgroup w-[..] 값만 조정.
 *   부모 AC-2(컬럼앵커 팝오버)·AC-3(빠른수정) 회귀 0 — 폭만 변경.
 *   DoctorCallListBar.tsx 미터치(잘못된 surface 후보).
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH/COLWIDTH-EXPAND-QUICKEDIT spec 컨벤션 동일.
 *
 * ─── STALE-RECONCILE (T-20260615-foot-DOCDASH-COLGROUP-E2E-STALE-RECONCILE, 가설A) ───
 * 이 spec 의 RATIO-TUNE 10칼럼 ×0.75/×0.50 비율 모델은 5개 후속 티켓으로 '합법' supersede 됨:
 *   RATIO-TUNE([4,7,6,9,8,9,6,12,34,5])
 *   → STATNAME-WIDEN-CENTER(상태7→8·이름6→7·임상경과34→32)
 *   → WAITDONE-ALIGN(완료=대기 글자그대로 동일 colgroup)
 *   → NAME-EMOJI-CLINICAL-3FIX item2('차트' 칼럼 6% 제거: 10칼럼→9칼럼, 임상경과 32→38)
 *   → RX-DISPLAY-REVAMP item3(처방 12→18 ×1.5, 임상경과 38→32)
 * 배포 정본(commit aa2e7819) 실측 = 9칼럼 [4,8,7,9,8,9,18,32,5] 합100 (feed==completed).
 *   ⇒ 가설A: 합100 & 시각정상 → 기대값을 deployed truth 로 갱신. ×0.75/×0.50 비율·idx8 임상경과 단언은
 *      supersede 되어 제거. 불변 invariant(합100 / 임상경과 본문우선 최대폭 / 양테이블 정합)만 유지.
 *   순서(9칼럼): 방·상태·이름·생년(만나이)·차트번호·오늘시술·처방·임상경과·시간.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

function colWidths(block: string): number[] {
  return [...block.matchAll(/w-\[(\d+)%\]/g)].map((m) => Number(m[1]));
}
function colgroupAfter(s: string, anchor: string): number[] {
  const start = s.indexOf(anchor);
  const cgStart = s.indexOf('<colgroup>', start);
  const cgEnd = s.indexOf('</colgroup>', cgStart);
  return colWidths(s.slice(cgStart, cgEnd));
}
// 배포 정본(commit aa2e7819) 실측 truth — feed==completed, 9칼럼, 합100.
//   순서: 방·상태·이름·생년·차트번호·오늘시술·처방·임상경과·시간.
const TRUTH = [4, 8, 7, 9, 8, 9, 18, 32, 5];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 현장 클릭: 호출(대기) 테이블 환자행 — 배포정본 colgroup 회귀 고정
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 호출 테이블 — 배포정본 9칼럼 colgroup + 합 100', () => {
  test('feed colgroup: 배포정본 [4,8,7,9,8,9,18,32,5] · 합 100 · 임상경과 최대', () => {
    const w = colgroupAfter(DASH(), 'doctor-call-feed-table');
    // STALE-RECONCILE 가설A: RATIO-TUNE 10칼럼 비율모델 supersede(헤더 참조) → deployed truth 로 갱신.
    expect(w).toEqual(TRUTH);
    // table-fixed 합 100% hard 제약(불변 invariant).
    expect(w.reduce((a, b) => a + b, 0)).toBe(100);
    // 본문 우선 재분배 설계의도 보존: 임상경과(idx7) 가 최대 데이터 컬럼.
    expect(w[7]).toBe(Math.max(...w));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 현장 클릭: 진료 완료 테이블 환자행 — 대기와 글자그대로 동일(WAITDONE-ALIGN)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 완료 테이블 — 대기와 동일 colgroup + 합 100', () => {
  test('completed colgroup: 대기와 동일 [4,8,7,9,8,9,18,32,5] · 합 100', () => {
    const w = colgroupAfter(DASH(), 'doctor-completed-table');
    expect(w).toEqual(TRUTH);
    expect(w.reduce((a, b) => a + b, 0)).toBe(100);
    expect(w[7]).toBe(Math.max(...w));
    // WAITDONE-ALIGN: 완료 colgroup == 대기 colgroup (양 테이블 정합 invariant).
    expect(w).toEqual(colgroupAfter(DASH(), 'doctor-call-feed-table'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 현장 클릭: 임상경과 셀 클릭(본문 우선) — 임상경과 최대폭 유지
//             + AC-2 컬럼앵커 팝오버 / AC-3 빠른수정 회귀 0 (폭만 변경)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 임상경과 본문 우선 재분배 + AC-2/AC-3 회귀 0', () => {
  test('임상경과 컬럼이 최대 폭 — 본문 우선 설계의도 유지(현 정본)', () => {
    const feed = colgroupAfter(DASH(), 'doctor-call-feed-table');
    const cmpl = colgroupAfter(DASH(), 'doctor-completed-table');
    // STALE-RECONCILE: '차트' 칼럼 제거(10→9col)로 임상경과 인덱스 8→7 이동. idx7 = 임상경과.
    expect(feed[7]).toBe(Math.max(...feed));
    expect(cmpl[7]).toBe(Math.max(...cmpl));
    // 임상경과(32) > 처방(idx6=18) — 본문 우선 재분배 유지.
    expect(feed[7]).toBeGreaterThan(feed[6]);
    expect(cmpl[7]).toBeGreaterThan(cmpl[6]);
    // 불변 컬럼(생년·차트번호·오늘시술) feed/cmpl 동일하게 보존.
    expect([feed[3], feed[4], feed[5]]).toEqual([9, 8, 9]);
    expect([cmpl[3], cmpl[4], cmpl[5]]).toEqual([9, 8, 9]);
  });

  test('AC-2 컬럼앵커 팝오버(처방/임상경과 전문) 회귀 0 — 폭만 변경', () => {
    const s = DASH();
    // table-fixed 유지(폭 hard 제약 근거).
    expect(s).toContain('table-fixed');
    // 컬럼앵커 펼침 팝오버·앵커 ref 보존.
    //   T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW: ColumnExpandPopover 공유 모듈로 추출 → import·사용으로 검증(로컬 정의 없음).
    expect(s).toContain("from '@/components/doctor/ColumnExpandPopover'");
    expect(s).toContain('<ColumnExpandPopover');
    expect(s).toContain('anchorRef={rxCellRef}');
    expect(s).toContain('anchorRef={clinicalCellRef}');
    expect(s).toContain('doctor-call-rx-expand-pop');
    expect(s).toContain('doctor-completed-rx-expand-pop');
    expect(s).toContain('doctor-call-clinical-expand-pop');
    expect(s).toContain('doctor-completed-clinical-expand-pop');
    // 폐기된 행 전체폭 펼침행 testId 잔존 0.
    expect(s).not.toContain('doctor-call-rx-expand-row');
    expect(s).not.toContain('doctor-completed-rx-expand-row');
  });

  test('AC-3 빠른수정 어포던스 회귀 0 + DoctorCallListBar 미터치', () => {
    const s = DASH();
    // 빠른수정 토글/펼침 상태 보존.
    expect(s).toContain('setExpandRx');
    expect(s).toContain('onToggleExpand={() => setExpandRx');
    // STALE-RECONCILE: 완료 colgroup 주석이 WAITDONE-ALIGN 으로 재작성되며 RATIO-TUNE provenance 1곳만 잔존.
    //   provenance-count(==2) 는 후속 진화로 깨지는 brittle 단언 → '최소 1회 잔존(이력 보존)' 으로 완화.
    const tuneRefs = [...s.matchAll(/COLWIDTH-RATIO-TUNE/g)].length;
    expect(tuneRefs).toBeGreaterThanOrEqual(1);
  });
});
