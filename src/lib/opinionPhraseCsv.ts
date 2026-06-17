/**
 * T-20260617-foot-DOCPHRASE-CSV-BULK-HISTORY
 * 서류 상용구(소견서/진단서) CSV 대량입출력 + dry-run diff 유틸 (무의존 — 외부 라이브러리 없음).
 *
 * 데이터 모델: form_templates(form_key='opinion_doc').field_map.sections = OpinionSection[]
 *   OpinionSection = { title, options: OpinionOption[] }
 *   OpinionOption  = { key, label, phrase }
 *
 * 규칙(customerCsv.ts 패턴 계승):
 *  - 무의존: 브라우저 Blob 다운로드 + 자체 CSV 파서(papaparse 등 신규 npm 미도입 — AC-7).
 *  - UTF-8 BOM 선두 부착 → Excel(한글) 인코딩 깨짐 방지.
 *  - 인용/콤마/개행/이스케이프 따옴표(2배) 모두 처리.
 *  - CSV import 는 비파괴: CSV 에 없는 옵션은 삭제하지 않음(데이터 보호, 리스크#4).
 *    CSV 의 행은 추가(add) 또는 변경(change)만 유발. 삭제는 기존 CRUD UI 로만.
 */

import type { OpinionSection, OpinionOption } from '@/components/doctor/OpinionDocTab';

// ---------------------------------------------------------------------------
// CSV 컬럼 (현장 가독성 — 한글 헤더). 순서 고정 = export/parse 동일.
//   옵션KEY = round-trip 매칭용 안정 식별자(빈 칸이면 신규 추가로 간주).
// ---------------------------------------------------------------------------
export const PHRASE_CSV_HEADERS = ['섹션', '옵션KEY', '버튼이름', '삽입멘트'] as const;

export interface PhraseCsvRow {
  section: string;
  key: string;
  label: string;
  phrase: string;
  line: number; // 1-base CSV 데이터 행 번호(헤더 제외) — 오류 표기용.
}

// ── CSV 셀 이스케이프 (customerCsv.ts 와 동일 규칙) ──
function escapeCsvCell(value: string): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 현행 sections → CSV 양식 문자열 (헤더 + 현행 값 채움, CRLF — Excel 호환).
 * AC-3: 빈 양식이 아니라 현행 버튼라벨·삽입멘트가 채워진 상태.
 */
export function buildPhraseCsv(sections: OpinionSection[]): string {
  const lines: string[] = [];
  lines.push(PHRASE_CSV_HEADERS.map(escapeCsvCell).join(','));
  for (const sec of sections) {
    for (const opt of sec.options) {
      lines.push(
        [sec.title, opt.key, opt.label, opt.phrase].map(escapeCsvCell).join(','),
      );
    }
  }
  return lines.join('\r\n');
}

/** sections → CSV 파일 다운로드 (무의존, UTF-8 BOM). */
export function downloadPhraseCsv(sections: OpinionSection[], filename: string): void {
  const csv = buildPhraseCsv(sections);
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 오늘 날짜 → 파일명 (예: "서류상용구_양식_20260617"). */
export function phraseCsvFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `서류상용구_양식_${y}${m}${d}`;
}

// ---------------------------------------------------------------------------
// 자체 CSV 파서 — 인용/콤마/개행/이스케이프따옴표 처리. RFC4180 근사.
//   반환: string[][] (각 행의 셀 배열). 빈 입력 → [].
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  // BOM 제거.
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // CRLF or lone CR → 행 종료.
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
      i += src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // 마지막 셀/행 flush (파일이 개행으로 끝나지 않을 때).
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // 완전 빈 행 제거.
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/**
 * CSV 텍스트 → PhraseCsvRow[].
 * 헤더 행(섹션/옵션KEY/버튼이름/삽입멘트)을 컬럼 인덱스로 매핑(순서 무관 + 헤더 누락 방어).
 * 헤더가 인식 불가하면 throw.
 */
export function parsePhraseCsv(text: string): PhraseCsvRow[] {
  const matrix = parseCsv(text);
  if (matrix.length === 0) return [];
  const header = matrix[0].map((h) => h.trim());
  const idxOf = (name: string) => header.findIndex((h) => h === name);
  const ci = {
    section: idxOf('섹션'),
    key: idxOf('옵션KEY'),
    label: idxOf('버튼이름'),
    phrase: idxOf('삽입멘트'),
  };
  if (ci.section < 0 || ci.label < 0 || ci.phrase < 0) {
    throw new Error('CSV 헤더를 인식할 수 없습니다. 양식 다운로드로 받은 파일을 사용해주세요. (필수 칼럼: 섹션 / 버튼이름 / 삽입멘트)');
  }
  const out: PhraseCsvRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    const get = (c: number) => (c >= 0 && c < cells.length ? (cells[c] ?? '').trim() : '');
    out.push({
      section: get(ci.section),
      key: get(ci.key),
      label: get(ci.label),
      phrase: get(ci.phrase),
      line: r, // 데이터 행 번호(1=첫 데이터행).
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// dry-run diff (AC-4) — 현행 sections 대비 CSV 행을 add/change/unchanged/error 로 분류.
//   매칭 기준: 옵션KEY(템플릿 전역 안정 식별자). KEY 비었거나 미발견 → 신규 추가(add).
// ---------------------------------------------------------------------------
export type ImportItemType = 'add' | 'change' | 'unchanged' | 'error';

export interface ImportPlanItem {
  type: ImportItemType;
  line: number;
  section: string;
  key: string;
  label: string;
  phrase: string;
  oldLabel?: string;
  oldPhrase?: string;
  error?: string;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  added: number;
  changed: number;
  unchanged: number;
  errors: number;
}

/** 현행 sections 에서 key → 옵션 위치/값 맵. */
function buildKeyIndex(sections: OpinionSection[]) {
  const map = new Map<string, { sectionTitle: string; opt: OpinionOption }>();
  for (const sec of sections) {
    for (const opt of sec.options) {
      if (opt.key) map.set(opt.key, { sectionTitle: sec.title, opt });
    }
  }
  return map;
}

export function computeImportPlan(
  currentSections: OpinionSection[],
  rows: PhraseCsvRow[],
): ImportPlan {
  const keyIndex = buildKeyIndex(currentSections);
  const items: ImportPlanItem[] = [];
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  let errors = 0;

  for (const row of rows) {
    const { section, key, label, phrase, line } = row;
    // 필수 칼럼 검증.
    if (!section) {
      items.push({ type: 'error', line, section, key, label, phrase, error: '섹션이 비어 있습니다.' });
      errors++;
      continue;
    }
    if (!label) {
      items.push({ type: 'error', line, section, key, label, phrase, error: '버튼이름이 비어 있습니다.' });
      errors++;
      continue;
    }
    if (!phrase) {
      items.push({ type: 'error', line, section, key, label, phrase, error: '삽입멘트가 비어 있습니다.' });
      errors++;
      continue;
    }

    const existing = key ? keyIndex.get(key) : undefined;
    if (existing) {
      if (existing.opt.label === label && existing.opt.phrase === phrase) {
        items.push({ type: 'unchanged', line, section, key, label, phrase });
        unchanged++;
      } else {
        items.push({
          type: 'change',
          line,
          section,
          key,
          label,
          phrase,
          oldLabel: existing.opt.label,
          oldPhrase: existing.opt.phrase,
        });
        changed++;
      }
    } else {
      // KEY 비었거나 현행에 없음 → 신규 추가(커밋 시 안정 key 생성).
      items.push({ type: 'add', line, section, key, label, phrase });
      added++;
    }
  }

  return { items, added, changed, unchanged, errors };
}

// ---------------------------------------------------------------------------
// 반영(commit) 적용 — plan 의 add/change 를 현행 sections 에 비파괴 적용.
//   반환: 새 sections + 영향받은 옵션 key 목록(phrase_meta 갱신용).
//   - change: key 가 위치한 옵션의 label/phrase 갱신(섹션 이동은 하지 않음 — 예측가능성).
//   - add: 섹션명(title) 일치 섹션에 신규 옵션 append. 섹션 없으면 신규 섹션 생성.
//   - error/unchanged 항목은 무시.
// ---------------------------------------------------------------------------
function genOptionKey(existing: Set<string>): string {
  let key = '';
  do {
    key = `opt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (existing.has(key));
  existing.add(key);
  return key;
}

export function applyPhraseImport(
  currentSections: OpinionSection[],
  plan: ImportPlan,
): { sections: OpinionSection[]; affectedKeys: string[] } {
  // 깊은 복제 — 입력 불변.
  const sections: OpinionSection[] = currentSections.map((s) => ({
    title: s.title,
    options: s.options.map((o) => ({ ...o })),
  }));
  const allKeys = new Set<string>();
  for (const s of sections) for (const o of s.options) if (o.key) allKeys.add(o.key);

  const affected = new Set<string>();

  const findOptByKey = (key: string) => {
    for (const s of sections) {
      const o = s.options.find((x) => x.key === key);
      if (o) return o;
    }
    return null;
  };
  const findOrCreateSection = (title: string): OpinionSection => {
    let sec = sections.find((s) => s.title === title);
    if (!sec) {
      sec = { title, options: [] };
      sections.push(sec);
    }
    return sec;
  };

  for (const item of plan.items) {
    if (item.type === 'change') {
      const opt = item.key ? findOptByKey(item.key) : null;
      if (opt) {
        opt.label = item.label;
        opt.phrase = item.phrase;
        affected.add(opt.key);
      } else {
        // 방어: change 인데 못 찾으면 add 로 강등(데이터 유실 방지).
        const sec = findOrCreateSection(item.section);
        const key = genOptionKey(allKeys);
        sec.options.push({ key, label: item.label, phrase: item.phrase });
        affected.add(key);
      }
    } else if (item.type === 'add') {
      const sec = findOrCreateSection(item.section);
      // CSV 에 KEY 가 적혀있고 전역 미사용이면 그대로 채택, 아니면 생성.
      const key = item.key && !allKeys.has(item.key) ? item.key : genOptionKey(allKeys);
      allKeys.add(key);
      sec.options.push({ key, label: item.label, phrase: item.phrase });
      affected.add(key);
    }
    // unchanged / error → skip.
  }

  return { sections, affectedKeys: [...affected] };
}
