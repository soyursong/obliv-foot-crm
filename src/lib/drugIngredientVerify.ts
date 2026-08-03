// drugIngredientVerify — 식약처(MFDS) e약은요/완제의약품 2차 성분축 검증 (async invoke 레이어)
// Ticket: T-20260629-foot-RXSET-DRUG-VERIFY-PHASE2 (AC-7 식약처 2차 성분축 code-wiring)
//
// 이 모듈은 Edge Function(mfds-ingredient-verify)을 호출하는 얇은 래퍼다.
//   · 키(data.go.kr OpenAPI)는 ★Edge Secret(supervisor 주입) — 클라이언트 번들에 노출 안 함(평문하드코딩 금지).
//   · 미설정/장애/타임아웃 → 'unverified'(AC-5 graceful degrade, 비차단). 절대 throw 로 처방/저장을 막지 않음.
//   · 기능 플래그(VITE_MFDS_INGREDIENT_VERIFY) 기본 OFF — 키 주입·활성화 전까지 네트워크 호출 0(inert).
//   · 순수 판정(compareIngredient·mergeIngredientAxis)은 drugVerification.ts(외부 import 0)에 있어 테스트 격리.
//
// 신규 npm 0 · 신규 DB 스키마 0 (AC-3 검증결과 영속 캐시는 DA CONSULT 선행 후속 트랙 — 본 모듈은 캐시 없음).

import { supabase } from './supabase';
import { EDGE_FUNCTIONS } from './externalServices';
import type { IngredientVerifyStatus } from './drugVerification';

export interface IngredientVerifyRequest {
  /** 내부 약품명(대조 대상). */
  drug_name: string;
  /** 내부 성분명(있으면 식약처 공식 성분과 정확대조). 없으면 대조불가('unverified'). */
  expected_ingredient?: string | null;
  /** 식약처 품목기준코드(있으면 정밀 조회). */
  item_seq?: string | null;
}

/** Edge Function 응답 형태(부분집합). */
interface IngredientVerifyResponse {
  ingredient?: string;
  official_ingredients?: string[];
  error?: string;
  degraded?: boolean;
}

/**
 * 기능 활성 여부 — 기본 OFF(키 주입 전 inert, 네트워크 호출 0).
 * supervisor 가 식약처 키(Edge Secret) 주입 + 활성화 시 VITE_MFDS_INGREDIENT_VERIFY=on 로 켠다.
 */
export function isIngredientVerifyEnabled(): boolean {
  // import.meta.env 는 노드 테스트 컨텍스트에서 undefined 일 수 있어 옵셔널 접근.
  const raw = (import.meta as { env?: Record<string, unknown> })?.env?.VITE_MFDS_INGREDIENT_VERIFY;
  const flag = (raw ?? '').toString().trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'on';
}

/**
 * 식약처 2차 성분축 검증. 비차단 — 어떤 실패도 'unverified' 로 흡수(AC-5 graceful degrade).
 * 플래그 OFF(기본)이거나 약품명이 없으면 네트워크 호출 없이 즉시 'unverified'.
 */
export async function verifyDrugIngredient(
  req: IngredientVerifyRequest,
): Promise<IngredientVerifyStatus> {
  if (!isIngredientVerifyEnabled()) return 'unverified';
  if (!req?.drug_name || req.drug_name.trim() === '') return 'unverified';
  try {
    const { data, error } = await supabase.functions.invoke(
      EDGE_FUNCTIONS.MFDS_INGREDIENT_VERIFY,
      {
        body: {
          drug_name: req.drug_name,
          expected_ingredient: req.expected_ingredient ?? null,
          item_seq: req.item_seq ?? null,
        },
      },
    );
    if (error || !data) return 'unverified';
    const status = (data as IngredientVerifyResponse).ingredient;
    if (status === 'matched' || status === 'mismatch') return status;
    // MFDS_NOT_CONFIGURED / 대조불가 / 예상 밖 값 → 비차단.
    return 'unverified';
  } catch {
    // 네트워크/타임아웃/직렬화 오류 → graceful degrade.
    return 'unverified';
  }
}
