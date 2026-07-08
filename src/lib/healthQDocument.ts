/**
 * T-20260606-foot-CHART2-FOOTQ-VIEWER — 발건강질문지 자가작성 내용 "별도창 이미지화" 뷰어
 *
 * 현장 요청(김주연 총괄): 2번차트 [상담내역] 탭에서 자가작성 발건강질문지를
 *   별도 창에 "인쇄용 양식(이미지)"처럼 크게 열람. A안 확정 + PHASE1 시안 confirm
 *   ("레이아웃 여백 줄이고 반영ㄱㄱ", ts 1783523564.621079).
 *
 * 구현 방식(게이트 준수):
 *  - window.open 별도창 + 문서형 HTML/SVG 렌더 → 신규 npm 0 (html-to-image 미도입).
 *    (데이터가 원본 이미지가 아닌 폼 응답 JSONB 이므로 PNG 변환 불요 — 문서 레이아웃으로 이미지화)
 *  - 읽기 전용 (health_q_results 조회만, 변형 없음).
 *  - 현행 CRM warm 톤(Umber/Taupe) 통일 + PHASE1 대비 여백 축소(총괄 피드백 반영).
 *  - 고민되는 발톱 부위(concern_nail_sites) = FootToeIllustration 도형 1:1 미러 SVG.
 */

import { extractDisplayFields, FORM_TYPE_LABEL, type HQResult } from '@/components/HealthQResultsPanel';
import { parseFootSites, type FootSide } from '@/components/FootSiteSelector';

interface DocumentOpts {
  customerName: string;
  chartNumber?: string | null;
  clinicName?: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return esc(iso);
  }
}

// ── 발가락 일러스트 SVG (FootToeIllustration.tsx 도형/좌표/색 1:1 미러 · 읽기전용) ──
const VB_W = 120;
const VB_H = 114;
const BASE_TOES = [
  { toe: 1, cx: 22,  topY: 18, w: 28, h: 50 },
  { toe: 2, cx: 49,  topY: 10, w: 19, h: 47 },
  { toe: 3, cx: 69,  topY: 11, w: 18, h: 44 },
  { toe: 4, cx: 87,  topY: 17, w: 16, h: 39 },
  { toe: 5, cx: 102, topY: 26, w: 13, h: 33 },
];

function footSvg(side: FootSide, selected: Array<{ side: FootSide; toe: number }>): string {
  const toes = side === 'R' ? BASE_TOES : BASE_TOES.map((t) => ({ ...t, cx: VB_W - t.cx }));
  const blushX = side === 'R' ? 36 : VB_W - 36;
  const isSel = (toe: number) => selected.some((s) => s.side === side && s.toe === toe);
  let g = '';
  for (const t of toes) {
    const active = isSel(t.toe);
    const x = t.cx - t.w / 2;
    const nailW = t.w * 0.64;
    const nailH = t.h * 0.34;
    const nailX = t.cx - nailW / 2;
    const nailY = t.topY + t.h * 0.12;
    g += `
      <g>
        <rect x="${x}" y="${t.topY}" width="${t.w}" height="${t.h}" rx="${t.w / 2}"
              fill="${active ? '#6E6353' : '#fdf6ec'}" stroke="${active ? '#443A35' : '#e7d8c3'}" stroke-width="2"/>
        <rect x="${nailX}" y="${nailY}" width="${nailW}" height="${nailH}" rx="${nailW * 0.4}"
              fill="${active ? '#C5BEA3' : '#fff7ec'}" stroke="${active ? '#443A35' : '#e7d8c3'}" stroke-width="1" opacity="0.95"/>
        <text x="${t.cx}" y="${t.topY + t.h * 0.76}" text-anchor="middle" font-size="${t.toe === 1 ? 12 : 10}"
              font-weight="700" fill="${active ? '#ffffff' : '#6E6353'}">${t.toe}</text>
      </g>`;
  }
  return `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="${side === 'L' ? '좌측' : '우측'} 발 발톱 선택">
    <rect x="5" y="58" width="${VB_W - 10}" height="50" rx="24" fill="#fdf6ec" stroke="#e7d8c3" stroke-width="2"/>
    <ellipse cx="${blushX}" cy="82" rx="15" ry="9" fill="#fbe3df" opacity="0.6"/>
    ${g}
  </svg>`;
}

/** 발건강질문지 자가작성 결과 → 인쇄용 문서 HTML 문자열 */
export function buildHealthQDocumentHtml(result: HQResult, opts: DocumentOpts): string {
  const clinicName = opts.clinicName || '오블리브 발톱교정센터';
  const formLabel = FORM_TYPE_LABEL[result.form_type] ?? result.form_type;
  const fields = extractDisplayFields(result.form_data);
  const nailSites = parseFootSites((result.form_data as Record<string, unknown>)?.concern_nail_sites);
  const pickedLabel = nailSites.map((s) => `${s.side}${s.toe}`).join(', ');

  const rows = fields
    .map(
      ({ label, value }) => `
        <div class="row"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`,
    )
    .join('');

  const nailSection = nailSites.length
    ? `
      <div class="section nail-sec">
        <div class="sec-title"><span class="no">◆</span> 고민되는 발톱 부위<span class="badge-new">고객 선택</span></div>
        <div class="nail-box">
          <div class="nail-head">
            <span class="q">고객이 직접 선택한, 가장 고민되는 발톱 부위입니다.</span>
            <span class="picked">${esc(pickedLabel)}</span>
          </div>
          <div class="feet">
            <div class="foot-col">${footSvg('L', nailSites)}<span class="cap">좌(L)</span></div>
            <div class="foot-col">${footSvg('R', nailSites)}<span class="cap">우(R)</span></div>
          </div>
          <div class="legend"><span class="sw"></span> 색이 채워진 발톱 = 고객이 선택한 고민 부위</div>
        </div>
      </div>`
    : '';

  const emptyNotice =
    fields.length === 0 && nailSites.length === 0
      ? `<div class="empty">입력된 자가작성 항목이 없습니다.</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>발건강질문지 자가작성 — ${esc(opts.customerName)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root{
    --ink:#2E3133; --ink-soft:#51585D; --label:#5C6166; --line:#E4E6E8; --border:#D3D6D9;
    --surface:#F4F5F6; --chip-bg:#E4E6E8; --primary:#443A35; --primary-hi:#6E6353;
    --taupe:#C5BEA3; --muted:#9CA1A6; --warn-bg:#fef3c7; --warn-tx:#92620a; --warn-bd:#fde08a;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body{ font-family:'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif; background:var(--surface); -webkit-font-smoothing:antialiased; }
  /* PHASE1 대비 여백 축소(총괄 피드백 반영) */
  .toolbar{ max-width:820px; margin:12px auto 0; display:flex; justify-content:flex-end; gap:8px; }
  .toolbar button{ font-family:inherit; font-size:12px; font-weight:600; color:#fff; background:var(--primary); border:none; border-radius:8px; padding:7px 14px; cursor:pointer; }
  .toolbar button:hover{ background:var(--primary-hi); }
  .win{ width:820px; margin:12px auto 28px; }
  .paper{ background:#fff; border:1px solid var(--border); border-radius:10px; padding:26px 30px 22px; box-shadow:0 10px 26px rgba(46,49,51,0.08); }
  .doc-head{ display:flex; align-items:flex-start; justify-content:space-between; padding-bottom:12px; border-bottom:2.5px solid var(--primary); }
  .clinic{ font-size:19px; font-weight:800; color:var(--ink); letter-spacing:-0.4px; }
  .clinic .sub{ display:block; font-size:11px; font-weight:500; color:var(--label); margin-top:2px; }
  .doc-title{ text-align:right; }
  .doc-title .kicker{ font-size:10.5px; color:var(--primary-hi); font-weight:700; letter-spacing:1px; }
  .doc-title .name{ font-size:16px; font-weight:800; color:var(--primary); margin-top:2px; }
  .patient{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; margin-top:12px; border:1px solid var(--border); border-radius:10px; overflow:hidden; background:var(--border); }
  .patient .cell{ background:var(--surface); padding:7px 12px; }
  .patient .cell .k{ font-size:9.5px; color:var(--label); font-weight:600; }
  .patient .cell .v{ font-size:13px; color:var(--ink); font-weight:700; margin-top:1px; }
  .section{ margin-top:16px; }
  .section > .sec-title{ display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:800; color:var(--ink); margin-bottom:8px; }
  .section > .sec-title .no{ min-width:20px; height:20px; border-radius:6px; background:var(--primary); color:#fff; font-size:11px; display:inline-flex; align-items:center; justify-content:center; font-weight:700; padding:0 5px; }
  .qa{ border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  .qa .row{ display:grid; grid-template-columns:190px 1fr; border-top:1px solid var(--line); }
  .qa .row:first-child{ border-top:none; }
  .qa .row .label{ background:var(--surface); padding:8px 13px; font-size:11.5px; color:var(--label); font-weight:600; }
  .qa .row .value{ padding:8px 13px; font-size:12.5px; color:var(--ink); line-height:1.45; }
  .nail-sec .sec-title .badge-new{ margin-left:6px; font-size:10px; font-weight:700; color:var(--primary); background:var(--surface); border:1px solid var(--taupe); border-radius:999px; padding:1px 8px; }
  .nail-box{ border:1px solid var(--border); border-radius:10px; padding:12px 16px 10px; background:linear-gradient(#fff,var(--surface)); }
  .nail-box .nail-head{ display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .nail-box .nail-head .q{ font-size:12px; color:var(--label); font-weight:600; }
  .nail-box .nail-head .picked{ margin-left:auto; font-family:'SF Mono',ui-monospace,monospace; font-size:12px; font-weight:700; color:var(--ink-soft); background:var(--chip-bg); border:1px solid var(--border); border-radius:6px; padding:2px 9px; }
  .feet{ display:flex; align-items:flex-start; justify-content:center; gap:32px; padding:2px 0; }
  .foot-col{ display:flex; flex-direction:column; align-items:center; gap:3px; }
  .foot-col svg{ width:120px; height:auto; }
  .foot-col .cap{ font-size:12px; font-weight:700; color:var(--label); }
  .nail-box .legend{ margin-top:8px; text-align:center; font-size:10.5px; color:var(--muted); }
  .nail-box .legend .sw{ display:inline-block; width:10px; height:10px; border-radius:3px; background:var(--primary-hi); border:1px solid var(--primary); vertical-align:-1px; margin-right:3px; }
  .empty{ margin-top:18px; padding:24px; text-align:center; font-size:13px; color:var(--muted); border:1px dashed var(--border); border-radius:10px; }
  .doc-foot{ margin-top:18px; padding-top:12px; border-top:1px dashed var(--border); display:flex; justify-content:space-between; align-items:center; }
  .doc-foot .stamp{ font-size:10px; color:var(--muted); }
  .doc-foot .ro{ font-size:10px; color:var(--ink-soft); background:var(--surface); border:1px solid var(--border); padding:3px 10px; border-radius:999px; font-weight:600; }
  @media print { .toolbar{ display:none; } .win{ margin:0 auto; } .paper{ box-shadow:none; border:none; } body{ background:#fff; } }
</style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">인쇄 / PDF 저장</button></div>
  <div class="win">
    <div class="paper">
      <div class="doc-head">
        <div class="clinic">${esc(clinicName)}<span class="sub">Foot Care Center</span></div>
        <div class="doc-title">
          <div class="kicker">SELF-REPORTED</div>
          <div class="name">${esc(formLabel)}</div>
        </div>
      </div>
      <div class="patient">
        <div class="cell"><div class="k">환자명</div><div class="v">${esc(opts.customerName || '—')}</div></div>
        <div class="cell"><div class="k">차트번호</div><div class="v">${esc(opts.chartNumber || '—')}</div></div>
        <div class="cell"><div class="k">작성일시</div><div class="v">${fmtDate(result.submitted_at)}</div></div>
        <div class="cell"><div class="k">양식</div><div class="v">자가작성</div></div>
      </div>
      ${emptyNotice}
      ${nailSection}
      ${rows ? `<div class="section"><div class="sec-title"><span class="no">◆</span> 자가작성 응답</div><div class="qa">${rows}</div></div>` : ''}
      <div class="doc-foot">
        <div class="stamp">본 문서는 환자 본인이 셀프접수 단계에서 직접 작성·제출한 내용을 그대로 이미지화한 것입니다.</div>
        <div class="ro">읽기 전용</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** 별도창(window.open) 으로 발건강질문지 자가작성 문서를 연다. */
export function openHealthQDocumentWindow(result: HQResult, opts: DocumentOpts): void {
  const html = buildHealthQDocumentHtml(result, opts);
  const win = window.open('', '_blank', 'width=900,height=1000,noopener');
  if (!win) {
    // 팝업 차단 fallback — Blob URL 로 새 탭 열기
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
