/**
 * E2E spec — T-20260614-foot-DOCDASH-POSTDEPLOY-REFINE-5 item⑤ (B안)
 * 진료환자목록(DoctorPatientList) — 진료알림판 테이블(DoctorCallDashboard, commit 41015d7)과
 *   시각적 톤 통일. 문지은 대표원장 A/B 선택 결과 "b로 하자" 확정:
 *   · B안 = grid 레이아웃 그대로 유지(grid→table 전환 금지, 컬럼셋/워크플로 무변경).
 *   · 컬럼폭·색·밀도(spacing/font-size/line-height/톤)만 41015d7 테이블과 통일.
 *   · A안(컬럼 신설·재배치·워크플로 table 이식 = 재설계급) 미채택.
 *
 * 표시 레이어 조정만 — DB 무변경, 로직/testid/SELECT/grid-template 무변경.
 * 스타일: 소스 정적 검증(컴포넌트가 auth/DB 의존). DoctorPatientList.tsx 렌더 정본을 직접 읽어
 *   ① 통일된 톤 토큰 적용 ② grid 레이아웃/컬럼셋/워크플로 무변경(회귀)을 잡는다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorPatientList.tsx');
const src = readFileSync(SRC, 'utf-8');

test.describe('item⑤(B안) — 진료알림판 테이블 톤 통일 (밀도/폰트/색)', () => {
  test('밀도: 행 grid 셀 패딩이 테이블 셀(px-1.5 py-1)로 통일 — 구 px-2 py-1.5 잔재 0', () => {
    // 41015d7 테이블 td = px-1.5 py-1. 진료환자목록 main+history 행 grid 동일 밀도로 통일.
    const tightHits = [...src.matchAll(/items-center gap-1\.5 px-1\.5 py-1[^.]/g)].length;
    expect(tightHits).toBeGreaterThanOrEqual(2); // main + history 두 행 모드
    // 구 밀도(px-2 py-1.5) 행 grid 잔재 없음
    expect(src).not.toContain('items-center gap-1.5 px-2 py-1.5');
  });

  test('이름셀 톤: 테이블 이름(text-[15px] font-semibold text-gray-900) 통일 — 구 text-sm 잔재 0', () => {
    const nameHits = [...src.matchAll(/text-\[15px\] font-semibold text-gray-900/g)].length;
    expect(nameHits).toBeGreaterThanOrEqual(2); // main + history
    expect(src).not.toContain('truncate text-left text-sm font-semibold');
  });

  test('차트번호셀 톤: 테이블 차트번호(font-mono text-[13px] text-gray-500) 통일', () => {
    const hits = [...src.matchAll(/font-mono text-\[13px\] text-gray-500/g)].length;
    expect(hits).toBeGreaterThanOrEqual(2); // main + history
    // 구 톤(font-mono text-[11px] text-muted-foreground) 잔재 없음
    expect(src).not.toContain('font-mono text-[11px] text-muted-foreground');
  });

  test('방(치료실)셀 톤: teal 배지 → 단색 회색 plain text(text-gray-600 + MapPin gray-400)', () => {
    // reporter 거부 톤(teal 배지) 제거 — 진료알림판 방 셀(단색 회색)과 통일.
    expect(src).not.toContain('border border-teal-100 bg-teal-50 px-1 py-px text-[10px] font-medium text-teal-700');
    expect(src).toContain('inline-flex min-w-0 items-center gap-0.5 text-[13px] font-medium text-gray-600');
    expect(src).toContain('MapPin className="h-2.5 w-2.5 shrink-0 text-gray-400"');
    // 동일 SSOT(getAssignedSlotName) 유지 — 파생 로직 무변경.
    expect(src).toContain('getAssignedSlotName(');
    expect(src).toContain('data-testid="patient-room"');
  });

  test('빈값 placeholder: 테이블(text-gray-300) 톤 통일 — 방/메모 빈값', () => {
    // 방 빈값 + 메모 빈값 모두 gray-300.
    expect(src).toContain('text-[13px] text-gray-300 text-left'); // 방 빈값
    expect(src).toContain("row.booking_memo ? 'text-gray-600' : 'text-gray-300'"); // 메모 본문/빈값
  });

  test('상태셀 in-clinic 텍스트 톤: text-[13px] text-gray-600 통일', () => {
    expect(src).toContain('text-[13px] text-gray-600 truncate');
    expect(src).toContain('data-testid="status-cell"');
  });
});

test.describe('회귀 — grid 레이아웃/컬럼셋/워크플로 무변경 (A안 미채택)', () => {
  test('grid-template(컬럼셋) 무변경 — main 8칼럼 / history 7칼럼 폭 유지', () => {
    // B안: grid→table 금지, 컬럼셋 무변경. 기존 grid-cols 폭 정의 그대로 유지.
    expect(src).toContain('3rem_5rem_4.5rem_5.5rem_3.75rem_4.75rem_minmax(0,1fr)_auto'); // main
    expect(src).toContain('3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto'); // history
  });

  test('표시 레이어 한정 — DB/로직 무변경(SELECT·게이트·차트 진입 SSOT 유지)', () => {
    expect(src).toContain('consultation_room, treatment_room, laser_room, examination_room');
    expect(src).toContain('assertInClinicForRxMutation'); // 처방확정 게이트 유지
    expect(src).toContain('useChart'); // 차트 진입 단일 게이트웨이 유지
  });

  test('워크플로 testid 무변경 — 필터/정렬/확정/펼침 동선 보존', () => {
    for (const tid of [
      'patient-row',
      'patient-name',
      'patient-chartno',
      'prescription-badge',
      'status-cell',
      'patient-room',
      'booking-memo',
      'confirm-prescription-btn',
      'patient-list',
      'signdoctor-select',
      'patient-sort-toggle',
    ]) {
      expect(src).toContain(`data-testid="${tid}"`);
    }
  });
});
