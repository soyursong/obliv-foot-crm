/**
 * T-20260724-foot-CHART2-TREATREQ-COOR-PERM
 *   2번차트 → 패키지 섹션 → [치료 신청] 체크박스를 coordinator 계정에서도 체크/저장 가능하게 권한 개방.
 *
 * 배경: [치료 신청] 박스(TreatmentRequestBox)의 편집 게이트는 canEditToes prop 하나로 통제된다.
 *   기존 canEditToes = admin || manager || consultant → coordinator 가 read-only 로 막혀 있었음.
 *   변경(ADDITIVE): 조건식에 `|| coordinator` 추가. DB(RLS)는 is_approved_user()(role-무관)라 이미 개방 —
 *   FE 게이트만 정합시키는 FE-only ADDITIVE. 신규 컬럼/테이블/enum 0, db_change:false.
 *
 * 검증 방식: 정적 소스 SSOT 불변식(라이브 env·인증·시드 비의존).
 *   canEditToes 조건식 + 박스 canEdit 배선을 코드 계약으로 고정한다.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');

const CHART = read('src/pages/CustomerChartPage.tsx');

// canEditToes 정의 라인 1개만 추출(단일 정의처 가정).
const CAN_EDIT_LINE = (() => {
  const m = CHART.match(/const canEditToes\s*=\s*[^;]+;/);
  return m ? m[0] : '';
})();

test.describe('T-20260724 CHART2-TREATREQ-COOR-PERM — coordinator [치료 신청] 편집 개방', () => {
  test('canEditToes 정의가 소스에 단일 존재', () => {
    expect(CAN_EDIT_LINE.length).toBeGreaterThan(0);
    expect((CHART.match(/const canEditToes\s*=/g) ?? []).length).toBe(1);
  });

  test('coordinator 가 canEditToes 조건에 ADDITIVE 로 추가됨', () => {
    expect(CAN_EDIT_LINE).toMatch(/profile\?\.role === 'coordinator'/);
  });

  test('회귀 가드 — 기존 admin/manager/consultant 조건 무변경(3개 모두 잔존)', () => {
    expect(CAN_EDIT_LINE).toMatch(/profile\?\.role === 'admin'/);
    expect(CAN_EDIT_LINE).toMatch(/profile\?\.role === 'manager'/);
    expect(CAN_EDIT_LINE).toMatch(/profile\?\.role === 'consultant'/);
  });

  test('무단 확대 금지 — 허용 role 은 정확히 4개(admin/manager/consultant/coordinator)뿐', () => {
    const roles = (CAN_EDIT_LINE.match(/profile\?\.role === '([a-z_]+)'/g) ?? [])
      .map((s) => s.replace(/.*'([a-z_]+)'.*/, '$1'));
    expect(roles.sort()).toEqual(['admin', 'consultant', 'coordinator', 'manager']);
    // OR 결합만 사용(AND 로 좁히거나 부정으로 확대하지 않음)
    expect(CAN_EDIT_LINE).not.toMatch(/&&/);
    expect(CAN_EDIT_LINE).not.toMatch(/!==/);
  });

  test('[치료 신청] 박스(TreatmentRequestBox)의 canEdit 이 canEditToes 로 배선(게이트 연결 유지)', () => {
    expect(CHART).toMatch(/<TreatmentRequestBox[\s\S]*?canEdit=\{canEditToes\}/);
  });
});
