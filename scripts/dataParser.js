#!/usr/bin/env node
/**
 * dataParser.js — foot_cycle(경과분석) 입력 txt 파서 (독립 실행 Node.js 스크립트)
 *
 * 티켓: T-20260818-foot-DATAPARSER-NEW-EMR-FORMAT-CHARTNO-RESLINE
 *   원장(U0ALGAAAJAV) 로컬 실행용 독립 스크립트. obliv-foot-crm 웹앱에 통합되지 않음
 *   (import 무 · DB 무의존 · 순수 텍스트 파싱). 슬랙 스레드 첨부로 전달.
 *
 * ── 무엇을 하나 ──────────────────────────────────────────────────────────
 * 경과분석 대상자의 "날짜별 치료이력 txt"를 읽어 세션(방문×시술타입) 단위로 구조화하고,
 * 회차·준수율·등급을 산출한다. 두 가지 입력 형태를 자동 판별하여 **병행 지원**한다.
 *
 *   [기존 형태] 외부 EMR 내보내기: 회차 N/N 포함 · 출력일 줄 있음 · 예약 라인에 날짜 있음.
 *   [신규 형태] 풋 CRM 경과분석 다운로드(progressTreatmentTxt.ts 산출): 회차 N/N 전무 ·
 *              출력일 줄 없음 · 예약 라인 시간만 · 차트번호 영문+하이픈(F-4696).
 *
 * ── 수용 기준(AC) 대응 ───────────────────────────────────────────────────
 *  AC-1 차트번호 정규식: 영문+하이픈 포함(F-4696) 캡처. 숫자-only 하위호환.      → RE_CHART
 *  AC-2 예약 라인 날짜 없는 경우: 블록 한국날짜를 시술일로 상속. @뒤 이름만 컷.  → RE_RES / parseResLine
 *  AC-3 회차 자동부여: N/N 없으면 치료종류별 방문을 날짜순으로 1,2,3… 부여.
 *                      total 은 파일에 없으면 null 유지(자동추정·역산 금지).      → assignRounds
 *  AC-4 total 없을 때 통계: 준수율·등급을 total 미의존(방문 간격 기준)으로 산출.  → computeStats
 *  AC-5 치료종류 라벨 → 타입 매핑: detectTypes(레이저비가열→laser, 포도/포도로게→podologue …).
 *  AC-6 하위호환 + 신규 형태 판별: detectFormat 로 자동 판별, 공통 파이프라인.
 *
 * ── 사용법 ───────────────────────────────────────────────────────────────
 *   node dataParser.js <파일.txt> [파일2.txt …]     # 각 파일 파싱 → JSON stdout
 *   node dataParser.js --selftest                    # 내장 회귀 테스트(기존+신규 형태)
 *
 * 순수 함수는 module.exports 로 노출(require 하여 별도 테스트 가능).
 */
'use strict';

/* ─────────────────────────── 정규식·상수 ─────────────────────────── */

/**
 * AC-1 차트번호: 영문/숫자로 시작, 이후 영문/숫자/하이픈.
 *   'F-4696' → 'F-4696', '404658' → '404658'(숫자-only 하위호환).
 */
const RE_CHART = /^차트번호\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9-]*)/m;
const RE_NAME = /^환자명\s*[:：]\s*(.+?)\s*$/m;
/** 출력일 줄(기존 형태에만 존재) — 형태 판별 신호. */
const RE_OUTDATE = /^출력일\s*[:：]/m;

/** 날짜 블록 헤더: '2026년 07월 14일 …' */
const RE_BLOCK = /^\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;

/**
 * AC-2 예약 라인(RE_RES): 날짜는 선택(캡처1), 시간은 필수(캡처2), 나머지(캡처3=담당/룸).
 *   신규: ' (예약: 15:30)    @이수빈 / L11'            → 날짜 없음 → 블록 날짜 상속.
 *   기존: ' (예약: 2026-06-14 15:30)  @이수빈 / L11'   → 날짜 있음.
 */
const RE_RES = /^\s*\(예약\s*[:：]\s*(?:(\d{4}[-.]\d{1,2}[-.]\d{1,2})\s+)?(\d{1,2}:\d{2})\s*\)\s*(.*)$/;

/** 회차 토큰 N/N: '회차: 3/10' 또는 라인 내 '(3/10)'. 기존 형태에만 통상 존재. */
const RE_ROUND_LABELED = /회차\s*[:：]\s*(\d+)\s*\/\s*(\d+)/;
const RE_ROUND_INLINE = /\((\d+)\s*\/\s*(\d+)\)/;

/** 메모 라벨 라인: '간략메모: …', '치료종류: …', 'PC(프리컨디셔닝): …' 등. */
const RE_MEMO_LABEL = /^\s*([^\s:：\[\]][^:：]*?)\s*[:：]\s*(.*)$/;

/** 무시할 푸터/구분선. */
const RE_FOOTER = /^[\s─\-=_]*경과분석 치료이력|^[─\-=_]{5,}\s*$/;

/**
 * AC-4 준수율 산출 기준(방문 간격). total 미의존.
 *   레이저 계열 권장 재방문 간격의 draft 기준값 — 실 임상 기준 확정 시 이 상수만 조정.
 *   (원장 iterate 대상: 실 샘플 도착 후 정합 검증하며 튜닝)
 */
const RECOMMENDED_INTERVAL_DAYS = 14; // 권장 재방문 간격(일)
const INTERVAL_TOLERANCE_DAYS = 4; // 허용 오차(±)

/* ─────────────────────────── AC-5 detectTypes ─────────────────────────── */

/**
 * 치료종류 라벨 → 내부 타입 매핑(기존 detectTypes 규칙 유지).
 *   code  = session_type 코드(progressTreatmentCsv.SESSION_TYPE_LABEL 와 정합).
 *   family= 회차 그룹핑/통계 축(레이저 가열·비가열은 'laser' 로 합산).
 * 순서 중요: 구체적 키워드 먼저(레이저비가열 → 비가열 오탐 방지).
 */
const TYPE_ALIASES = [
  { code: 'unheated_laser', family: 'laser', kws: ['레이저비가열', '비가열'] },
  { code: 'heated_laser', family: 'laser', kws: ['레이저가열', '가열'] },
  { code: 'podologue', family: 'podologue', kws: ['포도로게', '포도', '발톱교정', '내성', 'podolog'] },
  { code: 'ribbon', family: 'ribbon', kws: ['각질', '리본', 'ribbon'] },
  { code: 'preconditioning', family: 'pc', kws: ['프리컨디셔닝'] },
  { code: 'iv', family: 'iv', kws: ['수액'] },
  { code: 'trial', family: 'trial', kws: ['체험'] },
  { code: 'reborn', family: 'reborn', kws: ['re:born', 'reborn'] },
];

const TYPE_LABEL = {
  unheated_laser: '레이저비가열',
  heated_laser: '레이저가열',
  podologue: '발톱교정',
  ribbon: '각질',
  preconditioning: '프리컨디셔닝',
  iv: '수액',
  trial: '체험',
  reborn: 'Re:Born',
};

/** 레이저 계열(힐러 판정 대상 한정). */
const LASER_FAMILY = 'laser';

/**
 * AC-5: 치료종류 라벨 문자열 → 타입 배열.
 * 라벨 없으면 [](억지 생성 금지). 콤마/슬래시 구분 복수 타입 지원.
 *
 * 토큰 단위 **최초 1건 매칭**: 한 토큰은 하나의 타입에만 귀속(TYPE_ALIASES 순서 = 우선순위).
 *   → '레이저비가열'이 '가열' 부분문자열로 heated_laser 에 이중매칭되는 오류 방지
 *     (unheated_laser 를 먼저 검사하고, 매칭되면 그 토큰은 종료).
 * @param {string} label 예: '레이저비가열, 발톱교정'
 * @returns {{code:string,family:string,label:string}[]}
 */
function detectTypes(label) {
  if (!label || !label.trim()) return [];
  const tokens = label.split(/[,/·]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const found = [];
  const seen = new Set();
  for (const tok of tokens) {
    for (const a of TYPE_ALIASES) {
      if (a.kws.some((kw) => tok.includes(kw.toLowerCase()))) {
        if (!seen.has(a.code)) {
          seen.add(a.code);
          found.push({ code: a.code, family: a.family, label: TYPE_LABEL[a.code] });
        }
        break; // 토큰당 최초 1건만 — 이중매칭 방지
      }
    }
  }
  return found;
}

/* ─────────────────────────── 형태 판별(AC-6) ─────────────────────────── */

/**
 * 기존/신규 형태 자동 판별.
 *   기존 신호(하나라도 참) → 'old': 출력일 줄 존재 / 예약 라인에 날짜 존재 / N/N 회차 존재.
 *   그 외 → 'new'.
 * (신규 형태는 세 신호 모두 부재가 정의.)
 * @param {string} text 원문
 * @returns {'old'|'new'}
 */
function detectFormat(text) {
  if (RE_OUTDATE.test(text)) return 'old';
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = RE_RES.exec(line);
    if (m && m[1]) return 'old'; // 날짜 있는 예약 라인
    if (RE_ROUND_LABELED.test(line) || RE_ROUND_INLINE.test(line)) return 'old';
  }
  return 'new';
}

/* ─────────────────────────── 파싱 ─────────────────────────── */

/** 'YYYY-MM-DD' 정규화(구분자 . 또는 - 허용, 월/일 zero-pad). null 안전. */
function normDate(y, m, d) {
  return `${y}-${String(+m).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
}
function normDateStr(s) {
  const m = /^(\d{4})[-.](\d{1,2})[-.](\d{1,2})/.exec(s || '');
  return m ? normDate(m[1], m[2], m[3]) : null;
}

/**
 * AC-2: 예약 라인 나머지(담당/룸) 파싱. '@이수빈 / L11' → { author:'이수빈', room:'L11' }.
 *   '@이수빈' → author only. 'L11' → room only. '—' → 둘 다 null.
 * @param {string} rest RE_RES 캡처3
 */
function parseResRest(rest) {
  const out = { author: null, room: null };
  const s = (rest || '').trim();
  if (!s || s === '—' || s === '-') return out;
  if (s.startsWith('@')) {
    // '@이수빈 / L11' 또는 '@이수빈'
    const slash = s.indexOf('/');
    if (slash >= 0) {
      out.author = s.slice(1, slash).trim() || null;
      out.room = s.slice(slash + 1).trim() || null;
    } else {
      out.author = s.slice(1).trim() || null;
    }
  } else {
    // 담당자 없이 룸만
    const slash = s.indexOf('/');
    out.room = (slash >= 0 ? s.slice(slash + 1) : s).trim() || null;
  }
  return out;
}

/**
 * 원문 → 헤더 + 블록 목록(Pass1).
 * 각 블록: { date, time, resDate, author, room, memoLines[], rawRound, types[] }
 *   rawRound: {current,total} | null (N/N 있을 때만)
 *   types: detectTypes(치료종류 라벨) 결과. 라벨 없으면 [].
 */
function parseBlocks(text) {
  const chartM = RE_CHART.exec(text);
  const nameM = RE_NAME.exec(text);
  const header = {
    chartNumber: chartM ? chartM[1] : null,
    name: nameM ? nameM[1].trim() : null,
  };

  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = null;

  const pushCur = () => {
    if (cur) blocks.push(cur);
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/﻿/g, ''); // BOM 제거
    if (RE_FOOTER.test(line)) continue;

    const bm = RE_BLOCK.exec(line);
    if (bm) {
      pushCur();
      cur = {
        date: normDate(bm[1], bm[2], bm[3]),
        time: '',
        resDate: null,
        author: null,
        room: null,
        memoLines: [],
        rawRound: null,
        types: [],
      };
      continue;
    }
    if (!cur) continue; // 헤더 영역 라인은 무시(차트/환자명은 위에서 캡처)

    // 예약 라인?
    const rm = RE_RES.exec(line);
    if (rm) {
      cur.resDate = rm[1] ? normDateStr(rm[1]) : cur.date; // AC-2: 날짜 없으면 블록 날짜 상속
      cur.time = rm[2];
      const parsed = parseResRest(rm[3]);
      cur.author = parsed.author;
      cur.room = parsed.room;
      // 예약 라인 내 인라인 회차(3/10)도 흡수
      const inl = RE_ROUND_INLINE.exec(rm[3] || '');
      if (inl && !cur.rawRound) cur.rawRound = { current: +inl[1], total: +inl[2] };
      continue;
    }

    // 회차 라벨 라인?
    const roundM = RE_ROUND_LABELED.exec(line);
    if (roundM) {
      cur.rawRound = { current: +roundM[1], total: +roundM[2] };
      continue;
    }

    // 메모 라벨 라인?
    const memoM = RE_MEMO_LABEL.exec(line);
    if (memoM) {
      const labelKey = memoM[1].trim();
      const value = memoM[2].trim();
      // 치료종류 라벨 → detectTypes (진료종류/시술종류 동의어 포함)
      if (/^(치료종류|진료종류|시술종류|시술타입)/.test(labelKey)) {
        cur.types = detectTypes(value);
      }
      cur.memoLines.push(line.trim());
      continue;
    }

    // 그 외 비어있지 않은 라인 → 메모로 보존
    if (line.trim()) cur.memoLines.push(line.trim());
  }
  pushCur();

  return { header, blocks };
}

/* ─────────────────────────── 후처리 파이프라인 ─────────────────────────── */

/**
 * ① 블록 → 세션(방문×시술타입) 평탄화.
 *    치료종류 라벨이 없어(types=[]) 방문만 있는 블록도 Pass2 로 커버(type=null 세션 1건).
 */
function flattenSessions(blocks) {
  const sessions = [];
  for (const b of blocks) {
    const date = b.resDate || b.date; // 시술일 = 예약 라인 날짜(상속 포함), 없으면 블록 날짜
    const base = {
      date,
      time: b.time || '',
      author: b.author,
      room: b.room,
      memoLines: b.memoLines,
      rawRound: b.rawRound,
    };
    if (b.types.length === 0) {
      // Pass2: 예약만 있고 치료종류 미상 → 단일 세션(type=null)
      sessions.push({ ...base, type: null, family: null, typeLabel: null });
    } else {
      for (const t of b.types) {
        sessions.push({ ...base, type: t.code, family: t.family, typeLabel: t.label });
      }
    }
  }
  return sessions;
}

/**
 * ② 날짜순 정렬(안정 — 동일 날짜는 입력 순서 유지).
 */
function sortByDate(sessions) {
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.date < b.s.date ? -1 : a.s.date > b.s.date ? 1 : a.i - b.i))
    .map((x) => x.s);
}

/**
 * ③ AC-3 회차 자동부여.
 *    rawRound(N/N) 있으면 그대로 사용(current/total).
 *    없으면 치료종류(family)별 방문을 날짜순으로 세어 current = 1,2,3… 부여. total = null.
 *    type=null(치료종류 미상) 세션은 그룹핑 축이 없으므로 회차 미부여(current=null).
 */
function assignRounds(sortedSessions) {
  const counter = Object.create(null);
  for (const s of sortedSessions) {
    if (s.rawRound) {
      s.current = s.rawRound.current;
      s.total = s.rawRound.total;
      s.roundSource = 'file'; // N/N 파일 명시
    } else if (s.family) {
      counter[s.family] = (counter[s.family] || 0) + 1;
      s.current = counter[s.family];
      s.total = null; // AC-3: total 자동추정·역산 금지
      s.roundSource = 'auto';
    } else {
      s.current = null;
      s.total = null;
      s.roundSource = 'none';
    }
  }
  return sortedSessions;
}

/** 두 'YYYY-MM-DD' 간 일수 차. */
function daysBetween(a, b) {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}

/**
 * ④ 방문 간격(직전 동일 family 세션 대비 일수) 산출.
 */
function computeIntervals(sortedSessions) {
  const lastDate = Object.create(null);
  for (const s of sortedSessions) {
    const key = s.family || s.type || '__none__';
    if (lastDate[key]) {
      s.intervalDays = daysBetween(lastDate[key], s.date);
    } else {
      s.intervalDays = null; // 첫 방문
    }
    lastDate[key] = s.date;
  }
  return sortedSessions;
}

/**
 * ⑤ 힐러(털러) 감지.
 *    스펙: 힐러 판정은 N/N·회차 기반 → 신규 형태(회차 자동부여)에는 미적용(정상).
 *    기존 형태(rawRound=file)이면서 레이저 계열일 때만 판정 시도. 그 외 '' (부재, 억지 생성 금지).
 *    ※ txt 에는 힐러 원신호가 없으므로, 기존 형태라도 라인에 명시가 없으면 '' 유지.
 */
function detectHealer(sortedSessions) {
  for (const s of sortedSessions) {
    let healer = '';
    if (s.roundSource === 'file' && s.family === LASER_FAMILY) {
      // 메모 라인에 힐러/털러 명시가 있으면 반영, 없으면 '' (부재).
      const memoJoined = (s.memoLines || []).join(' ');
      if (/힐러|털러|healer/i.test(memoJoined)) {
        healer = /미적용|없음|off|미시행/i.test(memoJoined) ? '미적용' : '적용';
      }
    }
    s.healer = healer;
  }
  return sortedSessions;
}

/**
 * ⑥ AC-4 통계(family 별) — total 미의존, 방문 간격 기준.
 *    complianceRate = 권장 간격(±허용오차) 안에 든 간격 비율.
 *    grade = 준수율 구간 매핑. progressRate = total 있으면 max(current)/total, 없으면 null.
 */
function computeStats(sortedSessions) {
  const byFamily = Object.create(null);
  for (const s of sortedSessions) {
    const key = s.family || '(미상)';
    if (!byFamily[key]) {
      byFamily[key] = { family: key, count: 0, intervals: [], maxCurrent: 0, total: null };
    }
    const g = byFamily[key];
    g.count += 1;
    if (typeof s.intervalDays === 'number') g.intervals.push(s.intervalDays);
    if (typeof s.current === 'number') g.maxCurrent = Math.max(g.maxCurrent, s.current);
    if (typeof s.total === 'number') g.total = s.total;
  }

  const stats = {};
  const lo = RECOMMENDED_INTERVAL_DAYS - INTERVAL_TOLERANCE_DAYS;
  const hi = RECOMMENDED_INTERVAL_DAYS + INTERVAL_TOLERANCE_DAYS;
  for (const key of Object.keys(byFamily)) {
    const g = byFamily[key];
    let complianceRate = null;
    let grade = null;
    if (g.intervals.length > 0) {
      const onTime = g.intervals.filter((d) => d >= lo && d <= hi).length;
      complianceRate = Math.round((onTime / g.intervals.length) * 100) / 100;
      grade = gradeFromRate(complianceRate);
    }
    stats[key] = {
      family: key,
      visitCount: g.count,
      currentRound: g.maxCurrent || null,
      total: g.total, // AC-3: 신규 형태 null
      progressRate: g.total ? Math.round((g.maxCurrent / g.total) * 100) / 100 : null,
      avgIntervalDays: g.intervals.length
        ? Math.round((g.intervals.reduce((a, b) => a + b, 0) / g.intervals.length) * 10) / 10
        : null,
      complianceRate, // AC-4: 방문 간격 기반(total 미의존)
      grade,
    };
  }
  return stats;
}

/** 준수율(0~1) → 등급. draft 기준(원장 iterate 대상). */
function gradeFromRate(rate) {
  if (rate == null) return null;
  if (rate >= 0.9) return 'A';
  if (rate >= 0.75) return 'B';
  if (rate >= 0.5) return 'C';
  return 'D';
}

/* ─────────────────────────── 엔트리 ─────────────────────────── */

/**
 * 원문 txt → 구조화 결과.
 *   { format, chartNumber, name, visitCount, sessions[], stats{} }
 * 후처리 순서 ①~⑥ 불변: flatten → sort → assignRounds → intervals → healer → stats.
 */
function parse(text) {
  const format = detectFormat(text); // AC-6
  const { header, blocks } = parseBlocks(text);

  let sessions = flattenSessions(blocks); // ①
  sessions = sortByDate(sessions); // ②
  sessions = assignRounds(sessions); // ③ AC-3
  sessions = computeIntervals(sessions); // ④
  sessions = detectHealer(sessions); // ⑤
  const stats = computeStats(sessions); // ⑥ AC-4

  return {
    format,
    chartNumber: header.chartNumber, // AC-1
    name: header.name,
    visitCount: new Set(sessions.map((s) => s.date + '|' + (s.time || ''))).size,
    sessions: sessions.map((s) => ({
      date: s.date,
      time: s.time,
      type: s.type,
      typeLabel: s.typeLabel,
      family: s.family,
      current: s.current,
      total: s.total,
      roundSource: s.roundSource,
      intervalDays: s.intervalDays,
      healer: s.healer,
      author: s.author,
      room: s.room,
      memoLines: s.memoLines,
    })),
    stats,
  };
}

module.exports = {
  parse,
  detectFormat,
  detectTypes,
  parseBlocks,
  parseResRest,
  assignRounds,
  computeStats,
  RE_CHART,
  RE_RES,
};

/* ─────────────────────────── 내장 회귀 테스트 ─────────────────────────── */

/** 신규 형태 fixture(F-4696) — progressTreatmentTxt.ts 산출 골격 준용. */
const FIXTURE_NEW = `차트번호 : F-4696
환자명 : 허유희

2026년 07월 14일    [예약/접수메모]
간략메모: 첫 방문
치료종류: 레이저비가열
PC(프리컨디셔닝): 있음
 (예약: 15:30)    @이수빈 / L11

2026년 07월 28일    [예약/접수메모]
예약메모: 재방문
치료종류: 레이저비가열
 (예약: 16:00)    @김철수 / L12

2026년 08월 11일    [예약/접수메모]
치료종류: 레이저비가열, 발톱교정
 (예약: 11:00)    @이수빈

──────────────────────────────
경과분석 치료이력 · 생성일 2026-08-17 · 방문 3건`;

/** 기존 형태 fixture — 회차 N/N · 출력일 줄 · 날짜 있는 예약 라인. */
const FIXTURE_OLD = `차트번호 : 404658
환자명 : 최은규
출력일 : 2026-07-01

2026년 06월 14일    [예약/접수메모]
치료종류: 레이저가열
회차: 1/10
 (예약: 2026-06-14 15:30)    @이수빈 / L11

2026년 06월 28일    [예약/접수메모]
치료종류: 레이저가열
회차: 2/10
 (예약: 2026-06-28 15:00)    @이수빈 / L11`;

function assert(cond, msg) {
  if (!cond) throw new Error('SELFTEST FAIL: ' + msg);
}

function selftest() {
  // ── 신규 형태 ──
  const n = parse(FIXTURE_NEW);
  assert(n.format === 'new', `신규 형태 판별(got ${n.format})`);
  assert(n.chartNumber === 'F-4696', `AC-1 영문+하이픈 차트번호(got ${n.chartNumber})`);
  assert(n.name === '허유희', `환자명(got ${n.name})`);
  // AC-2: 날짜 없는 예약 라인 → 블록 날짜 상속
  assert(n.sessions[0].date === '2026-07-14', `AC-2 블록 날짜 상속(got ${n.sessions[0].date})`);
  assert(n.sessions[0].time === '15:30', `AC-2 시간 파싱(got ${n.sessions[0].time})`);
  assert(n.sessions[0].author === '이수빈', `AC-2 @뒤 이름 컷(got ${n.sessions[0].author})`);
  assert(n.sessions[0].room === 'L11', `AC-2 룸 파싱(got ${n.sessions[0].room})`);
  assert(n.sessions[2].author === '이수빈' && n.sessions[2].room === null, 'AC-2 룸 없는 예약 라인');
  // AC-3: laser 회차 자동부여 1,2,3 · total null
  const laser = n.sessions.filter((s) => s.family === 'laser');
  assert(laser.map((s) => s.current).join(',') === '1,2,3', `AC-3 자동 회차(got ${laser.map((s) => s.current)})`);
  assert(laser.every((s) => s.total === null), 'AC-3 total null 유지');
  assert(laser.every((s) => s.roundSource === 'auto'), 'AC-3 roundSource auto');
  // AC-5: detectTypes 복수(레이저비가열 + 발톱교정)
  const day3 = n.sessions.filter((s) => s.date === '2026-08-11');
  assert(day3.some((s) => s.type === 'unheated_laser'), 'AC-5 레이저비가열 매핑');
  assert(day3.some((s) => s.type === 'podologue'), 'AC-5 발톱교정→podologue 매핑');
  // AC-4: 통계 total 미의존 · 준수율/등급 산출(간격 14일 → 준수)
  assert(n.stats.laser.total === null, 'AC-4 laser total null');
  assert(n.stats.laser.progressRate === null, 'AC-4 진도율 null(total 없음)');
  assert(typeof n.stats.laser.complianceRate === 'number', 'AC-4 준수율(간격 기반) 산출');
  assert(n.stats.laser.grade === 'A', `AC-4 등급(14일 간격 = A, got ${n.stats.laser.grade})`);
  // 힐러: 신규 형태 미적용(빈 값)
  assert(laser.every((s) => s.healer === ''), '힐러 신규 형태 미적용(정상)');

  // ── 기존 형태(회귀 게이트) ──
  const o = parse(FIXTURE_OLD);
  assert(o.format === 'old', `AC-6 기존 형태 판별(got ${o.format})`);
  assert(o.chartNumber === '404658', `AC-1 숫자-only 하위호환(got ${o.chartNumber})`);
  const ol = o.sessions.filter((s) => s.family === 'laser');
  assert(ol[0].current === 1 && ol[0].total === 10, `기존 N/N 회차 파싱(got ${ol[0].current}/${ol[0].total})`);
  assert(ol.every((s) => s.roundSource === 'file'), '기존 형태 roundSource file');
  assert(ol[0].date === '2026-06-14', '기존 날짜 있는 예약 라인 파싱');
  assert(o.stats.laser.total === 10, '기존 형태 total=10 유지');
  assert(o.stats.laser.progressRate === 0.2, `기존 진도율 2/10(got ${o.stats.laser.progressRate})`);

  console.log('✅ SELFTEST PASS — 기존 형태 + 신규 형태(F-4696) 둘 다 통과');
  console.log('   [new] chart=%s laser회차=%s total=%s grade=%s', n.chartNumber, laser.map((s) => s.current).join('/'), n.stats.laser.total, n.stats.laser.grade);
  console.log('   [old] chart=%s laser회차=%s/%s progress=%s', o.chartNumber, ol[0].current, ol[0].total, o.stats.laser.progressRate);
}

/* ─────────────────────────── CLI ─────────────────────────── */

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('사용법:');
    console.log('  node dataParser.js <파일.txt> [파일2.txt …]   # 파싱 → JSON');
    console.log('  node dataParser.js --selftest                 # 내장 회귀 테스트');
    process.exit(0);
  }
  if (args.includes('--selftest')) {
    selftest();
    process.exit(0);
  }
  const fs = require('fs');
  const results = [];
  for (const file of args) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      results.push({ file, ok: true, result: parse(text) });
    } catch (e) {
      results.push({ file, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}
