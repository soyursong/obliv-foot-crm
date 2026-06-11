/**
 * SendMethodSelector — 문자 발송방식 선택(즉시 / 예약) 공용 위젯
 * T-20260612-foot-SMS-SCHEDULE-SEND-OPTION (김주연 총괄)
 *
 * 두 진입점(대시보드 우클릭 [문자] / 메시지 설정 화면 발송)에서 동일 UI 재사용.
 *  - 즉시: 기존 발송 동선(send-notification EF 호출)
 *  - 예약: 날짜+시간 picker 로 지정 시각 입력 → scheduled_messages 적재 → pg_cron 디스패치
 *
 * 과거 시각 차단(AC): 예약 모드에서 선택 시각이 현재(KST) 이하이면 invalid → 부모가 발송 차단.
 * KST 처리: <input type="datetime-local"> 값('YYYY-MM-DDTHH:MM')을 현장 KST 로 간주,
 *           parseScheduledKstToUtcIso() 가 +09:00 을 붙여 UTC ISO 로 변환(저장값).
 *
 * 부모 계약:
 *  - value: { mode, localValue } 상태를 부모가 보유하고 onChange 로 갱신.
 *  - available=false (scheduled_messages 미배포 환경 등) → '예약' 옵션 비활성 + 안내.
 *  - 유효성은 부모가 validateScheduled()/parseScheduledKstToUtcIso() 로 판정.
 */
import { Clock, Send } from 'lucide-react';

export type SendMode = 'immediate' | 'scheduled';

export interface SendMethodValue {
  mode: SendMode;
  /** datetime-local 원시값 'YYYY-MM-DDTHH:MM' (KST 로 해석) */
  localValue: string;
}

interface Props {
  value: SendMethodValue;
  onChange: (v: SendMethodValue) => void;
  /** scheduled_messages 사용 가능 여부(마이그레이션 적용 전이면 false → 예약 비활성) */
  available?: boolean;
  disabled?: boolean;
}

/** datetime-local 최소값 = 지금 +5분(KST). 과거·임박 시각 입력을 input 단계에서도 1차 차단. */
export function minScheduleLocal(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000 + 5 * 60 * 1000);
  return kst.toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'
}

/**
 * 'YYYY-MM-DDTHH:MM'(KST 로 해석) → UTC ISO 문자열.
 * 빈값/형식오류면 null.
 */
export function parseScheduledKstToUtcIso(localValue: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue ?? '');
  if (!m) return null;
  // KST 입력을 명시 오프셋(+09:00)으로 해석 → 정확한 instant.
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * 예약 시각 유효성: 선택 시각이 현재(now)보다 미래여야 함(과거시각 차단 AC).
 * 반환 null=유효, 문자열=에러 메시지.
 */
export function validateScheduled(localValue: string): string | null {
  const utcIso = parseScheduledKstToUtcIso(localValue);
  if (!utcIso) return '발송 일시를 선택하세요.';
  if (new Date(utcIso).getTime() <= Date.now()) {
    return '지난 시각으로는 예약할 수 없습니다. 현재 이후 시각을 선택하세요.';
  }
  return null;
}

/** 예약 시각 사람용 표기 'M월 D일 HH:MM' (KST) */
export function formatScheduledKst(localValue: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue ?? '');
  if (!m) return '';
  return `${Number(m[2])}월 ${Number(m[3])}일 ${m[4]}:${m[5]}`;
}

export default function SendMethodSelector({ value, onChange, available = true, disabled }: Props) {
  const isScheduled = value.mode === 'scheduled';
  const schedError = isScheduled ? validateScheduled(value.localValue) : null;

  return (
    <div className="space-y-2" data-testid="send-method-selector">
      <label className="text-xs font-medium text-gray-600">발송 방식</label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="send-mode-immediate"
          aria-pressed={!isScheduled}
          disabled={disabled}
          onClick={() => onChange({ ...value, mode: 'immediate' })}
          className={[
            'flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition',
            !isScheduled
              ? 'border-teal-500 bg-teal-50 text-teal-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50',
          ].join(' ')}
        >
          <Send className="h-4 w-4" /> 즉시 발송
        </button>
        <button
          type="button"
          data-testid="send-mode-scheduled"
          aria-pressed={isScheduled}
          disabled={disabled || !available}
          onClick={() => onChange({ ...value, mode: 'scheduled' })}
          className={[
            'flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition',
            isScheduled
              ? 'border-teal-500 bg-teal-50 text-teal-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            !available ? 'cursor-not-allowed opacity-50' : '',
          ].join(' ')}
          title={available ? undefined : '예약 발송 기능 준비 중입니다.'}
        >
          <Clock className="h-4 w-4" /> 예약 발송
        </button>
      </div>

      {!available && (
        <p data-testid="send-schedule-unavailable" className="text-[11px] text-gray-400">
          예약 발송 기능은 곧 활성화됩니다. 현재는 즉시 발송만 가능합니다.
        </p>
      )}

      {isScheduled && available && (
        <div className="space-y-1.5 rounded-md border border-teal-100 bg-teal-50/40 p-2.5">
          <label className="text-xs font-medium text-gray-600">발송 일시 (현장 시간 기준)</label>
          <input
            type="datetime-local"
            data-testid="send-schedule-datetime"
            value={value.localValue}
            min={minScheduleLocal()}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, localValue: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          {schedError ? (
            <p data-testid="send-schedule-error" className="text-[11px] text-red-600">{schedError}</p>
          ) : (
            <p data-testid="send-schedule-ok" className="text-[11px] text-teal-700">
              {formatScheduledKst(value.localValue)} 에 자동 발송됩니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
