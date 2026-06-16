/**
 * E2E spec — T-20260617-foot-DOCDASH-CHOJAE-TAG-LEFTBLOCK (P2)
 * 진료대시보드(진료 알림판, DoctorCallDashboard) 환자이름 칼럼 — 초/재 배지 라벨 축약 + [배지+이름] 블록 좌정렬.
 *
 * reporter(문지은 대표원장, #foot)가 DECISION-REQUEST(MSG-20260617-011307-gpkr)에 직접 답변한
 * sanctioned re-spec. 직전 배포 NAMECOL-LEFTALIGN-BADGEFIX(commit cfb241d4) 위 reporter 최종 확정:
 *   (가) 배지 왼쪽 유지(우측 이동 금지)
 *   (나) 배지 라벨 단일글자 `초`/`재`
 *   (다) [초/재 배지 + 환자이름] 묶음 전체 좌정렬 → 배지 left-edge가 모든 행에서 같은 세로선.
 *
 * 검증 결과(grep): 위 3점은 이미 충족된 상태 —
 *   AC1(초/재): cde6850a(WAITELAPSED-POLISH)에서 VisitBadge 단일글자 라벨 도입.
 *   AC2(좌정렬): cfb241d4(BADGEFIX)에서 [배지+이름] flex 컨테이너 justify-start + 이름 text-left.
 * 따라서 본 ticket은 reporter 최종 확정값을 '불변 invariant'로 박제하는 회귀 락(추가 src 변경 없음).
 *
 * 컴포넌트가 auth/DB에 의존하므로 렌더 정본(DoctorCallDashboard.tsx)을 직접 읽어 정적 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorCallDashboard.tsx');
const src = readFileSync(SRC, 'utf-8');

test.describe('CHOJAE-TAG-LEFTBLOCK — 시나리오1: 배지 라벨 단일글자 축약', () => {
  test('VisitBadge 표시 라벨이 초/재/체(단일글자) — 풀텍스트 라벨 0건', () => {
    // 표시 라벨(label)은 단일글자. full(title hover 풀이)은 초진/재진/체험 유지.
    expect(src).toContain("new: { label: '초', full: '초진', cls: 'bg-blue-100 text-blue-700' }");
    expect(src).toContain("returning: { label: '재', full: '재진', cls: 'bg-emerald-100 text-emerald-700' }");
    expect(src).toContain("experience: { label: '체', full: '체험', cls: 'bg-purple-100 text-purple-700' }");
    // 표시 라벨로 풀텍스트가 다시 새는 회귀 차단
    expect(src).not.toContain("label: '초진'");
    expect(src).not.toContain("label: '재진'");
  });

  test('배지 렌더는 label(단일글자)만 출력, title=full(풀이) 유지', () => {
    expect(src).toMatch(/title=\{full\}[\s\S]*?\{label\}/);
    expect(src).toContain('data-testid="doctor-visit-badge"');
  });
});

test.describe('CHOJAE-TAG-LEFTBLOCK — 시나리오2: [배지+이름] 블록 좌정렬(배지 세로 일치)', () => {
  test('[배지+이름] 컨테이너 justify-start (활성/진료완료 두 행) — 중앙정렬 잔재 0', () => {
    const startHits = [...src.matchAll(/flex items-center justify-start gap-1\.5/g)].length;
    expect(startHits).toBeGreaterThanOrEqual(2);
    // 중앙정렬이면 이름 길이에 따라 배지가 밀려 세로선 흔들림 → 0건이어야 함
    expect(src).not.toContain('flex items-center justify-center gap-1.5');
  });

  test('이름 버튼 text-left (배지 우측 이어붙음 + 블록 전체 좌정렬), text-center 잔재 0', () => {
    const leftHits = [...src.matchAll(/min-w-\[4rem\] break-keep text-left/g)].length;
    expect(leftHits).toBeGreaterThanOrEqual(2);
    expect(src).not.toContain('min-w-[4rem] break-keep text-center');
  });

  test('배지(VisitBadge)가 이름 버튼보다 먼저 = 블록 최좌측 (우측 슬롯 이동 금지)', () => {
    // 두 행 모두 컨테이너 내부에서 VisitBadge → name-chart-btn 순서
    expect(src).toMatch(/<VisitBadge visitType=\{checkIn\.visit_type\} \/>[\s\S]*?data-testid="doctor-call-name-chart-btn"/);
    expect(src).toMatch(/<VisitBadge visitType=\{checkIn\.visit_type\} \/>[\s\S]*?data-testid="doctor-completed-name-chart-btn"/);
  });
});

test.describe('CHOJAE-TAG-LEFTBLOCK — 시나리오3: 회귀 가드 (변경 없어야 함)', () => {
  test('초/재/체 분류 배지 배경색(cls) 불변', () => {
    expect(src).toContain("cls: 'bg-blue-100 text-blue-700'");
    expect(src).toContain("cls: 'bg-emerald-100 text-emerald-700'");
    expect(src).toContain("cls: 'bg-purple-100 text-purple-700'");
  });

  test('이름 클릭 → 진료차트 진입(onOpenChart full) 동선 + testid 보존', () => {
    expect(src).toContain("onOpenChart(checkIn.customer_id, 'full')");
    expect(src).toContain('data-testid="doctor-call-name-chart-btn"');
    expect(src).toContain('data-testid="doctor-completed-name-chart-btn"');
  });

  test('SELECT(visit_type 등) 데이터 소스 무변경 (분류 판정 입력 불변)', () => {
    expect(src).toContain('customer_id, customer_name, visit_type, status, status_flag');
  });
});
