// 새 체크인 beep (#28). Base64 8-bit WAV, 200ms.
const BEEP_B64 =
  'UklGRngCAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YVQCAAB/f39/f39/f39/f4CAgICAgICAg4OHh4qKjY2RkZSUmJibm5+fo6Olpaioqqqtra+vsbGzs7S0tra3t7e3uLi4uLi4t7e3t7e3tra1tbS0s7OysrGxr6+trauqqaempqSko6OioaGhoaGhoaGio6OkpKWmpqeoqaqrrKytrq+wsLGxsrO0tLW1tra3t7e4uLi4uLi5ubm5uLi4uLi4t7e2trW0tLOysbGwr66trKuqqainpqWko6OioaGgoKCgoKCgoaGio6OkpKanp6ipqqutrK6ur7CwsbKyf39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/';

let audio: HTMLAudioElement | null = null;

export function playCheckInBeep(): void {
  try {
    if (!audio) {
      audio = new Audio(`data:audio/wav;base64,${BEEP_B64}`);
      audio.volume = 0.35;
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    /* noop */
  }
}

let alertAudio: HTMLAudioElement | null = null;

export function playOvertimeAlert(): void {
  try {
    if (!alertAudio) {
      alertAudio = new Audio(`data:audio/wav;base64,${BEEP_B64}`);
      alertAudio.volume = 0.6;
    }
    alertAudio.currentTime = 0;
    void alertAudio.play().catch(() => {});
    setTimeout(() => {
      alertAudio!.currentTime = 0;
      void alertAudio!.play().catch(() => {});
    }, 300);
  } catch {
    /* noop */
  }
}
