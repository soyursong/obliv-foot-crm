// DrugVerifyBadge — 약품 외부DB(HIRA/식약처) 검증 결과 배지 (presentational)
// Ticket: T-20260629-foot-RXSET-DRUG-EXTDB-VERIFY (AC-4 검증배지)
//
// 순수 표시 컴포넌트. 검증 판정(verdict)을 prop으로 받아 배지만 렌더한다.
//   · 데이터 조회/외부 API 호출 0 (라이브 와이어링은 AC-3 캐시 스키마 정착 후 별도 트랙).
//   · 검증 미주입(verdict 없음/pending+숨김옵션) 시 아무것도 렌더 안 함(scaffold 안전).
//   · 기존 ui/Badge variant 재사용(신규 패키지 0), 태블릿 UX(큰 글자·툴팁).
//
// AC-2 매칭설계(evidence/...AC2_matching_design.md §3) 모델을 그대로 표시.

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  describeIngredient,
  describeVerifyStatus,
  type DrugVerifyVerdict,
} from '@/lib/drugVerification';

interface DrugVerifyBadgeProps {
  /** 검증 판정. null/undefined면 렌더 안 함(미검증 약). */
  verdict?: DrugVerifyVerdict | null;
  /** 'pending'(대조전)도 배지로 노출할지. 기본 false(대조전은 숨김 — 노이즈 감소). */
  showPending?: boolean;
  /** 성분 2차축 부가표기 노출 여부. 기본 true. */
  showIngredient?: boolean;
  className?: string;
  /** 테스트 식별자. */
  testId?: string;
}

const INGREDIENT_TONE: Record<'ok' | 'warn' | 'muted', string> = {
  ok: 'text-emerald-600',
  warn: 'text-amber-600',
  muted: 'text-slate-400',
};

export default function DrugVerifyBadge({
  verdict,
  showPending = false,
  showIngredient = true,
  className,
  testId = 'drug-verify-badge',
}: DrugVerifyBadgeProps) {
  if (!verdict) return null;
  if (verdict.status === 'pending' && !showPending) return null;

  const meta = describeVerifyStatus(verdict.status);
  const ing = showIngredient ? describeIngredient(verdict.ingredient) : null;

  // 성분 2차축은 1차 배지 색을 바꾸지 않고, 옆에 작은 점으로만 부가표기(설계 §3).
  return (
    <span
      className={cn('inline-flex items-center gap-1 align-middle', className)}
      data-testid={testId}
      data-verify-status={verdict.status}
      title={meta.tooltip}
    >
      <Badge variant={meta.variant} className="gap-0.5">
        {meta.mark && <span aria-hidden>{meta.mark}</span>}
        {meta.label}
      </Badge>
      {ing && (
        <span
          className={cn('text-[11px] leading-none', INGREDIENT_TONE[ing.tone])}
          data-testid={`${testId}-ingredient`}
          data-ingredient={verdict.ingredient}
          title={ing.label}
          aria-label={ing.label}
        >
          ●
        </span>
      )}
    </span>
  );
}
