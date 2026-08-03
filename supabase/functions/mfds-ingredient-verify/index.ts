/**
 * mfds-ingredient-verify — 식약처(MFDS) e약은요/완제의약품 2차 성분축 대조 Edge Function
 *
 * T-20260629-foot-RXSET-DRUG-VERIFY-PHASE2 (AC-7 식약처 2차 성분축 code-wiring)
 * parent: T-20260629-foot-RXSET-DRUG-EXTDB-VERIFY (1차 HIRA 코드축 라이브)
 *
 * POST /functions/v1/mfds-ingredient-verify
 * Body: { drug_name: string, expected_ingredient?: string, item_seq?: string }
 * Auth: Supabase Bearer JWT (authenticated staff)
 *
 * PHI 아님 — 약품명/성분명 대조 전용(환자데이터·RRN 무관).
 *
 * ── Edge Secrets (supervisor 주입, 평문하드코딩 금지 · RRN/Vault 정책) ──────────
 *   MFDS_API_KEY  — data.go.kr 활용신청 인증키 (e약은요/완제의약품)
 *   MFDS_API_URL  — 식약처 OpenAPI 엔드포인트
 *                   예: https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList
 *   MFDS_MOCK=true — dev 모의응답 (dev Secrets 에만 설정; prod 미설정 — 환경 분리)
 *   미설정 시 → 503 { ingredient:'unverified', error:'MFDS_NOT_CONFIGURED' } (graceful, AC-5)
 *
 * 응답:
 *   200: { ingredient:'matched'|'mismatch'|'unverified', official_ingredients:string[], degraded?:boolean }
 *   400: { error:'INVALID_BODY' | 'MISSING_DRUG_NAME' }
 *   401: { error:'UNAUTHORIZED' }
 *   502: { ingredient:'unverified', error:'MFDS_API_ERROR' }        — 식약처 장애(비차단, AC-5)
 *   503: { ingredient:'unverified', error:'MFDS_NOT_CONFIGURED' }   — 키 미설정(비차단, AC-5)
 *
 * ★canon(부모 drug_identity_rule): 퍼지·용량표기 자동연결 금지 — 정확일치만 'matched'.
 * ⚠️ 검증결과 영속 캐시(AC-3)는 이 함수에 없음 — DA CONSULT 선행 후속 트랙. 매 호출 무상태.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

/** 식약처 응답 파싱 타임아웃(ms) — 초과 시 graceful degrade(비차단). */
const FETCH_TIMEOUT_MS = 8000;

/**
 * 성분명 정규화(FE drugVerification.ts 와 동일 canon).
 *   trim + 내부 연속공백 1칸 + 소문자. ★용량표기 미제거(auto-merge 금지) · 퍼지 없음.
 */
export function normalizeIngredientName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 내부 성분명 ↔ 공식 성분명(들) 정확대조(canon). matched | mismatch | unverified(대조불가). */
export function compareIngredient(
  internalName: string | null | undefined,
  officialNames: (string | null | undefined)[] | null | undefined,
): 'matched' | 'mismatch' | 'unverified' {
  const internal = normalizeIngredientName(internalName);
  const officials = (officialNames ?? [])
    .map(normalizeIngredientName)
    .filter((s) => s !== '');
  if (internal === '' || officials.length === 0) return 'unverified';
  return officials.includes(internal) ? 'matched' : 'mismatch';
}

/**
 * 식약처 응답 JSON 에서 공식 성분명 후보를 방어적으로 추출.
 * (서비스별 필드명이 상이 — e약은요/완제의약품 공통 후보키를 폭넓게 스캔.
 *  실 필드 매핑은 키 활성화 시점에 라이브 응답으로 최종 확정 — 스캐폴드 단계 방어 추출.)
 */
export function extractIngredients(json: unknown): string[] {
  const out: string[] = [];
  const INGR_KEYS = [
    'MAIN_INGR_ENG', 'MAIN_INGR_KOR', 'MATERIAL_NAME', 'MAIN_ITEM_INGR',
    'ingredient', 'ingr_name', 'ingrName', 'mainIngr', 'INGR_NAME',
  ];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (INGR_KEYS.includes(k) && typeof v === 'string' && v.trim() !== '') {
          // 다성분 구분자(; / ,) 분리해 각 성분을 후보로.
          v.split(/[;/,]/).forEach((p) => { if (p.trim() !== '') out.push(p.trim()); });
        } else if (v !== null && typeof v === 'object') {
          walk(v);
        }
      }
    }
  };
  walk(json);
  return out;
}

/** MFDS_MOCK 모의응답 — dev/test 용. 결정적 성분 목록 반환. */
function mockIngredients(drugName: string): string[] {
  // 약품명에 특정 토큰이 있으면 그 성분을 '공식'으로 흉내(dev 확인용).
  const n = drugName.toLowerCase();
  if (n.includes('아목시실린') || n.includes('amoxicillin')) return ['아목시실린'];
  if (n.includes('세파클러') || n.includes('cefaclor')) return ['세파클러'];
  return ['테스트성분'];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // JWT 인증(스태프).
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers: JSON_HEADERS });
  }
  try {
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.slice(7));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers: JSON_HEADERS });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers: JSON_HEADERS });
  }

  // 요청 파싱.
  let body: { drug_name?: string; expected_ingredient?: string | null; item_seq?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'INVALID_BODY' }), { status: 400, headers: JSON_HEADERS });
  }
  const drugName = (body.drug_name ?? '').trim();
  const expected = body.expected_ingredient ?? null;
  const itemSeq = (body.item_seq ?? '').toString().trim();
  if (drugName === '') {
    return new Response(JSON.stringify({ error: 'MISSING_DRUG_NAME' }), { status: 400, headers: JSON_HEADERS });
  }

  const mock = (Deno.env.get('MFDS_MOCK') ?? '').toLowerCase() === 'true';
  const apiKey = Deno.env.get('MFDS_API_KEY') ?? '';
  const apiUrl = Deno.env.get('MFDS_API_URL') ?? '';

  // MOCK 경로(dev) — 키 없이 결정적 응답.
  if (mock) {
    const officials = mockIngredients(drugName);
    return new Response(
      JSON.stringify({ ingredient: compareIngredient(expected, officials), official_ingredients: officials, degraded: false }),
      { status: 200, headers: JSON_HEADERS },
    );
  }

  // 키/엔드포인트 미설정 → graceful degrade(비차단, AC-5). 처방/저장 막지 않음.
  if (apiKey === '' || apiUrl === '') {
    return new Response(
      JSON.stringify({ ingredient: 'unverified', official_ingredients: [], degraded: true, error: 'MFDS_NOT_CONFIGURED' }),
      { status: 503, headers: JSON_HEADERS },
    );
  }

  // 식약처 OpenAPI 실호출(키 활성화 후). 실패는 전부 'unverified' 로 흡수(비차단).
  const params = new URLSearchParams({ serviceKey: apiKey, type: 'json', numOfRows: '10', pageNo: '1' });
  if (itemSeq !== '') params.set('item_seq', itemSeq);
  else params.set('itemName', drugName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${apiUrl}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ ingredient: 'unverified', official_ingredients: [], degraded: true, error: 'MFDS_API_ERROR' }),
        { status: 502, headers: JSON_HEADERS },
      );
    }
    const json = await resp.json();
    const officials = extractIngredients(json);
    return new Response(
      JSON.stringify({ ingredient: compareIngredient(expected, officials), official_ingredients: officials, degraded: false }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch {
    clearTimeout(timer);
    // 타임아웃/네트워크 → graceful degrade.
    return new Response(
      JSON.stringify({ ingredient: 'unverified', official_ingredients: [], degraded: true, error: 'MFDS_API_ERROR' }),
      { status: 502, headers: JSON_HEADERS },
    );
  }
});
