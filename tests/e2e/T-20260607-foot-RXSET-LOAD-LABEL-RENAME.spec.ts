/**
 * E2E — T-20260607-foot-RXSET-LOAD-LABEL-RENAME
 * '처방세트 불러오기' → '묶음처방 불러오기' 라벨 변경 (순수 FE, DB/로직 무변경)
 *
 * 현장(문지은 대표원장): "처방세트 불러오기가 아니라 묶음처방 불러오기가 좋을듯해".
 * RX-SET-REDESIGN(deployed)의 '묶음처방' 용어와 정합화. LOAD(불러오기) 인터랙션
 * 사용자 노출 라벨만 변경하고, 관리 엔티티 라벨(admin 처방세트 탭/CRUD,
 * MedicalChartPanel 처방세트 탭, ClinicManagement drug_folders 충돌 라벨)은 미변경
 * (더 넓은 별도 리네임 결정 — 본 티켓 범위 밖).
 *
 * 검증 포인트 (source-level, 비파괴):
 * AC-1: SuperPhrasesTab 처방내역 슬롯 로드 placeholder/안내문 → '묶음처방 불러오기'
 * AC-2: DoctorTreatmentPanel RxSetPicker 다이얼로그 타이틀 → '묶음처방 불러오기'
 * AC-3: DoctorTreatmentPanel 로드 트리거 버튼/빈 상태 안내 → '묶음처방'
 * AC-4: 사용자 노출 'X 불러오기' 형태의 옛 라벨('처방세트 불러오기')이 JSX 텍스트로 잔존하지 않음
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const SUPERPHRASE = path.join(ROOT, 'src/components/admin/SuperPhrasesTab.tsx');
const DOCTORPANEL = path.join(ROOT, 'src/components/doctor/DoctorTreatmentPanel.tsx');

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

/** JSX/문자열 리터럴에 노출되는 라벨만 추출 (주석 줄 제외) */
function nonCommentLines(content: string): string[] {
  return content
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      // 줄/블록/JSX 주석 줄 제외 (사용자 비노출)
      return (
        !t.startsWith('//') &&
        !t.startsWith('*') &&
        !t.startsWith('/*') &&
        !t.startsWith('{/*')
      );
    });
}

test.describe('T-20260607-foot-RXSET-LOAD-LABEL-RENAME — 묶음처방 불러오기 라벨 정합화', () => {
  test('AC-1: SuperPhrasesTab 로드 placeholder/안내문 → 묶음처방 불러오기', () => {
    const c = read(SUPERPHRASE);
    expect(c).toContain('placeholder="묶음처방 불러오기"');
    expect(c).toContain('"묶음처방 불러오기"로 추가');
  });

  test('AC-2: DoctorTreatmentPanel RxSetPicker 타이틀 → 묶음처방 불러오기', () => {
    const c = read(DOCTORPANEL);
    expect(c).toContain('묶음처방 불러오기');
  });

  test('AC-3: DoctorTreatmentPanel 로드 버튼/빈상태 안내 → 묶음처방', () => {
    const c = read(DOCTORPANEL);
    expect(c).toContain('묶음처방이 없습니다.');
    expect(c).toContain('묶음처방을 불러오세요.');
    // 로드 트리거 버튼 라벨
    expect(c).toMatch(/<Pill className="h-3 w-3" \/>\s*묶음처방\s*<\/Button>/);
  });

  test('AC-4: 옛 사용자 노출 라벨 "처방세트 불러오기"가 JSX 텍스트로 잔존하지 않음', () => {
    for (const file of [SUPERPHRASE, DOCTORPANEL]) {
      const visible = nonCommentLines(read(file)).join('\n');
      // 사용자 노출 영역에 옛 로드 라벨이 없어야 함 (주석 내 설명용 잔존은 허용)
      expect(visible).not.toContain('처방세트 불러오기');
      expect(visible).not.toContain('처방세트를 불러오세요');
    }
  });
});
