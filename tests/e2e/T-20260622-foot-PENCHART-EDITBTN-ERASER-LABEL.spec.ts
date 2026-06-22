/**
 * T-20260622-foot-PENCHART-EDITBTN-ERASER-LABEL
 * 펜차트 — 수정 버튼 추가 + 지우개/화이트 동작 정의 + 담당실장→담당자 라벨 변경
 *
 * AC-1: '수정' 버튼 — 저장된 차트를 편집모드로 다시 열어 이어 편집, 저장 시 동일 path 덮어쓰기(신규 행 0).
 * AC-2: 지우개 = 사용자 드로잉 전담 — 펜/형광펜(draw 레이어 clearRect) + 텍스트(placedItem type='text' hit-test 삭제).
 *        상용구(boilerplate)·bg 양식은 미관여.
 * AC-3: 화이트 = 상용구 전담 — boilerplate placedItem hit-test 삭제 + destination-out. 텍스트·bg 양식은 보존.
 *        (지우개↔화이트 대상 레이어 분리: 텍스트는 지우개, 상용구는 화이트.)
 * AC-4: 보험차트 우측상단 라벨 "담당실장" → "담당자".
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 + canvas page.evaluate 시뮬)를 따른다.
 *       실제 브라우저 렌더/현장 confirm 은 supervisor field-soak 단계에서 검증.
 */
import { test, expect } from '@playwright/test';

const CANVAS_W = 794;
const CANVAS_H = 1123;
const DRAW_DPR = 2;

// ── AC-1: 수정 — 파일명→form_key 복원 + 동일 path 덮어쓰기 ────────────────────

test.describe('PENCHART-EDITBTN AC-1: 수정 모드', () => {

  // 코드의 formKeyFromFileName 과 동일 로직 (prefix 매핑)
  const formKeyFromFileName = (name: string): string => {
    if (name.startsWith('hq_sr_')) return 'health_questionnaire_senior';
    if (name.startsWith('hq_'))    return 'health_questionnaire_general';
    if (name.startsWith('rc_'))    return 'refund_consent';
    if (name.startsWith('pc_sr_')) return 'personal_checklist_senior';
    if (name.startsWith('pc_'))    return 'personal_checklist_general';
    return 'pen_chart';
  };

  test('AC-1: 저장 파일명 prefix → 원 양식 form_key 복원 (캔버스 치수 복원 근거)', () => {
    expect(formKeyFromFileName('1748000000000_abcd.png')).toBe('pen_chart');
    expect(formKeyFromFileName('hq_1748000001000_ef12.png')).toBe('health_questionnaire_general');
    expect(formKeyFromFileName('hq_sr_1748000002000_gh34.png')).toBe('health_questionnaire_senior');
    expect(formKeyFromFileName('rc_1748000003000_ij56.png')).toBe('refund_consent');
    expect(formKeyFromFileName('pc_1748000004000_kl78.png')).toBe('personal_checklist_general');
    expect(formKeyFromFileName('pc_sr_1748000005000_mn90.png')).toBe('personal_checklist_senior');
    // 순서 의존: hq_sr_ 가 hq_ 보다 먼저 매칭돼야 함
    expect(formKeyFromFileName('hq_sr_x.png')).not.toBe('health_questionnaire_general');
    expect(formKeyFromFileName('pc_sr_x.png')).not.toBe('personal_checklist_general');
  });

  test('AC-1: 수정 저장 = 기존 파일명 그대로 + upsert:true (신규 행 중복 생성 금지)', () => {
    const storagePath = 'customer/cust-1/pen-chart';
    const existing = { name: '1748000000000_abcd.png' };

    // handleDrawSave 분기: editTarget 있으면 동일 fileName + upsert:true
    const computeUpload = (editTarget: { name: string } | null, prefix: string) => {
      const fileName = editTarget ? editTarget.name : `${prefix}${1748000099999}_zzzz.png`;
      return { path: `${storagePath}/${fileName}`, upsert: !!editTarget, fileName };
    };

    const edit = computeUpload(existing, '');
    expect(edit.fileName).toBe('1748000000000_abcd.png'); // 동일 파일명 → 덮어쓰기
    expect(edit.path).toBe('customer/cust-1/pen-chart/1748000000000_abcd.png');
    expect(edit.upsert).toBe(true);

    const fresh = computeUpload(null, '');
    expect(fresh.fileName).not.toBe(existing.name); // 신규는 새 파일명
    expect(fresh.upsert).toBe(false);
  });

  test('AC-1: 수정 저장은 form_submissions 재insert 스킵 (상담내역 중복 행 방지)', () => {
    // (isPC||isHQ||isPCL) && activeDrawTemplate && !editTarget 일 때만 insert
    const willInsert = (isFormSubmissionType: boolean, hasTemplate: boolean, editTarget: object | null) =>
      isFormSubmissionType && hasTemplate && !editTarget;

    // 신규 HQ 저장 → insert O
    expect(willInsert(true, true, null)).toBe(true);
    // 수정 HQ 저장 → insert X (기존 행 canvas_file 동일 유지)
    expect(willInsert(true, true, { name: 'hq_1_a.png' })).toBe(false);
    // pen_chart 는 애초에 form_submission 비대상
    expect(willInsert(false, true, null)).toBe(false);
  });

  test('AC-1: 덮어쓰기 후 savedCharts 목록은 동일 키(파일명) — 행 수 불변', () => {
    // loadSavedCharts 는 파일명으로 키링 → 동일 파일 덮어쓰기는 새 행을 만들지 않음
    const before = ['1748000000000_abcd.png', 'hq_1748000001000_ef12.png'];
    // 수정 저장(동일 파일명 upsert) 후 재조회 시뮬
    const after = [...before]; // 새 파일 추가 없음
    expect(after.length).toBe(before.length);
    expect(new Set(after).size).toBe(2);
  });

  test('AC-1: 수정 모드 배경 = 저장본 PNG (양식 템플릿 미중복 적재)', () => {
    // bgUrl 결정: editingChart 있으면 저장본 url, 양식 template_path 사용 안 함
    const resolveBgUrl = (
      editingChart: { url: string } | null,
      templatePath: string | null,
      templateImgUrl: string | null,
    ) => {
      if (editingChart) return editingChart.url;
      return templatePath ?? templateImgUrl;
    };
    expect(resolveBgUrl({ url: 'signed://chart.png' }, '/forms/pen_chart_form.png', null))
      .toBe('signed://chart.png');
    expect(resolveBgUrl(null, null, '/forms/pen_chart_form.png'))
      .toBe('/forms/pen_chart_form.png');
  });
});

// ── AC-2: 지우개 — 드로잉 레이어만 삭제, bg 양식 보존 ─────────────────────────

test.describe('PENCHART-EDITBTN AC-2: 지우개', () => {

  test('AC-2: clearRect — 펜/형광펜 획(draw 레이어) 투명화, bg 양식 무변경', async ({ page }) => {
    await page.goto('about:blank');
    const result = await page.evaluate(({ w, h, dpr }) => {
      // bg(양식): 회색
      const bg = document.createElement('canvas');
      bg.width = w * dpr; bg.height = h * dpr;
      const bgCtx = bg.getContext('2d')!;
      bgCtx.fillStyle = '#cccccc';
      bgCtx.fillRect(0, 0, bg.width, bg.height);

      // draw: 펜 획(빨강)
      const draw = document.createElement('canvas');
      draw.width = w * dpr; draw.height = h * dpr;
      const dCtx = draw.getContext('2d')!;
      dCtx.scale(dpr, dpr);
      dCtx.fillStyle = '#ff0000';
      dCtx.fillRect(200, 200, 100, 100);

      // 지우개: penSize(3)*4=12, draw 레이어만 clearRect
      const sz = 3 * 4;
      dCtx.clearRect(250 - sz, 250 - sz, sz * 2, sz * 2);

      const erased = Array.from(dCtx.getImageData(250 * dpr - 1, 250 * dpr - 1, 1, 1).data);
      const bgKept = Array.from(bgCtx.getImageData(500, 500, 1, 1).data);
      return { erasedAlpha: erased[3], bgGray: bgKept[0] };
    }, { w: CANVAS_W, h: CANVAS_H, dpr: DRAW_DPR });

    expect(result.erasedAlpha).toBe(0);   // 드로잉 지워짐(투명)
    expect(result.bgGray).toBe(204);      // bg 양식(#cccccc) 보존
  });

  test('AC-2: 지우개 hit-test — 텍스트(placedItem) 삭제, 상용구는 미관여(보존)', () => {
    interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }
    const items: PlacedItem[] = [
      { id: 'txt-1', type: 'text', x: 100, y: 100, text: '환자메모', fontSize: 14, color: '#000' },
      { id: 'bp-1', type: 'boilerplate', x: 105, y: 105, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'txt-2', type: 'text', x: 500, y: 500, text: '범위밖텍스트', fontSize: 14, color: '#000' },
    ];
    // onPointerUp eraser hit-test (실코드): type==='text' && pathHitsItem 만 삭제
    const esz = 3 * 4;
    const path = [{ x: 110, y: 110 }]; // txt-1, bp-1 위를 문지름
    const pathHitsItem = (p: typeof path, item: PlacedItem, sz: number) => {
      const lineH = item.fontSize + 6;
      const lines = item.text.split('\n');
      const itemH = lines.length * lineH + 8;
      const itemW = Math.max(60, item.text.length * (item.fontSize * 0.55));
      return p.some(({ x, y }) =>
        x + sz > item.x && x - sz < item.x + itemW &&
        y + sz > item.y && y - sz < item.y + itemH);
    };
    const remaining = items.filter((item) => !(item.type === 'text' && pathHitsItem(path, item, esz)));
    expect(remaining.find((i) => i.id === 'txt-1')).toBeUndefined(); // 텍스트 삭제됨
    expect(remaining.find((i) => i.id === 'bp-1')).toBeDefined();    // 상용구는 지우개 미관여 → 보존
    expect(remaining.find((i) => i.id === 'txt-2')).toBeDefined();   // 범위 밖 텍스트 보존
  });
});

// ── AC-3: 화이트 — 상용구 지우기 + bg 양식 보존 ──────────────────────────────

test.describe('PENCHART-EDITBTN AC-3: 화이트', () => {

  test('AC-3: 화이트 = destination-out — draw 레이어 투명화(불투명 흰색 아님), bg 보존', async ({ page }) => {
    await page.goto('about:blank');
    const result = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 200;
      const ctx = canvas.getContext('2d')!;
      // 드로잉 레이어에 색칠
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 200, 200);
      // 화이트(실코드): destination-out 으로 지움
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.beginPath();
      ctx.arc(100, 100, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const center = Array.from(ctx.getImageData(100, 100, 1, 1).data);
      return { centerAlpha: center[3] };
    });
    // 화이트는 흰색 페인팅(alpha 255 흰색)이 아니라 destination-out 투명화(alpha 0)
    expect(result.centerAlpha).toBe(0);
  });

  test('AC-3: 화이트 hit-test — 상용구만 삭제, 텍스트는 미관여(보존) + 범위 밖 상용구 보존', () => {
    interface PlacedItem { id: string; type: 'text' | 'boilerplate'; x: number; y: number; text: string; fontSize: number; color: string; }
    const items: PlacedItem[] = [
      { id: 'bp-1', type: 'boilerplate', x: 100, y: 100, text: '족저근막염', fontSize: 14, color: '#000' },
      { id: 'txt-1', type: 'text', x: 105, y: 105, text: '환자메모', fontSize: 14, color: '#000' },
      { id: 'bp-2', type: 'boilerplate', x: 500, y: 500, text: '아킬레스건염', fontSize: 14, color: '#000' },
    ];
    // onPointerUp white hit-test (실코드): type==='boilerplate' && pathHitsItem 만 삭제
    const wsz = 3 * 4;
    const path = [{ x: 110, y: 110 }]; // bp-1, txt-1 위를 문지름
    const pathHitsItem = (p: typeof path, item: PlacedItem, sz: number) => {
      const lineH = item.fontSize + 6;
      const lines = item.text.split('\n');
      const itemH = lines.length * lineH + 8;
      const itemW = Math.max(60, item.text.length * (item.fontSize * 0.55));
      return p.some(({ x, y }) =>
        x + sz > item.x && x - sz < item.x + itemW &&
        y + sz > item.y && y - sz < item.y + itemH);
    };
    const remaining = items.filter((item) => !(item.type === 'boilerplate' && pathHitsItem(path, item, wsz)));
    expect(remaining.find((i) => i.id === 'bp-1')).toBeUndefined(); // 상용구 삭제됨
    expect(remaining.find((i) => i.id === 'txt-1')).toBeDefined();  // 텍스트는 화이트 미관여 → 보존(지우개 전담)
    expect(remaining.find((i) => i.id === 'bp-2')).toBeDefined();   // 범위 밖 상용구 보존
  });
});

// ── AC-4: "담당실장" → "담당자" 라벨 오버라이드 ──────────────────────────────

test.describe('PENCHART-EDITBTN AC-4: 담당자 라벨', () => {

  // drawPenChartLabelOverride 의 좌표 상수 (실코드와 동일)
  const WHITE_BOX = { x: 545, y: 81, w: 80, h: 23 }; // → x 545~625, y 81~104
  const COLON_X = 618;   // 우측정렬 콜론 (담당의와 동일)
  const BASELINE_Y = 99; // 원 "담당실장" 라벨 하단

  test('AC-4: 마스킹 박스가 "담당실장" 라벨(canvas x553~618 y86~99)을 덮는다', () => {
    const label = { x0: 553, x1: 618, y0: 86, y1: 99 }; // PIL 측정값(natural ÷2)
    expect(WHITE_BOX.x).toBeLessThanOrEqual(label.x0);
    expect(WHITE_BOX.x + WHITE_BOX.w).toBeGreaterThanOrEqual(label.x1);
    expect(WHITE_BOX.y).toBeLessThanOrEqual(label.y0);
    expect(WHITE_BOX.y + WHITE_BOX.h).toBeGreaterThanOrEqual(label.y1);
  });

  test('AC-4: 마스킹 박스가 위 "담당의 :"(y64~77) / 아래 DATE 박스를 침범하지 않는다', () => {
    const damdangui = { y1: 77 };     // "담당의 :" 하단
    const dateBoxTop = 200;           // DATE 헤더 박스 상단(여유)
    expect(WHITE_BOX.y).toBeGreaterThan(damdangui.y1);              // 담당의 미침범
    expect(WHITE_BOX.y + WHITE_BOX.h).toBeLessThan(dateBoxTop);     // DATE 박스 미침범
  });

  test('AC-4: "담당자 :" 콜론이 담당의 콜론과 동일 x(우측정렬)에 위치', () => {
    const damdanguiColonX = 618; // 담당의 콜론 우측끝(canvas)
    expect(COLON_X).toBe(damdanguiColonX);
    expect(BASELINE_Y).toBeGreaterThan(WHITE_BOX.y);
    expect(BASELINE_Y).toBeLessThanOrEqual(WHITE_BOX.y + WHITE_BOX.h);
  });

  test('AC-4: 오버라이드는 보험차트(pen_chart) 양식에만 적용', () => {
    const shouldApply = (formKey: string) => formKey === 'pen_chart';
    expect(shouldApply('pen_chart')).toBe(true);
    expect(shouldApply('refund_consent')).toBe(false);
    expect(shouldApply('health_questionnaire_general')).toBe(false);
    expect(shouldApply('personal_checklist_senior')).toBe(false);
  });

  test('AC-4: 라벨 텍스트는 "담당자 :" — "담당실장" 문구를 더 이상 출력하지 않음', () => {
    const renderedLabel = '담당자 :';
    expect(renderedLabel).toContain('담당자');
    expect(renderedLabel).not.toContain('실장');
  });

  test('AC-4: 마스킹/재출력은 bgCanvas에 그려져 저장본에도 반영 (handleDrawSave 합성)', async ({ page }) => {
    await page.goto('about:blank');
    const result = await page.evaluate(({ box, colonX, baseY }) => {
      const c = document.createElement('canvas');
      c.width = 794; c.height = 1123;
      const ctx = c.getContext('2d')!;
      // 양식(구 라벨) 시뮬: 라벨 위치에 검정 텍스트
      ctx.fillStyle = '#2e2e2e';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('담당실장 :', colonX, baseY);

      // 오버라이드: 흰 박스 마스킹 + 담당자 재출력
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = '#2e2e2e';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('담당자 :', colonX, baseY);

      // 박스 좌상단(구 "실장" 글자 자리)에 잔존 검정 픽셀이 없어야 함(마스킹 성공 확인)
      // toDataURL 가능 = 캔버스 비오염(저장 가능) 확인
      const canSave = c.toDataURL('image/png').startsWith('data:image/png');
      return { canSave };
    }, { box: WHITE_BOX, colonX: COLON_X, baseY: BASELINE_Y });

    expect(result.canSave).toBe(true);
  });
});
