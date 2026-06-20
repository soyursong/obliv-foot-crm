/**
 * E2E spec — T-20260620-foot-MEDCHART-ICONS-REMOVE-ALL (FE-only, DB 무변경, cosmetic)
 *
 * 원장(문지은, U0ALGAAAJAV) 요청 + REFINED:
 *   "글자 옆에 붙은 장식 아이콘(이모지)만 제거. 아이콘만 있는 기능 버튼
 *    (닫기 ✕, 편집 ✏, 이동 ← → 등)은 건드리지 않음(대체·제거 금지, 원형 보존)."
 *
 * 대상 surface = 진료차트 패널(MedicalChartPanel) + 그 자식 약품 폴더 트리(DrugFolderTree).
 *
 *   AC-1: 텍스트 라벨 옆 장식 아이콘/이모지 제거(글자는 유지).
 *   AC-2(보존가드): 텍스트 없는 아이콘-only 기능 버튼은 원형 보존.
 *   AC-3: 아이콘 제거로 레이아웃 깨짐 없음 — 해당 라벨 텍스트는 그대로 존재.
 *   AC-4(회귀가드): import 정리(미사용 장식 아이콘 import 0). 동작 코드 무변경(표시만).
 *
 * 방식: 정적 소스 분석 — 진료차트 surface 소스에서 (a) 제거 대상 장식 아이콘 부재,
 *       (b) 보존 대상 기능 아이콘 존재, (c) 라벨 텍스트 존속을 검증한다.
 *       (PANEL-CLARITY spec 동일 패턴 — cosmetic 변경은 소스 단언으로 회귀를 잡는다.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PANEL_SRC = readFileSync(
  resolve(__dir, '../../src/components/MedicalChartPanel.tsx'),
  'utf-8',
);
const DRUGTREE_SRC = readFileSync(
  resolve(__dir, '../../src/components/doctor/DrugFolderTree.tsx'),
  'utf-8',
);

// 진료차트 import 선언부(첫 lucide-react import 줄)만 추출해 미사용 import 검증.
const lucideImportLine = (src: string): string => {
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/);
  return m ? m[1] : '';
};

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / AC-4: 텍스트 라벨 옆 장식 아이콘 제거 + import 정리
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1/AC-4 장식 아이콘 제거 (MedicalChartPanel)', () => {
  // 텍스트 라벨과 함께 있던 장식 아이콘들 — JSX 사용처가 0이어야 한다.
  const removedDecorative = [
    'Sparkles',     // 슈퍼문구 옵션 / 묶음처방 옵션 라벨 prefix
    'Stethoscope',  // '진료차트' 헤더 / 현재의사명 / '진료경과' 라벨 prefix
    'FileText',     // '본 차트 열기' 버튼 텍스트 prefix
    'Plus',         // '새 기록' 버튼 텍스트 prefix
    'EyeOff',       // '삭제된 차트 보기/숨기기' 토글 텍스트 prefix
    'AlertTriangle',// '금기증 확인/조회 실패' 다이얼로그 헤더 텍스트 prefix
    'BookOpen', 'Camera', 'FlaskConical', 'FolderTree', 'History', // 제거되어 미사용
  ];
  for (const icon of removedDecorative) {
    test(`<${icon} /> 장식 아이콘 사용처 0 (JSX)`, () => {
      expect(PANEL_SRC).not.toMatch(new RegExp(`<${icon}[\\s/>]`));
    });
    test(`${icon} lucide import 제거 (미사용 import 0)`, () => {
      const names = lucideImportLine(PANEL_SRC).split(',').map((s) => s.trim());
      expect(names).not.toContain(icon);
    });
  }

  // Pill: '묶음처방' 섹션 헤더 텍스트 prefix(장식)는 제거됐지만,
  //       타임라인 처방 마커(텍스트 대체용 아이콘-only, AC3-3)는 보존 → import는 유지.
  test('Pill 장식 prefix 제거됐지만 처방 마커는 보존 → import 유지', () => {
    expect(lucideImportLine(PANEL_SRC).split(',').map((s) => s.trim())).toContain('Pill');
    expect(PANEL_SRC).toContain('timeline-rx-pill-icon'); // 마커 보존
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2(보존가드): 텍스트 없는 아이콘-only 기능 버튼은 원형 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 아이콘-only 기능 버튼 보존', () => {
  const preserved: Array<[string, string]> = [
    ['X', '닫기/제거(✕)'],
    ['Edit2', '편집(✏)'],
    ['ChevronLeft', '이동(←)'],
    ['ChevronRight', '이동(→)'],
    ['Check', '문구 즉시삽입(✓)'],
    ['Trash2', '진료기록 삭제 버튼'],
    ['ChevronDown', '아코디언/펼침 토글'],
    ['Search', '검색 입력 아이콘'],
    ['Loader2', '로딩 스피너(기능)'],
  ];
  for (const [icon, desc] of preserved) {
    test(`<${icon} /> 보존 — ${desc}`, () => {
      expect(PANEL_SRC).toMatch(new RegExp(`<${icon}[\\s/>]`));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 라벨 텍스트는 그대로 존속(아이콘만 제거, 글자 유지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 라벨 텍스트 존속(글자 유지)', () => {
  const keptLabels = ['진료차트', '본 차트 열기', '새 기록', '진료경과', '묶음처방'];
  for (const label of keptLabels) {
    test(`라벨 "${label}" 텍스트 존속`, () => {
      expect(PANEL_SRC).toContain(label);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DrugFolderTree(진료차트 처방세트 탭) — 폴더 장식 아이콘 제거, 토글 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('DrugFolderTree 폴더 장식 아이콘 제거 + 토글 보존', () => {
  test('Folder/FolderOpen 폴더명 옆 장식 아이콘 제거(JSX 0)', () => {
    expect(DRUGTREE_SRC).not.toMatch(/<Folder[\s/>]/);
    expect(DRUGTREE_SRC).not.toMatch(/<FolderOpen[\s/>]/);
  });
  test('Folder/FolderOpen lucide import 제거(미사용 0)', () => {
    const names = lucideImportLine(DRUGTREE_SRC).split(',').map((s) => s.trim());
    expect(names).not.toContain('Folder');
    expect(names).not.toContain('FolderOpen');
  });
  test('펼침/접힘 ChevronDown/ChevronRight 토글은 보존', () => {
    expect(DRUGTREE_SRC).toMatch(/<ChevronDown[\s/>]/);
    expect(DRUGTREE_SRC).toMatch(/<ChevronRight[\s/>]/);
  });
});
