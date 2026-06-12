/**
 * E2E spec — T-20260612-foot-DOCPATIENTLIST-TABLEVIEW
 * 진료환자목록(DoctorPatientList) 테이블뷰 전환 — 진료대시보드 테이블뷰(doctor-call-feed-table)와
 *   동일 디자인 언어(텍스트 위주·버튼 최소화·컬러 단순화·chevron 숨김) 이식.
 *
 * 요청(문지은 대표원장, #풋확장, 2026-06-12): "진료환자목록도 다 테이블뷰로 바꿔"
 *   맥락 = 오늘 배포된 진료대시보드 테이블뷰(DOCDASH-TABLEVIEW-CONVERGE d097fbb +
 *   TABLE-BTN-MINIMIZE 0185822 + 11FIX 213998c) 직후 동일 방향 적용 요청.
 *
 * 확정 스펙(티켓 §3):
 *   (a) 환자 목록 → 테이블뷰(행=환자). table-fixed + colgroup, 진료대시보드 패턴.
 *   (b) 셀 내 액션 버튼 → 텍스트/링크(CELL_ACTION_BTN). 버튼 박스 제거. 클릭 동선 유지.
 *   (c) 컬러 단순화 — 방(치료실) teal 박스 → 무채색(gray) 텍스트. 상태/처방 의미색만 유지.
 *   (d) chevron/드롭다운 화살표 제거 — 행 펼치기 ChevronUp/Down → '처방·경과' 텍스트 토글.
 *
 * ⚠ 회귀 금지(같은 파일 활성 3건 — 기능 보존):
 *   - EXPAND-CLINICAL(field-soak): 펼침 패널 임상경과 인라인 편집(당일 환자) — readOnly={!isToday} 유지.
 *   - EXPAND-COURSE-RXHISTORY(deploy-ready): 펼침 패널 처방내역/임상경과 read 유지.
 *   - SIGNDOCTOR-FILTER(deploy-ready): 서명의사 필터 기능·UI 유지.
 *   → 위 3건은 각자 spec 이 별도 가드(EXPAND-CLINICAL/EXPAND-COURSE/SIGNDOCTOR spec). 본 spec 은
 *     테이블뷰 전환 자체 + 핵심 보존 facet 의 소스 정적 가드(auth/DB 비의존, unit 프로젝트).
 *
 * 검증(티켓 §5 클릭 시나리오 → 소스 정적 가드):
 *   S1: 테이블뷰 정상 표시 — table-fixed/colgroup/thead + 셀 텍스트 액션 + chevron 제거 + 방 무채색.
 *   S2: 펼침 패널 + 인라인 편집 보존(EXPAND-CLINICAL/COURSE 회귀 0).
 *   S3: 서명의사 필터 보존(SIGNDOCTOR-FILTER 회귀 0).
 *   S4: 엣지 — 빈 목록/필터 결과 없음 메시지 보존.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const DPL = () => SRC('components/doctor/DoctorPatientList.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// S1 — 테이블뷰 정상 표시 (행=환자, 텍스트 액션, chevron 제거, 컬러 단순화)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 테이블뷰 정상 표시', () => {
  test('목록 = table-fixed + colgroup + thead (진료대시보드 doctor-call-feed-table 패턴)', () => {
    const src = DPL();
    // 환자 목록이 테이블 구조로 렌더(행=환자). table-fixed 로 열 너비 고정.
    expect(src).toMatch(/<table className="w-full table-fixed text-sm" data-testid="patient-list">/);
    expect(src).toMatch(/<colgroup>/);
    expect(src).toMatch(/<thead>/);
    expect(src).toMatch(/<tbody className="divide-y divide-gray-100" data-testid="patient-list-rows">/);
    // 행=환자: PatientRow 가 <tr data-testid="patient-row"> 로 렌더.
    expect(src).toMatch(/<tr[\s\S]*?data-testid="patient-row"/);
  });

  test('셀 내 액션 = 텍스트/링크(버튼 박스 제거) — CELL_ACTION_BTN 패턴', () => {
    const src = DPL();
    // 진료대시보드와 동일한 텍스트 액션 토큰(박스 없는 underline hover) 정의.
    expect(src).toMatch(/const CELL_ACTION_BTN\s*=/);
    // 확정(1차 액션)도 box 없는 텍스트 강조(teal) — 클릭 동선 유지.
    expect(src).toMatch(/const CELL_ACTION_BTN_PRIMARY\s*=/);
    // 확정 버튼이 <Button> box 가 아닌 <button className={CELL_ACTION_BTN_PRIMARY}> 텍스트 액션.
    expect(src).toMatch(/data-testid="confirm-prescription-btn"[\s\S]*?확정/);
    expect(src).toMatch(/className=\{CELL_ACTION_BTN_PRIMARY\}/);
    // 펼치기 토글이 텍스트 액션(CELL_ACTION_BTN).
    expect(src).toMatch(/data-testid="patient-expand-toggle"/);
  });

  test('chevron(ChevronUp/Down) 제거 — 펼치기 = 텍스트 토글(처방·경과)', () => {
    const src = DPL();
    // 행 펼치기 ChevronUp/ChevronDown 아이콘 제거(기본 화면 chevron 미노출).
    expect(src).not.toMatch(/ChevronUp/);
    expect(src).not.toMatch(/ChevronDown/);
    // 대체: '처방·경과' / '닫기' 텍스트 토글.
    expect(src).toMatch(/expanded \? '닫기' : '처방·경과'/);
    // 날짜 이동(전/후)은 기능 컨트롤이라 ChevronLeft/Right 는 유지(나비게이션 — 셀 난잡함 아님).
    expect(src).toMatch(/ChevronLeft/);
    expect(src).toMatch(/ChevronRight/);
  });

  test('컬러 단순화 — 방(치료실) teal 박스 → 무채색(gray) 텍스트', () => {
    const src = DPL();
    // 방 셀: 이전 teal-50/teal-700 박스 배지 제거 → gray 텍스트(MapPin gray)로 단순화.
    const roomBlock = src.match(/data-testid="patient-room-cell"[\s\S]*?data-testid="patient-room">-<\/span>/);
    expect(roomBlock, 'patient-room-cell 블록 존재').not.toBeNull();
    expect(roomBlock![0]).not.toMatch(/bg-teal-50/);
    expect(roomBlock![0]).toMatch(/text-gray-600/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — 펼침 패널 + 인라인 편집 보존 (회귀 가드: EXPAND-CLINICAL / EXPAND-COURSE-RXHISTORY)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 펼침 패널/인라인 편집 보존', () => {
  test('펼침 3블록(QuickRx/RxConfirmed/임상경과) 가드 리터럴 보존', () => {
    const src = DPL();
    // 테이블 전환 후에도 펼침 조건 분기 리터럴 보존(EXPAND-CLINICAL/COURSE spec 의존).
    expect(src).toMatch(/\{expanded && !isConfirmed && \(/);
    expect(src).toMatch(/\{expanded && isConfirmed && \(/);
    expect(src).toMatch(/\{expanded && \(/);
    // 펼침 testid 보존.
    expect(src).toContain('data-testid="patient-expand-detail"');
    expect(src).toContain('data-testid="expand-rx-history"');
    expect(src).toContain('data-testid="expand-clinical-course"');
    expect(src).toContain('data-testid="expand-clinical-na"');
  });

  test('임상경과 인라인 편집 = readOnly={!isToday} 보존 (당일 환자만 수정 — field-soak 무효화 금지)', () => {
    const src = DPL();
    const block = src.match(/data-testid="expand-clinical-course"[\s\S]*?\/>\s*<\/div>/);
    expect(block, 'expand-clinical-course 블록 존재').not.toBeNull();
    // MedicalChartPanel embed clinical + readOnly={!isToday} (당일만 편집) 보존.
    expect(block![0]).toMatch(/variant="clinical"/);
    expect(block![0]).toMatch(/readOnly=\{!isToday\}/);
  });

  test('펼침 블록은 테이블 colSpan 행으로 래핑 — 표시 컨테이너만 재구성', () => {
    const src = DPL();
    // 펼침은 별도 <tr><td colSpan={ACTIVE_COLS}> 행(테이블 구조 정합). 내부 블록·게이트 불변.
    expect(src).toMatch(/const ACTIVE_COLS = 5/);
    expect(src).toMatch(/colSpan=\{ACTIVE_COLS\}/);
    // QuickRxBar / RxConfirmedSummary onOpenChart 배선 보존(귀가 차단 동선 — RXCANCEL-GATE).
    expect(src).toMatch(/<QuickRxBar[\s\S]*?onOpenChart=\{onOpenChart\}/);
    expect(src).toMatch(/<RxConfirmedSummary[\s\S]*?onOpenChart=\{onOpenChart\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — 서명의사 필터 보존 (회귀 가드: SIGNDOCTOR-FILTER)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 — 서명의사 필터 보존', () => {
  test('서명의사 필터 UI(select) + 필터 적용 로직 보존', () => {
    const src = DPL();
    // 필터 UI(드롭다운) 보존 — 테이블 전환과 독립(헤더 영역).
    expect(src).toContain('data-testid="signdoctor-filter"');
    expect(src).toContain('data-testid="signdoctor-select"');
    // 필터 적용 = byCustomer(서명 진료의 인덱스) 매핑 로직 보존.
    expect(src).toMatch(/effectiveDoctorFilter/);
    expect(src).toMatch(/byCustomer\.get\(cid\)\?\.has\(effectiveDoctorFilter\)/);
    // 미서명 옵션 보존.
    expect(src).toMatch(/__unsigned__/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — 엣지: 빈 목록 / 필터 결과 없음
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 — 빈 목록/필터 결과 없음', () => {
  test('빈 상태 메시지 보존(접수 0건 / 조건 없음) — 테이블 미렌더 분기', () => {
    const src = DPL();
    // sorted.length === 0 → 빈 안내(테이블 대신). 전체/필터 분기 메시지 보존.
    expect(src).toMatch(/sorted\.length === 0 \?/);
    expect(src).toMatch(/접수된 환자가 없습니다/);
    expect(src).toMatch(/해당 조건의 환자가 없습니다/);
  });
});
