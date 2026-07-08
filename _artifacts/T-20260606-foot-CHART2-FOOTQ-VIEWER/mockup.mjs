/**
 * T-20260606-foot-CHART2-FOOTQ-VIEWER — 시안(모형) 생성 스크립트
 *
 * ⚠️ 시안 전용. prod 코드/DB 무접촉. 신규 npm 미설치(레포 기존 playwright 1.59.1 사용).
 * A안 = 발건강질문지 자가작성 응답(health_q_results.form_data JSONB)을
 *       "별도창(window.open)에 이미지 문서로 보기" 하는 화면의 정적 시안.
 *
 * 이 스크립트는 실제 CRM의 FIELD_LABELS·표시 ORDER·브라운/베이지 팔레트를 그대로 반영해
 * html→PNG 로 시안 2장을 산출한다. (실구현 아님 — 레이아웃/스타일 판단용 모형)
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const OUT = dirname(fileURLToPath(import.meta.url));

// ─── 실제 CRM과 동일한 팔레트 (HealthQMobilePage.tsx C 토큰 = 셀프체크인 브라운/베이지) ───
const C = {
  bgFrom: '#F5EFE7', bgTo: '#FAF7F2', dark: '#3D2B1A', primary: '#5C3D1E',
  medium: '#7B5130', muted: '#8B7355', border: '#D4C5B2', cream: '#FDF8F2',
  gold: '#C9A97A', bannerBg: '#FDF5E4',
};

// ─── 실제 CRM FIELD_LABELS (HealthQResultsPanel.tsx) 미러 ───
const FIELD_LABELS = {
  symptoms: '발 관련 증상',
  nail_treatment_history: '문제성 발톱 치료', nail_treatment_methods: '치료 방법',
  symptom_onset: '증상 시작 시점', family_history_type: '가족력', foot_pain_level: '발 통증 여부',
  medical_history: '나의 건강 상태', medications: '복용 중인 약',
  treatment_start_timing: '치료 시작 시기', visit_frequency: '내원 가능 주기',
  has_private_insurance: '실비보험', insurance_company: '보험사',
  pedicure_removed: '패디큐어 제거 유무', prone_30min_ok: '30분 이상 엎드려 시술 가능',
};

// 실제 CRM 표시 순서(extractDisplayFields ORDER) 미러 — 5섹션 구조
const SECTIONS = [
  { title: '1. 발 관련 증상', keys: ['symptoms'] },
  { title: '2. 발 건강 관련 경험', keys: ['nail_treatment_history', 'nail_treatment_methods', 'symptom_onset', 'family_history_type', 'foot_pain_level'] },
  { title: '3. 나의 건강 상태', keys: ['medical_history'] },
  { title: '4. 현재 복용 중인 약', keys: ['medications'] },
  { title: '5. 치료 및 내원 계획', keys: ['treatment_start_timing', 'visit_frequency', 'has_private_insurance', 'insurance_company'] },
  { title: '6. 시술 관련 확인', keys: ['pedicure_removed', 'prone_30min_ok'] },
];

function renderValue(v) {
  if (Array.isArray(v)) return v.join(' · ');
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  return String(v ?? '—');
}

// ─── 대표 form_data (일반 발건강질문지 자가작성 — 실제 문항/응답 반영) ───
const CASE_GENERAL = {
  meta: { name: '홍길동', chartNo: 'F-2026-0142', formType: '발건강 질문지 (일반)', submittedAt: '2026.07.06 14:32' },
  form_data: {
    symptoms: ['발톱 변색 및 변형', '내성발톱(파고드는 발톱)', '발톱 끝 부서짐'],
    nail_treatment_history: '있음',
    nail_treatment_methods: ['먹는 약', '레이저'],
    symptom_onset: '1~3년',
    family_history_type: '발톱무좀',
    foot_pain_level: '불편',
    medical_history: ['당뇨', '고혈압'],
    medications: ['당뇨약', '혈압약'],
    treatment_start_timing: '1주일 이내',
    visit_frequency: '2주에 한 번',
    has_private_insurance: '예',
    insurance_company: '삼성화재',
    pedicure_removed: true,
    prone_30min_ok: true,
  },
};

// ─── 두 번째 케이스 (외국인/간단 응답 — 문항 수 적을 때 레이아웃 확인용) ───
const CASE_SHORT = {
  meta: { name: 'EMMA WATSON', chartNo: 'F-2026-0159', formType: '발건강 질문지 (외국인용)', submittedAt: '2026.07.07 10:05' },
  form_data: {
    symptoms: ['발건조 및 각질', '발톱 변색 및 변형'],
    nail_treatment_history: '없음',
    symptom_onset: '6개월 이내',
    family_history_type: '모름 / 없음',
    foot_pain_level: '없음',
    medical_history: ['해당 없음'],
    medications: ['해당 없음'],
    treatment_start_timing: '즉시',
    visit_frequency: '주 1회',
    has_private_insurance: '아니오',
  },
};

function fieldsHtml(form_data) {
  return SECTIONS.map((sec) => {
    const rows = sec.keys
      .filter((k) => k in form_data && form_data[k] !== '' && !(Array.isArray(form_data[k]) && form_data[k].length === 0))
      .map((k) => `
        <div class="row">
          <div class="label">${FIELD_LABELS[k]}</div>
          <div class="value">${renderValue(form_data[k])}</div>
        </div>`).join('');
    if (!rows) return '';
    return `<section class="sec"><h3>${sec.title}</h3><div class="rows">${rows}</div></section>`;
  }).join('');
}

function page(c, note) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Noto Sans KR', sans-serif; background:#E9E2D6; padding:32px; -webkit-font-smoothing:antialiased; }
  /* ── 별도창(window.open) 프레임 chrome ── */
  .win { width:780px; margin:0 auto; border-radius:12px; overflow:hidden;
         box-shadow:0 24px 60px rgba(61,43,26,.28); background:#fff; }
  .titlebar { background:${C.dark}; color:#F5EFE7; display:flex; align-items:center;
              gap:10px; padding:11px 16px; font-size:13px; }
  .dots { display:flex; gap:7px; }
  .dot { width:12px; height:12px; border-radius:50%; }
  .dot.r{background:#FF5F57}.dot.y{background:#FEBC2E}.dot.g{background:#28C840}
  .wintitle { flex:1; text-align:center; opacity:.92; font-weight:500; letter-spacing:.2px; }
  .winbtns { display:flex; gap:8px; }
  .winbtns button { font-size:12px; border:0; border-radius:7px; padding:6px 12px; cursor:pointer; font-family:inherit; }
  .btn-print { background:${C.gold}; color:${C.dark}; font-weight:700; }
  .btn-close { background:rgba(255,255,255,.15); color:#F5EFE7; }
  /* ── 문서 본문 (이미지 문서 스타일) ── */
  .doc { background:linear-gradient(${C.bgTo}, ${C.cream}); padding:34px 40px 40px; }
  .doc-head { text-align:center; border-bottom:2px solid ${C.gold}; padding-bottom:18px; margin-bottom:8px; }
  .doc-head .brand { font-size:12px; letter-spacing:3px; color:${C.muted}; font-weight:500; }
  .doc-head h1 { font-size:23px; color:${C.primary}; margin-top:7px; font-weight:700; letter-spacing:1px; }
  .patient { display:flex; justify-content:space-between; align-items:flex-end; margin:20px 2px 22px; }
  .patient .who { font-size:19px; font-weight:700; color:${C.dark}; }
  .patient .who small { font-size:13px; font-weight:500; color:${C.muted}; margin-left:9px; }
  .patient .sub { font-size:12px; color:${C.muted}; text-align:right; line-height:1.7; }
  .patient .sub b { color:${C.medium}; }
  .sec { margin-bottom:16px; break-inside:avoid; }
  .sec h3 { font-size:14px; color:#fff; background:${C.medium}; padding:7px 14px;
            border-radius:8px 8px 0 0; font-weight:700; letter-spacing:.3px; }
  .rows { border:1px solid ${C.border}; border-top:0; border-radius:0 0 8px 8px; overflow:hidden; }
  .row { display:flex; border-bottom:1px solid #EAE0D2; background:#fff; }
  .row:last-child { border-bottom:0; }
  .row:nth-child(even){ background:${C.cream}; }
  .label { width:200px; flex-shrink:0; padding:12px 16px; font-size:13px; font-weight:600;
           color:${C.medium}; background:${C.bannerBg}; border-right:1px solid ${C.border}; }
  .value { flex:1; padding:12px 18px; font-size:13.5px; color:${C.dark}; line-height:1.55; }
  .footnote { margin-top:24px; text-align:center; font-size:11px; color:${C.muted};
              border-top:1px dashed ${C.border}; padding-top:14px; letter-spacing:.3px; }
  .stamp { display:inline-block; margin-top:2px; font-size:10.5px; color:${C.gold}; font-weight:700;
           border:1.5px solid ${C.gold}; border-radius:20px; padding:3px 14px; letter-spacing:1px; }
  .mocknote { width:780px; margin:14px auto 0; font-size:11px; color:#8A7A66; text-align:center; font-style:italic; }
</style></head><body>
  <div class="win">
    <div class="titlebar">
      <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
      <div class="wintitle">발건강질문지 자가작성 — ${c.meta.name} · ${c.meta.chartNo}</div>
      <div class="winbtns"><button class="btn-print">🖨 인쇄</button><button class="btn-close">닫기</button></div>
    </div>
    <div class="doc">
      <div class="doc-head">
        <div class="brand">O B L I V E   종로점 · 풋케어센터</div>
        <h1>발건강질문지 자가작성 내역</h1>
      </div>
      <div class="patient">
        <div class="who">${c.meta.name}<small>${c.meta.formType}</small></div>
        <div class="sub">차트번호 <b>${c.meta.chartNo}</b><br>제출일시 <b>${c.meta.submittedAt}</b></div>
      </div>
      ${fieldsHtml(c.form_data)}
      <div class="footnote">
        본 문서는 고객이 모바일로 자가작성한 발건강질문지 응답을 별도 창으로 출력한 것입니다.<br>
        <span class="stamp">OBLIVE FOOT CARE</span>
      </div>
    </div>
  </div>
  <div class="mocknote">시안(모형) — ${note} · 실제 데이터/코드 아님 (T-20260606-foot-CHART2-FOOTQ-VIEWER)</div>
</body></html>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });

for (const [c, file, note] of [
  [CASE_GENERAL, 'shian_A_general.png', '일반 · 응답 다수'],
  [CASE_SHORT, 'shian_A_foreign_short.png', '외국인용 · 응답 소수'],
]) {
  const p = await ctx.newPage();
  await p.setContent(page(c, note), { waitUntil: 'networkidle' });
  await p.waitForTimeout(600); // 웹폰트 로드 대기
  const el = await p.$('body');
  await el.screenshot({ path: join(OUT, file) });
  console.log('rendered', file);
  await p.close();
}

await browser.close();
console.log('DONE');
