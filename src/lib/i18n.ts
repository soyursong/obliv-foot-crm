const translations = {
  ko: {
    brandName: '오블리브 Ose',
    checkIn: '체크인 하기',
    name: '이름',
    phone: '전화번호',
    privacyConsent: '개인정보 수집·이용 동의',
    privacyTitle: '개인정보 수집·이용 동의',
    privacyItems: '수집 항목: 이름, 전화번호',
    privacyPurpose: '수집 목적: 원내 대기 순서 안내 및 알림 발송',
    privacyRetention: '보유 기간: 방문 당일 자정 자동 삭제',
    waiting: '대기중',
    consultation: '상담중',
    treatment: '시술중',
    done: '완료',
    noShow: '노쇼',
    queueAhead: '내 앞 대기 인원',
    people: '명',
    callAlertTitle: '🔔 호출되었습니다!',
    callAlertConsultation: '상담실로 이동해 주세요',
    callAlertTreatment: '시술실로 이동해 주세요',
    callAlertDone: '시술이 완료되었습니다',
    confirm: '확인',
    summaryWaiting: '대기',
    summaryConsultation: '상담',
    summaryTreatment: '시술',
    login: '로그인',
    email: '이메일',
    password: '비밀번호',
    logout: '로그아웃',
    todayCheckIns: '오늘 체크인',
    currentWaiting: '현재 대기',
    completed: '완료',
    manualRegister: '+수동등록',
    noShowAction: '노쇼 처리',
    notify: '알림',
    close: '닫기',
    register: '등록',
    newCheckInAlert: '새 체크인이 등록되었습니다',
    countryCode: '국가번호',
  },
  en: {
    brandName: 'Obliv Ose',
    checkIn: 'Check In',
    name: 'Name',
    phone: 'Phone Number',
    privacyConsent: 'I agree to the privacy policy',
    privacyTitle: 'Privacy Policy',
    privacyItems: 'Collected items: Name, Phone number',
    privacyPurpose: 'Purpose: Queue order guidance and notification',
    privacyRetention: 'Retention: Auto-deleted at midnight on the day of visit',
    waiting: 'Waiting',
    consultation: 'Consultation',
    treatment: 'Treatment',
    done: 'Done',
    noShow: 'No Show',
    queueAhead: 'People ahead',
    people: '',
    callAlertTitle: '🔔 You have been called!',
    callAlertConsultation: 'Please proceed to the consultation room',
    callAlertTreatment: 'Please proceed to the treatment room',
    callAlertDone: 'Your treatment is complete',
    confirm: 'OK',
    summaryWaiting: 'Waiting',
    summaryConsultation: 'Consultation',
    summaryTreatment: 'Treatment',
    login: 'Login',
    email: 'Email',
    password: 'Password',
    logout: 'Logout',
    todayCheckIns: 'Today Check-ins',
    currentWaiting: 'Currently Waiting',
    completed: 'Completed',
    manualRegister: '+ Manual Register',
    noShowAction: 'Mark No-show',
    notify: 'Notify',
    close: 'Close',
    register: 'Register',
    newCheckInAlert: 'New check-in registered',
    countryCode: 'Country Code',
  },
} as const;

export type Language = 'ko' | 'en';
export type TranslationKey = keyof typeof translations.ko;

export function t(lang: Language, key: TranslationKey): string {
  return translations[lang]?.[key] ?? translations.ko[key];
}

export const STATUS_MAP: Record<string, { ko: string; en: string; color: string }> = {
  waiting: { ko: '대기', en: 'Waiting', color: 'status-waiting' },
  consultation: { ko: '상담', en: 'Consultation', color: 'status-consultation' },
  treatment_waiting: { ko: '시술대기', en: 'Treatment Wait', color: 'status-treatment-waiting' },
  treatment: { ko: '시술', en: 'Treatment', color: 'status-treatment' },
  payment_waiting: { ko: '결제대기', en: 'Payment', color: 'status-treatment-waiting' },
  done: { ko: '완료', en: 'Done', color: 'status-done' },
  no_show: { ko: '노쇼', en: 'No Show', color: 'status-noshow' },
};

export const COLUMN_STATUSES = ['waiting', 'consultation', 'treatment_waiting', 'treatment', 'payment_waiting', 'done'] as const;

export function getStatusLabel(status: string, lang: Language): string {
  return STATUS_MAP[status]?.[lang] ?? status;
}

export function getStatusColorClass(status: string): string {
  return STATUS_MAP[status]?.color ?? 'status-waiting';
}

export function formatQueueNumber(n: number): string {
  return `#${String(n).padStart(3, '0')}`;
}

export function maskPhone(phone: string): string {
  // 김태영 요청 2026-04-13: 연락처 가운데 마스킹 해제 — 그대로 반환.
  // 010-1234-5678 / 01012345678 등 하이픈 여부만 정규화
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  return phone;
}
