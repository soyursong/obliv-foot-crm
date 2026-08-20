/**
 * T-20260820-foot-TXMEMO-3VISIT-MD-ZIP-EXTEND-5SEC-CLINITEXT — READ-ONLY 추출 (부모 확장 · 3번째 확장)
 *
 * 계보: EXTRACT(치료메모 45명) → EXTEND(4섹션 RX·HX·첫날차트) → 본 티켓(섹션5 추가 = 5섹션).
 * 확장: 동일 45명 대상 md 패키지에 아래 5섹션을 구분선(---)으로 합산 재생성.
 *   1. 치료메모        (각 메모에 방문 날짜 명시)                        ← customer_treatment_memos
 *   2. 처방내역        (날짜·처방내용)                                   ← prescriptions + prescription_items
 *   3. 과거력          (QR 셀프접수/발건강 질문지 입력)                  ← health_q_results.form_data
 *   4. 첫날 상담차트    (첫 방문일 초진 상담 기록/차트)                   ← customer_consult_memos(첫방문일) + medical_charts(첫방문일)
 *   5. 임상 유의미 텍스트 (전체 상담메모·진료차트, 루틴상용구 제외 개별 특이정보만) ★신규
 *        ← customer_consult_memos(전량) + medical_charts(전 임상필드) − phrase_templates/super_phrases(루틴상용구)
 *
 * canonical 소스 근거 (2026-08-20 DB 실측):
 *   - 내원횟수 = check_ins status != 'cancelled' 건수 >= 3 (앱 SSOT loadCustomerStats). 대상 45명·is_test 제외.
 *   - 치료메모 = customer_treatment_memos (deleted_at IS NULL, 활성만). soft-delete 제외 건수 요약 명시(무손실).
 *   - 처방내역 = prescriptions(+prescription_items). ⚠ 대상 0건·prescriptions 테이블 전역 0행(기능 미사용) → 전원 "기록 없음"(정직 표기).
 *   - 과거력 = health_q_results.form_data (환자 QR 셀프접수 발건강 질문지 원입력). 대상 45/45 보유.
 *   - 첫날 상담차트 = customer_consult_memos(첫 방문일 작성, 활성) + medical_charts(첫 방문일, is_deleted 제외).
 *
 *   ── 섹션5 임상 유의미 텍스트 판단로직 (★원장 사전리뷰 대상 · 사양서 md 동봉) ──
 *   목표: "루틴상용구(정형 서식/빈 스켈레톤) 제외 · 환자 개별 특이정보만 include".
 *   ★외부 AI(LLM) 미경유 — 전(全) 판단은 결정론적 규칙 기반(재현가능·감사가능).
 *   소스: customer_consult_memos(deleted_at IS NULL, 전 방문 전량) + medical_charts(전 임상필드, is_deleted 제외).
 *   루틴상용구 사전(canonical) = phrase_templates(customer_chart/medical_chart) + super_phrases 실적재 내용.
 *   규칙(라인 단위, 무손실 카운트):
 *     (R1) 원문 전체가 상용구 content 와 정규화 동일 → 블록 전체를 "루틴상용구(원문그대로)"로 제외(존재는 표기).
 *     (R2) 라벨 스켈레톤 라인 "라벨 :" 에서 값이 비었거나 미선택 플레이스홀더(Y/N·유/무·N/SY/DY/PY·-·ㅡ 등)만 → 미기재 스켈레톤 = 제외.
 *     (R3) "라벨 : 실제값"(플레이스홀더 아님) → 개별 특이정보 = include.
 *     (R4) 라벨 없는 자유서술 라인 → 개별 특이정보 = include.
 *     (R5) 공백/구분선(---·===·번호만)·의사서명(Dr.xxx)만 라인 → 제외.
 *   무손실: 제외 라인 수를 각 블록 말미 각주로 표기(조용한 누락 금지). 의미 라인 0이면 "유의미 텍스트 없음(정형서식/미기재)".
 *   ⚠ 2026-08-20 실측: medical_charts 임상필드 대상 45명 전원 0건 non-null(펜차트 사용 추정) → 진료차트측 전원 "기록 없음"(정직 표기).
 *
 * GATE: READ-ONLY — SELECT/introspection only. prod write/DDL/데이터정정 0. script_only(스키마 무접촉). 외부 AI 0.
 * auth: Supabase Management API database/query = postgres 슈퍼유저(RLS 미적용) → silent 0-row 회피.
 * PHI: 산출 zip = 진료성 PHI(치료메모+처방+과거력+상담/진료 임상텍스트). 요청자 본인(문지은 대표원장 U0ALGAAAJAV)에게만 전달.
 *      동일 스레드(C0ATE5P6JTH / 1787147293.484699) 첨부. 공개/타인 전달 금지.
 *      ★firewall: 단일수령=집도의 본인 · private thread · no-broadcast · byte-exact verify · 외부 AI 미경유.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) {
    console.error(`HTTP ${res.status}`, JSON.stringify(out));
    process.exit(1);
  }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);

function safeName(s) {
  return String(s ?? '')
    .replace(/[\\/:*?"<>| -]/g, '')
    .replace(/\s+/g, '_')
    .replace(/\.+$/, '')
    .slice(0, 80) || 'unknown';
}
function pad(s) { return String(s ?? '').replace(/[\r\n]+/g, ' ').trim(); }
function dOnly(ts) { return ts ? String(ts).slice(0, 10) : '(없음)'; }
function arr(v) { return Array.isArray(v) ? v : []; }

const OUT_ROOT = path.join(process.cwd(), '_artifacts', 'T-20260820-foot-TXMEMO-3VISIT-MD-ZIP-EXTEND-5SEC-CLINITEXT');
const MD_DIR = path.join(OUT_ROOT, 'foot_경과분석_내원3회이상');

// ── 섹션5: 임상 유의미 텍스트 판단 유틸 (결정론적·외부AI 미경유) ──
// 정규화: 공백류 단일화 + 좌우 trim (상용구/라인 비교 canonical form)
function norm(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }
// 미선택 플레이스홀더(값이 사실상 미기재) 판정
// ★Q2 원장 답변 반영: '없음'/'특이사항 없음' = 의미 있는 정보(데이터로 처리·include). "없다는 것도 정보"·미기재 처리 금지.
//   → PLACEHOLDER_SET(=exclude 대상)에서 '없음' 제거. 순수 빈칸·코드성 필드·미선택 표시만 exclude 유지(누락<과잉 정합).
//   ⚠ 'n/a'/'na'/'tbd' = 영문 코드성 미기재 토큰 → 코드성 필드로 계속 exclude(원장 명시 대상은 한글 '없음').
const PLACEHOLDER_SET = new Set([
  '', '-', 'ㅡ', '_', '.', ':', 'x', 'X',
  'y/n', 'n/y', '유/무', '무/유', '유 / 무', '유/무:', '(유/무)',
  'n/sy/dy/py', '유/무:유', // 흔한 잔여(미선택 표시)
  'n/a', 'na', 'tbd', // 영문 코드성 미기재 토큰. ('없음'은 include — 상단 주석 참조)
]);
function isPlaceholderValue(v) {
  const t = norm(v).toLowerCase().replace(/[()（）\[\]·・,，]/g, '').replace(/\s+/g, '');
  if (t === '') return true;
  if (PLACEHOLDER_SET.has(t)) return true;
  // 오직 플레이스홀더 문자(-, ㅡ, /, y, n, s, d, p, 유, 무, 공백)로만 구성 → 미선택
  if (/^[-ㅡ/ynsdp유무\s]+$/i.test(t)) return true;
  return false;
}
// 의사 서명(Dr.xxx)만 있는 라인 판정
function isSignatureLine(line) {
  const t = norm(line);
  return /^(dr\.?\s*[가-힣a-z]{1,10}|drㅤ)$/i.test(t);
}
// 구분선/번호만 라인
function isSeparatorLine(line) {
  const t = norm(line);
  return t === '' || /^[-=_*·・.\s]+$/.test(t) || /^\d+[.)]?$/.test(t);
}
/**
 * 원문(상담메모/차트필드) → 유의미 라인만 추출.
 * boilerSet: 정규화된 상용구 content 집합 (R1 전체일치용)
 * skeletonLabels: 상용구에서 뽑은 라벨 스켈레톤 접두 집합(참고용; 값 판정은 isPlaceholderValue 우선)
 * 반환: { kept: string[], dropped: number, wholeBoiler: boolean }
 */
function extractMeaningful(text, boilerSet) {
  const raw = String(text ?? '');
  if (norm(raw) === '') return { kept: [], dropped: 0, wholeBoiler: false };
  // R1: 원문 전체가 상용구와 정규화 동일
  if (boilerSet.has(norm(raw))) return { kept: [], dropped: raw.split(/\r?\n/).length, wholeBoiler: true };
  const kept = [];
  let dropped = 0;
  for (const rawLine of raw.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (isSeparatorLine(line)) { if (norm(line) !== '') dropped++; continue; } // 빈줄은 카운트 제외
    if (isSignatureLine(line)) { dropped++; continue; } // R5
    // R2/R3: "라벨 : 값" 형태
    const m = line.match(/^\s*([^:：]{1,24})\s*[:：]\s*(.*)$/);
    if (m) {
      const val = m[2];
      if (isPlaceholderValue(val)) { dropped++; continue; } // R2 미기재 스켈레톤
      kept.push(line.trim()); // R3 실제값
      continue;
    }
    // R4: 라벨 없는 자유서술
    kept.push(line.trim());
  }
  return { kept, dropped, wholeBoiler: false };
}

// ── 과거력(발건강 질문지 form_data) 라벨 맵 ──
const HQ_MED_FIELDS = [
  ['medical_history', '기저질환·과거병력', 'arr'],
  ['medical_history_other', '기타 병력(직접입력)', 'str'],
  ['medical_history_none', '기저질환 없음 체크', 'bool'],
  ['medications', '복용약물', 'arr'],
  ['medications_other', '기타 복용약(직접입력)', 'str'],
  ['medications_none', '복용약 없음 체크', 'bool'],
  ['has_allergy', '알러지 여부', 'raw'],
  ['allergies', '알러지 내용', 'str'],
  ['family_history_type', '가족력', 'str'],
];
const HQ_FOOT_FIELDS = [
  ['symptoms', '주요 증상', 'arr'],
  ['symptoms_other', '기타 증상(직접입력)', 'str'],
  ['foot_concern_symptoms', '발 우려 증상', 'arr'],
  ['symptom_onset', '증상 발생시기', 'str'],
  ['foot_pain_level', '통증 정도', 'str'],
  ['concern_nail_sites', '문제 발톱 부위', 'nail'],
  ['nail_treatment_history', '기존 네일치료 이력', 'str'],
  ['nail_treatment_methods', '기존 네일치료 방법', 'arr'],
  ['pedicure_removed', '페디큐어 제거 여부', 'str'],
  ['visit_frequency', '내원 가능 빈도', 'str'],
  ['treatment_start_timing', '치료 시작 희망시기', 'str'],
  ['prone_30min_ok', '30분 엎드림 가능', 'str'],
  ['has_private_insurance', '실손보험 가입', 'str'],
  ['insurance_company', '보험사', 'str'],
  ['visit_purpose', '방문 목적', 'str'],
];

function renderHqValue(kind, v) {
  if (kind === 'arr') { const a = arr(v); return a.length ? a.map(String).join(', ') : '-'; }
  if (kind === 'bool') { return v === true ? '예' : (v === false ? '아니오' : '-'); }
  if (kind === 'raw') { return (v === null || v === undefined || v === '') ? '-' : String(v); }
  if (kind === 'nail') {
    const a = arr(v);
    if (!a.length) return '-';
    return a.map((s) => (s && typeof s === 'object') ? `${s.side ?? '?'}${s.toe ?? '?'}` : String(s)).join(', ');
  }
  // str
  const s = (v === null || v === undefined) ? '' : String(v).trim();
  return s === '' ? '-' : s;
}

(async () => {
  console.log('=== auth-context (postgres/무RLS 여야 함) ===');
  console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super;`)));

  // ── 1. 대상 환자 (부모와 동일 기준, DB 재조회 최신화) ──
  console.log('\n=== 1. 대상 환자 (내원=check_in status!=cancelled >=3, is_test 제외) ===');
  const targets = await q(`
    SELECT c.id, c.name, c.chart_number, cnt.visit_count
    FROM customers c
    JOIN (
      SELECT customer_id, count(*) AS visit_count
      FROM check_ins
      WHERE status IS DISTINCT FROM 'cancelled' AND customer_id IS NOT NULL
      GROUP BY customer_id HAVING count(*) >= 3
    ) cnt ON cnt.customer_id = c.id
    WHERE c.is_test IS NOT TRUE
    ORDER BY cnt.visit_count DESC, c.name;
  `);
  const patients = Array.isArray(targets) ? targets : [];
  console.log(`대상 환자 수: ${patients.length}`);
  const ids = patients.map(p => `'${p.id}'`);
  if (ids.length === 0) { console.error('대상 0명 — 중단'); process.exit(1); }
  const idIn = ids.join(',');

  // ── 2. 치료메모 (활성) ──
  const sd = await q(`SELECT count(*) n FROM customer_treatment_memos WHERE customer_id IN (${idIn}) AND deleted_at IS NOT NULL;`);
  const softDeletedCount = Number(sd?.[0]?.n ?? 0);
  const memos = await q(`
    SELECT customer_id, content, created_at, created_by, created_by_name
    FROM customer_treatment_memos
    WHERE customer_id IN (${idIn}) AND deleted_at IS NULL
    ORDER BY customer_id, created_at ASC;`);
  const memosBy = new Map();
  for (const m of arr(memos)) { if (!memosBy.has(m.customer_id)) memosBy.set(m.customer_id, []); memosBy.get(m.customer_id).push(m); }

  // ── 3. 처방내역 (prescriptions + items) ──
  const rxRows = await q(`
    SELECT p.customer_id, p.id, p.prescribed_at, p.prescribed_by_name, p.diagnosis, p.memo, p.created_at
    FROM prescriptions p WHERE p.customer_id IN (${idIn})
    ORDER BY p.customer_id, COALESCE(p.prescribed_at, p.created_at) ASC;`);
  const rxBy = new Map();
  for (const r of arr(rxRows)) { if (!rxBy.has(r.customer_id)) rxBy.set(r.customer_id, []); rxBy.get(r.customer_id).push(r); }
  const rxIds = arr(rxRows).map(r => `'${r.id}'`);
  const rxItemsBy = new Map();
  if (rxIds.length) {
    const items = await q(`SELECT prescription_id, medication_name, dosage, duration_days, quantity, memo, sort_order
      FROM prescription_items WHERE prescription_id IN (${rxIds.join(',')}) ORDER BY prescription_id, sort_order;`);
    for (const it of arr(items)) { if (!rxItemsBy.has(it.prescription_id)) rxItemsBy.set(it.prescription_id, []); rxItemsBy.get(it.prescription_id).push(it); }
  }

  // ── 4. 과거력 (health_q_results.form_data, 대상당 최초 제출) ──
  const hqRows = await q(`
    SELECT DISTINCT ON (customer_id) customer_id, form_data, submitted_at, created_at
    FROM health_q_results WHERE customer_id IN (${idIn})
    ORDER BY customer_id, created_at ASC;`);
  const hqBy = new Map();
  for (const h of arr(hqRows)) hqBy.set(h.customer_id, h);

  // ── 5. 첫 방문일 ──
  const fvRows = await q(`
    SELECT customer_id, min(checked_in_at::date) fvd
    FROM check_ins WHERE customer_id IN (${idIn}) AND status IS DISTINCT FROM 'cancelled'
    GROUP BY customer_id;`);
  const fvBy = new Map();
  for (const f of arr(fvRows)) fvBy.set(f.customer_id, f.fvd);

  // ── 6. 상담메모 (활성 전량; 첫날/최초 분기) ──
  const consultRows = await q(`
    SELECT customer_id, content, created_at, created_by_name
    FROM customer_consult_memos WHERE customer_id IN (${idIn}) AND deleted_at IS NULL
    ORDER BY customer_id, created_at ASC;`);
  const consultBy = new Map();
  for (const c of arr(consultRows)) { if (!consultBy.has(c.customer_id)) consultBy.set(c.customer_id, []); consultBy.get(c.customer_id).push(c); }

  // ── 7. 진료차트 (첫 방문일, is_deleted 제외) ──
  const chartRows = await q(`
    SELECT customer_id, visit_date, chief_complaint, diagnosis, treatment_record, clinical_progress,
           materials_used, treatment_result, created_by_name, created_at
    FROM medical_charts WHERE customer_id IN (${idIn}) AND is_deleted IS NOT TRUE
    ORDER BY customer_id, visit_date ASC, created_at ASC;`);
  const chartBy = new Map();
  for (const c of arr(chartRows)) { if (!chartBy.has(c.customer_id)) chartBy.set(c.customer_id, []); chartBy.get(c.customer_id).push(c); }

  // ── 8. 루틴상용구 사전 (섹션5 R1 canonical) = phrase_templates + super_phrases ──
  const phraseRows = await q(`SELECT content FROM phrase_templates WHERE content IS NOT NULL AND phrase_type IN ('customer_chart','medical_chart','pen_chart');`);
  const superRows = await q(`SELECT diagnosis, clinical_progress FROM super_phrases;`);
  const boilerSet = new Set();
  for (const r of arr(phraseRows)) { const n = norm(r.content); if (n) boilerSet.add(n); }
  for (const r of arr(superRows)) { for (const v of [r.diagnosis, r.clinical_progress]) { const n = norm(v); if (n) boilerSet.add(n); } }
  console.log(`\n=== 섹션5 루틴상용구 사전 로드: ${boilerSet.size}건 (phrase_templates+super_phrases) ===`);

  // ── md 생성 ──
  if (existsSync(OUT_ROOT)) rmSync(OUT_ROOT, { recursive: true, force: true });
  mkdirSync(MD_DIR, { recursive: true });

  let totMemos = 0, totRx = 0, custWithMemo = 0, custWithRx = 0, custWithHx = 0, custWithFirstChart = 0;
  let custWithClini = 0, totCliniKept = 0, totCliniDropped = 0; // 섹션5 통계
  const usedNames = new Map();

  for (const p of patients) {
    const fvd = fvBy.get(p.id) ?? null;
    const memoList = memosBy.get(p.id) ?? [];
    const rxList = rxBy.get(p.id) ?? [];
    const hq = hqBy.get(p.id) ?? null;
    const consultList = consultBy.get(p.id) ?? [];
    const chartList = chartBy.get(p.id) ?? [];
    totMemos += memoList.length; totRx += rxList.length;
    if (memoList.length) custWithMemo++;
    if (rxList.length) custWithRx++;
    if (hq) custWithHx++;

    // 파일명: {차트번호}_{이름}.md (신 티켓 §55)
    const chartTag = p.chart_number ? safeName(p.chart_number) : `id-${String(p.id).slice(0, 8)}`;
    let base = `${chartTag}_${safeName(p.name)}`;
    if (usedNames.has(base)) { const n = usedNames.get(base) + 1; usedNames.set(base, n); base = `${base}_${n}`; }
    else usedNames.set(base, 1);

    const L = [];
    L.push(`# 경과분석 자료 — ${pad(p.name ?? '(이름없음)')}`);
    L.push('');
    // ── 행정 헤더 (★Q1 원장 답변 반영: 성함·차트번호를 MD 내부 필드로 명시. 현행 파일명만→문서 상단 명기) ──
    L.push('## 【행정】 환자 식별 정보');
    L.push('');
    L.push(`- 성함: ${pad(p.name ?? '(이름없음)')}`);
    L.push(`- 차트번호: ${p.chart_number ?? '(없음)'}`);
    L.push('');
    L.push('### 내원 요약');
    L.push('');
    L.push(`- 고객 ID: ${p.id}`);
    L.push(`- 첫 방문일: ${fvd ?? '(없음)'}`);
    L.push(`- 내원 횟수(check_in, 취소제외): ${p.visit_count}`);
    L.push(`- 치료메모 ${memoList.length}건 / 처방 ${rxList.length}건 / 과거력질문지 ${hq ? '있음' : '없음'} / 첫날상담 ${consultList.length ? '있음' : '없음'}`);
    L.push('');

    // ===== 섹션 1: 치료메모 =====
    L.push('---');
    L.push('');
    L.push('# 【1】 치료메모');
    L.push('');
    if (memoList.length === 0) {
      L.push('_기록 없음_');
      L.push('');
    } else {
      memoList.forEach((m, i) => {
        L.push(`## ${i + 1}번째 치료메모`);
        L.push('');
        L.push(`- 방문 날짜: ${dOnly(m.created_at)}`);
        L.push(`- 작성일시: ${m.created_at ?? '(없음)'}`);
        L.push(`- 작성자: ${m.created_by_name ?? m.created_by ?? '(미상)'}`);
        L.push('');
        L.push(String(m.content ?? '').replace(/\r\n/g, '\n'));
        L.push('');
      });
    }

    // ===== 섹션 2: 처방내역 =====
    L.push('---');
    L.push('');
    L.push('# 【2】 처방내역');
    L.push('');
    if (rxList.length === 0) {
      L.push('_기록 없음_  (처방 테이블·차트/접수 처방필드 전부 미기재)');
      L.push('');
    } else {
      rxList.forEach((r, i) => {
        L.push(`## 처방 ${i + 1}`);
        L.push('');
        L.push(`- 처방일: ${dOnly(r.prescribed_at ?? r.created_at)}`);
        L.push(`- 처방자: ${r.prescribed_by_name ?? '(미상)'}`);
        if (r.diagnosis) L.push(`- 진단: ${pad(r.diagnosis)}`);
        if (r.memo) L.push(`- 메모: ${pad(r.memo)}`);
        const its = rxItemsBy.get(r.id) ?? [];
        L.push('');
        if (its.length) {
          L.push('| 약품 | 용법 | 일수 | 수량 | 비고 |');
          L.push('|---|---|---|---|---|');
          for (const it of its) L.push(`| ${pad(it.medication_name)} | ${pad(it.dosage)} | ${it.duration_days ?? ''} | ${it.quantity ?? ''} | ${pad(it.memo)} |`);
        } else {
          L.push('_처방 약품 항목 없음_');
        }
        L.push('');
      });
    }

    // ===== 섹션 3: 과거력 (QR 셀프접수 발건강 질문지) =====
    L.push('---');
    L.push('');
    L.push('# 【3】 과거력 (QR 셀프접수 입력)');
    L.push('');
    if (!hq || !hq.form_data) {
      L.push('_기록 없음_');
      L.push('');
    } else {
      const fd = hq.form_data;
      L.push(`- 질문지 작성일: ${dOnly(hq.submitted_at ?? hq.created_at)}`);
      L.push('');
      L.push('### 의료 과거력');
      L.push('');
      for (const [k, label, kind] of HQ_MED_FIELDS) L.push(`- ${label}: ${renderHqValue(kind, fd[k])}`);
      L.push('');
      L.push('### 발/증상·기타 문진');
      L.push('');
      for (const [k, label, kind] of HQ_FOOT_FIELDS) L.push(`- ${label}: ${renderHqValue(kind, fd[k])}`);
      // 미매핑 키(스키마 확장 대비) — 조용한 누락 금지
      const known = new Set([...HQ_MED_FIELDS, ...HQ_FOOT_FIELDS].map(x => x[0]).concat(['_lang']));
      const extra = Object.keys(fd).filter(k => !known.has(k));
      if (extra.length) {
        L.push('');
        L.push('### 기타 질문지 항목');
        L.push('');
        for (const k of extra) L.push(`- ${k}: ${renderHqValue('raw', typeof fd[k] === 'object' ? JSON.stringify(fd[k]) : fd[k])}`);
      }
      L.push('');
    }

    // ===== 섹션 4: 첫날 상담차트 =====
    L.push('---');
    L.push('');
    L.push('# 【4】 첫날 상담차트 (첫 방문일 초진 기록)');
    L.push('');
    L.push(`- 첫 방문일: ${fvd ?? '(없음)'}`);
    L.push('');
    const consultFirstDay = fvd ? consultList.filter(c => dOnly(c.created_at) === String(fvd)) : [];
    const chartFirstDay = fvd ? chartList.filter(c => String(c.visit_date) === String(fvd)) : [];
    let hasFirst = false;

    L.push('### 초진 상담 기록');
    L.push('');
    if (consultFirstDay.length) {
      hasFirst = true;
      consultFirstDay.forEach((c, i) => {
        if (consultFirstDay.length > 1) L.push(`#### 상담 ${i + 1}`);
        L.push(`- 작성일시: ${c.created_at ?? '(없음)'}`);
        L.push(`- 작성자: ${c.created_by_name ?? '(미상)'}`);
        L.push('');
        L.push(String(c.content ?? '').replace(/\r\n/g, '\n'));
        L.push('');
      });
    } else if (consultList.length) {
      // 첫날 상담 없음 → 최초 상담메모 대체표기(라벨 명시)
      const c = consultList[0];
      L.push(`_첫 방문일(${fvd}) 상담기록 없음 — 최초 상담메모(${dOnly(c.created_at)}) 대체표기_`);
      L.push('');
      L.push(`- 작성일시: ${c.created_at ?? '(없음)'}`);
      L.push(`- 작성자: ${c.created_by_name ?? '(미상)'}`);
      L.push('');
      L.push(String(c.content ?? '').replace(/\r\n/g, '\n'));
      L.push('');
    } else {
      L.push('_기록 없음_');
      L.push('');
    }

    // 진료차트(의사) 첫 방문일 — 있으면 부가
    const chartsToShow = chartFirstDay.length ? chartFirstDay : [];
    if (chartsToShow.length) {
      L.push('### 초진 진료차트(의사)');
      L.push('');
      chartsToShow.forEach((c, i) => {
        if (chartsToShow.length > 1) L.push(`#### 차트 ${i + 1}`);
        L.push(`- 방문일: ${c.visit_date ?? '(없음)'}`);
        L.push(`- 작성자: ${c.created_by_name ?? '(미상)'}`);
        const fields = [
          ['주호소(C.C)', c.chief_complaint], ['진단', c.diagnosis], ['치료기록', c.treatment_record],
          ['임상경과', c.clinical_progress], ['사용재료', c.materials_used], ['치료결과', c.treatment_result],
        ].filter(([, v]) => v != null && String(v).trim() !== '');
        L.push('');
        if (fields.length) { for (const [lab, v] of fields) { L.push(`**${lab}**: ${String(v).replace(/\r\n/g, '\n')}`); L.push(''); } hasFirst = true; }
        else { L.push('_차트 본문 항목 없음(빈 차트)_'); L.push(''); }
      });
    }
    if (hasFirst) custWithFirstChart++;

    // ===== 섹션 5: 임상 유의미 텍스트 (전체 상담메모·진료차트, 루틴상용구 제외) =====
    L.push('---');
    L.push('');
    L.push('# 【5】 임상 유의미 텍스트 (전체 경과 · 루틴상용구 제외)');
    L.push('');
    L.push('_루틴상용구(정형 서식·빈 스켈레톤·의사서명)를 결정론적 규칙으로 제외하고, 환자 개별 특이정보만 발췌. 외부 AI 미경유._');
    L.push('');
    let custKept = 0, custDropped = 0;

    // 5-A. 상담메모(전량) 유의미 발췌
    L.push('### 상담메모 발췌 (전 방문)');
    L.push('');
    if (consultList.length === 0) {
      L.push('_상담메모 없음_');
      L.push('');
    } else {
      let anyKept = false;
      consultList.forEach((c) => {
        const { kept, dropped, wholeBoiler } = extractMeaningful(c.content, boilerSet);
        custDropped += dropped;
        L.push(`**[${dOnly(c.created_at)} · ${c.created_by_name ?? '미상'}]**`);
        if (wholeBoiler) {
          L.push('- _(루틴상용구 원문 그대로 — 유의미 텍스트 없음)_');
        } else if (kept.length === 0) {
          L.push('- _(정형서식/미기재 — 유의미 텍스트 없음)_');
        } else {
          anyKept = true; custKept += kept.length;
          for (const k of kept) L.push(`- ${k}`);
        }
        if (dropped > 0) L.push(`  <sub>_(정형·미기재 ${dropped}줄 제외)_</sub>`);
        L.push('');
      });
      if (anyKept) custWithClini++;
    }

    // 5-B. 진료차트(전 임상필드) 유의미 발췌
    L.push('### 진료차트 발췌 (전 방문, 의사 임상필드)');
    L.push('');
    if (chartList.length === 0) {
      L.push('_진료차트(디지털) 기록 없음_');
      L.push('');
    } else {
      let chartAny = false;
      chartList.forEach((c) => {
        const fieldMap = [
          ['주호소', c.chief_complaint], ['진단', c.diagnosis], ['치료기록', c.treatment_record],
          ['임상경과', c.clinical_progress], ['사용재료', c.materials_used], ['치료결과', c.treatment_result],
        ];
        const blockLines = [];
        for (const [lab, v] of fieldMap) {
          const { kept, dropped } = extractMeaningful(v, boilerSet);
          custDropped += dropped;
          if (kept.length) { chartAny = true; custKept += kept.length; blockLines.push(`- **${lab}**: ${kept.join(' / ')}`); }
        }
        if (blockLines.length) {
          L.push(`**[${c.visit_date ?? dOnly(c.created_at)} · ${c.created_by_name ?? '미상'}]**`);
          for (const b of blockLines) L.push(b);
          L.push('');
        }
      });
      if (!chartAny) { L.push('_진료차트 임상필드 전부 미기재(빈 차트)_'); L.push(''); }
    }
    totCliniKept += custKept; totCliniDropped += custDropped;

    writeFileSync(path.join(MD_DIR, `${base}.md`), L.join('\n'), 'utf8');
  }

  // ── 요약 INDEX ──
  const idx = [];
  idx.push('# foot CRM 경과분석 자료 추출 요약 (내원 3회 이상 전 환자)');
  idx.push('');
  idx.push(`- 계보: EXTRACT(치료메모 45명) → EXTEND(4섹션) → 본 티켓(섹션5 추가 = 5섹션)`);
  idx.push(`- 내원 기준: check_ins status != cancelled >= 3, is_test 제외`);
  idx.push('');
  idx.push('## 섹션별 소스 (2026-08-20 DB 실측)');
  idx.push('1. 치료메모 = customer_treatment_memos (활성). 각 메모에 방문 날짜 명시.');
  idx.push('2. 처방내역 = prescriptions + prescription_items. ⚠ 대상 0건·prescriptions 테이블 전역 0행(기능 미사용) → 전원 "기록 없음"(정직 표기).');
  idx.push('3. 과거력 = health_q_results.form_data (환자 QR 셀프접수 발건강 질문지 원입력). patient_past_history(의사확정 파생)는 전역 0행이라 미사용.');
  idx.push('4. 첫날 상담차트 = customer_consult_memos(첫 방문일 작성) + medical_charts(첫 방문일). 첫날 상담 없으면 최초 상담메모 대체표기(라벨).');
  idx.push('5. 임상 유의미 텍스트 ★신규 = customer_consult_memos(전량) + medical_charts(전 임상필드). 루틴상용구(phrase_templates+super_phrases) 결정론 제외 후 개별 특이정보만. 외부 AI 미경유. ⚠ medical_charts 임상필드 전원 0건 non-null → 진료차트측 전원 "기록 없음".');
  idx.push('   판단로직 상세 = 동봉 사양서 md (섹션5 R1~R5 규칙). 원장 사전리뷰 대상.');
  idx.push('');
  idx.push('## 커버리지');
  idx.push(`- 대상 환자: ${patients.length}명`);
  idx.push(`- 치료메모 보유: ${custWithMemo}명 (총 ${totMemos}건, 제외 soft-delete ${softDeletedCount}건)`);
  idx.push(`- 처방 보유: ${custWithRx}명 (총 ${totRx}건)`);
  idx.push(`- 과거력 질문지 보유: ${custWithHx}명`);
  idx.push(`- 첫날 상담/차트 보유: ${custWithFirstChart}명`);
  idx.push(`- 섹션5 임상 유의미 텍스트 보유: ${custWithClini}명 (유의미 ${totCliniKept}줄 발췌 / 정형·미기재 ${totCliniDropped}줄 제외 · 루틴상용구 사전 ${boilerSet.size}건 기준)`);
  idx.push('');
  // 이름상 테스트 의심(is_test=false 라 canonical 필터 미제외) — 드롭하지 않고 플래그(부모 ZIP과 동일 포함, 조용한 누락 금지)
  const TEST_NAME_RE = /테스트|test|결제테스트|총괄|마스킹|설문지|접수테스트|서류테스트/i;
  const suspectTest = patients.filter(p => TEST_NAME_RE.test(String(p.name ?? '')));
  if (suspectTest.length) {
    idx.push('## ⚠ 테스트 의심 계정 (드롭 안 함 — 부모 ZIP과 동일 포함)');
    idx.push('이름상 테스트로 보이나 is_test=false 라 canonical 내원 필터(is_test IS NOT TRUE)에서 제외되지 않음.');
    idx.push('부모 EXTRACT ZIP과 동일 대상 유지 위해 포함. 경과분석 시 무시 가능.');
    for (const p of suspectTest) idx.push(`- ${p.chart_number ?? ''} / ${pad(p.name ?? '')} (내원 ${p.visit_count})`);
    idx.push('');
  }
  idx.push('| 차트번호 | 환자명 | 첫방문일 | 내원 | 치료메모 | 처방 | 과거력 | 첫날상담 | 상담메모(전량) | 유의미줄 |');
  idx.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const p of patients) {
    const fvd = fvBy.get(p.id) ?? '';
    const nm = (memosBy.get(p.id) ?? []).length;
    const nr = (rxBy.get(p.id) ?? []).length;
    const hx = hqBy.get(p.id) ? 'O' : '-';
    const cf = (fvBy.get(p.id) && (consultBy.get(p.id) ?? []).some(c => dOnly(c.created_at) === String(fvd))) ? 'O'
      : ((consultBy.get(p.id) ?? []).length ? '△(최초대체)' : '-');
    const cList = consultBy.get(p.id) ?? [];
    let kk = 0; for (const c of cList) { kk += extractMeaningful(c.content, boilerSet).kept.length; }
    idx.push(`| ${p.chart_number ?? ''} | ${pad(p.name ?? '')} | ${fvd} | ${p.visit_count} | ${nm} | ${nr || '없음'} | ${hx} | ${cf} | ${cList.length} | ${kk} |`);
  }
  writeFileSync(path.join(MD_DIR, '_요약_INDEX.md'), idx.join('\n'), 'utf8');

  // ── zip ──
  const zipPath = path.join(OUT_ROOT, 'foot_경과분석_내원3회이상.zip');
  execSync(`cd ${JSON.stringify(OUT_ROOT)} && zip -r -q ${JSON.stringify(path.basename(zipPath))} ${JSON.stringify(path.basename(MD_DIR))}`, { stdio: 'inherit' });

  console.log('\n=== 추출 완료 ===');
  console.log(`대상 환자 수        : ${patients.length}`);
  console.log(`치료메모 보유       : ${custWithMemo} (총 ${totMemos}건 / soft-delete 제외 ${softDeletedCount})`);
  console.log(`처방 보유           : ${custWithRx} (총 ${totRx}건)`);
  console.log(`과거력 질문지 보유  : ${custWithHx}`);
  console.log(`첫날 상담/차트 보유 : ${custWithFirstChart}`);
  console.log(`섹션5 유의미텍스트  : ${custWithClini}명 (발췌 ${totCliniKept}줄 / 제외 ${totCliniDropped}줄 · 상용구사전 ${boilerSet.size}건)`);
  console.log(`md 디렉토리         : ${MD_DIR}`);
  console.log(`zip 경로            : ${zipPath}`);
})();
