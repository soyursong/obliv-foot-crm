// switch.tsx — shadcn 호환 Switch 컴포넌트 (@base-ui/react 기반)
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (빌드 픽스)

import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cn } from '@/lib/utils';

interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
}

function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  id,
  name,
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      id={id}
      name={name}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(c) => onCheckedChange?.(c)}
      disabled={disabled}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[checked]:bg-primary bg-input',
        className,
      )}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0',
          'transition-transform',
          'translate-x-0 data-[checked]:translate-x-4',
        )}
      />
    </BaseSwitch.Root>
  );
}

export { Switch };
