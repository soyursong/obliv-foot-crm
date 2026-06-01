/**
 * toast wrapper — info(파랑) · success(연두) 묵음 처리.
 * error(빨강) · warning(노랑) 은 원본 sonner 그대로 통과.
 *
 * T-20260524-foot-TOAST-CLEANUP
 *
 * T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS:
 *   generic success/info 묵음은 유지하되, 현장이 반드시 확인해야 하는 "중요 완료"
 *   피드백(공간배정 저장 등)을 위한 묵음 제외 채널 `toast.confirm` 추가.
 *   silent 저장 금지(AC-저장-2): 저장 결과는 성공/실패 모두 화면에 보여야 한다.
 */
import { toast as _toast } from 'sonner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop = (..._args: any[]) => undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SuccessData = Parameters<typeof _toast.success>[1];

export type ToastWithConfirm = typeof _toast & {
  /**
   * 묵음 대상에서 제외되는 '중요 완료 확인' 채널.
   * 저장 완료처럼 현장이 결과를 반드시 봐야 하는 피드백에만 사용한다.
   */
  confirm: (message: string, data?: SuccessData) => ReturnType<typeof _toast.success>;
};

export const toast = new Proxy(_toast, {
  /** bare toast('...') → 기본값은 info 계열 → 묵음 */
  apply(_target, _thisArg, _args) {
    return undefined;
  },
  get(target, prop: PropertyKey) {
    // 중요 완료 확인 — 원본 sonner success 로 통과 (묵음 제외)
    if (prop === 'confirm') {
      return (message: string, data?: SuccessData) => target.success(message, data);
    }
    if (prop === 'success' || prop === 'info') return noop;
    return Reflect.get(target, prop);
  },
}) as ToastWithConfirm;
