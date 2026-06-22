/**
 * T-20260622-foot-EDITBTN-NOTVISIBLE-FOLLOWUP
 * 펜차트 '수정 버튼 안 보임' 재발 해소 — 시인성 회귀 가드.
 *
 * triage 결론(증거): 수정버튼은 prod 배포 완료(buildId a6932f06 ⊇ 369a2945,
 *   prod chunk PenChartTab-CJZzCV44.js 에 penchart-edit testid + '수정' title 실재)이고
 *   권한/상태 게이트 없이 무조건 렌더된다 → H2(렌더 누락) 배제.
 *   '안 보임'의 실체 = 반투명바 위 12px 무라벨 펜 아이콘이라 식별난(UX) + 현장 캐시(H1).
 *
 * FOLLOWUP 조치(presentation only): 수정버튼을 아이콘+'수정' 텍스트 라벨 pill 로 승격 +
 *   오버레이 대비 강화(bg-black/40→/60) + 다운로드/삭제 아이콘 한 단계 확대.
 *
 * 본 spec = 소스-컨트랙트 회귀 가드(기존 penchart spec 관례: 로직/소스 검증.
 *   실 브라우저 렌더/현장 confirm 은 supervisor field-soak 단계).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/PenChartTab.tsx'),
  'utf8',
);

// 저장 차트 목록 오버레이 바 블록 추출 (date span ~ 버튼 그룹)
function overlayBarBlock(src: string): string {
  const start = src.indexOf('bg-black/60');
  expect(start, '오버레이 바(bg-black/60) 블록이 소스에 존재해야 함').toBeGreaterThan(-1);
  // 블록 끝: penchart-delete 버튼 닫힘까지 충분히 포함
  const end = src.indexOf('penchart-delete-', start);
  expect(end, 'penchart-delete 버튼이 동일 블록에 존재해야 함').toBeGreaterThan(start);
  return src.slice(start, end + 400);
}

test.describe('EDITBTN-NOTVISIBLE-FOLLOWUP: 수정버튼 시인성', () => {
  test('수정버튼은 여전히 무조건 렌더 — testid 보존(권한/상태 게이트 없음)', () => {
    expect(SRC).toContain('data-testid={`penchart-edit-${chart.name}`}');
    // 편집 핸들러 배선 보존
    expect(SRC).toContain('handleEditChart(chart)');
  });

  test('AC: 수정버튼에 가시 텍스트 라벨 "수정" 추가 (아이콘 단독 아님)', () => {
    const bar = overlayBarBlock(SRC);
    // 펜 아이콘 + '수정' 텍스트 span 동시 존재
    expect(bar).toContain('<Pencil');
    expect(bar).toMatch(/<span>수정<\/span>/);
  });

  test('AC: 수정버튼 pill 어포던스(배경/패딩) — 식별성 확보', () => {
    const bar = overlayBarBlock(SRC);
    // 수정 버튼이 배경 pill(bg-white/20) + 패딩으로 버튼임이 드러남
    expect(bar).toMatch(/bg-white\/20/);
  });

  test('AC: 오버레이 대비 강화 — bg-black/60 (이전 /40 대비 시인성↑)', () => {
    expect(SRC).toContain('bg-black/60');
    // 이전 약한 대비(/40)는 목록 오버레이 바에서 제거됨
    const bar = overlayBarBlock(SRC);
    expect(bar).not.toMatch(/bg-black\/40/);
  });

  test('AC: 다운로드/삭제 버튼 보존 (수정만 변경, 회귀 0)', () => {
    expect(SRC).toContain('data-testid={`penchart-download-${chart.name}`}');
    expect(SRC).toContain('data-testid={`penchart-delete-${chart.name}`}');
    expect(SRC).toContain('handleDelete(chart)');
  });
});
