/**
 * toast wrapper — info(파랑) · success(연두) 묵음 처리.
 * error(빨강) · warning(노랑) 은 원본 sonner 그대로 통과.
 *
 * T-20260524-foot-TOAST-CLEANUP
 */
import { toast as _toast } from 'sonner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop = (..._args: any[]) => undefined;

export const toast = new Proxy(_toast, {
  /** bare toast('...') → 기본값은 info 계열 → 묵음 */
  apply(_target, _thisArg, _args) {
    return undefined;
  },
  get(target, prop: PropertyKey) {
    if (prop === 'success' || prop === 'info') return noop;
    return Reflect.get(target, prop);
  },
}) as typeof _toast;
