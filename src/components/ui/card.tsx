import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 컴팩트 기본값 정책 (T-20260701-foot-NEWSECTION-COMPACT-DEFAULT):
 * 풋센터 CRM 신규 구역은 별도 지정 없이 컴팩트하게 렌더한다.
 * → 공용 Card 래퍼의 기본 패딩을 p-4(16px) → p-3(12px)로 축소.
 * className으로 명시 override한 화면은 그대로 우선 적용된다(cn merge, 회귀 없음).
 * 태블릿 터치타깃(버튼/입력 높이)은 건드리지 않음 — 컨테이너 여백만 축소.
 */
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}
        {...props}
      />
    );
  },
);

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1.5 p-3', className)} {...props} />;
  },
);

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return <h3 ref={ref} className={cn('font-semibold text-base leading-none', className)} {...props} />;
  },
);

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-3 pt-0', className)} {...props} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex items-center p-3 pt-0', className)} {...props} />;
  },
);
