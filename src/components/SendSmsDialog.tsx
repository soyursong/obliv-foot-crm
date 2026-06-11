/**
 * SendSmsDialog — 대시보드 고객 우클릭 [문자] → 템플릿 선택·간략수정 후 수동 1:1 발송
 * T-20260606-foot-CTXMENU-SMS-SEND
 * T-20260609-foot-SMS-CTXMENU-VAR-SUBST — 괄호 변수 5종 전부 자동 치환
 * T-20260610-foot-CTXMENU-STALE-PHONE — 수신번호 staleness 차단:
 *   대시보드 check_ins.customer_phone 은 체크인 시점 비정규화 스냅샷이라
 *   고객차트에서 phone 수정(customers.phone update) 후에도 갱신 안 됨 → 우클릭 발송 시 stale.
 *   오픈 시 customer_id 로 customers.phone(SSOT, E.164 계약) DB refetch 하여 수신번호 소스로 사용.
 *   (편집 출처 무관 — 표기·발송·발송직전 읽기전용 노출 모두 최신값. AC-1/2/3)
 *
 * 흐름:
 *  - 오픈 시 해당 지점(clinic_id) notification_templates 목록 로드 (메시지 설정 ③ 템플릿 관리 재사용)
 *    + 치환 변수 컨텍스트(지점명·지점전화번호·고객 다음/최근 예약 날짜·시간) 동시 로드
 *  - 템플릿 선택 → 본문의 5개 괄호 변수를 자동 치환 (자동발송 send-notification EF 와 동일 포맷/규칙)
 *      {고객명} → customers.name (기존)
 *      {지점명} → clinic_messaging_capability.sms_display_name 우선, NULL이면 clinics.name fallback
 *               (T-20260610-foot-SMS-DISPLAYNAME-SPLIT 옵션B — clinics.name=법정서식 전용 불변)
 *      {지점전화번호} → clinic_messaging_capability.sender_number (발신번호)
 *      {날짜} → 다음(없으면 최근) 예약 날짜 (예약 일시. 발송시각 아님 — 김주연 총괄 확정)
 *      {시간} → 다음(없으면 최근) 예약 시간
 *    예약 없는 고객: {날짜}/{시간} → "(예약 없음)" 으로 채우되 편집 가능 유지
 *  - textarea 자유 편집 (이번 1회 발송만, 원본 템플릿 불변 — AC-3 / 부모 '간략 수정' 동선 유지)
 *  - 상단에 고객 성함 + 전화번호 자동 표시 (오발송 방지 — §6 확정 2)
 *  - phone 없으면 발송 비활성 + "연락처 미등록" (AC-4)
 *  - 템플릿 0개면 안내 + 비활성 (AC-2)
 *  - "발송" → 확인 단계 1회(오발송 가드) → send-notification EF (_action:'manual_send', source:'manual_dashboard') 호출 (AC-5/AC-6c)
 *  - 결과 토스트 + messages 이력은 EF가 notification_logs 적재 (AC-7)
 *  - 발송 권한 = 전직원 8역할 (호출부 게이트, EF에서 재검증)
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ImagePlus, MessageSquare, Phone, User, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { isReservedEventType } from '@/lib/notificationEventTypes';
import {
  MMS_ACCEPT, validateMmsImage, checkMmsResolution,
  uploadMmsImage, signedMmsImageUrl,
} from '@/lib/mmsImage';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import SendMethodSelector, {
  type SendMethodValue,
  parseScheduledKstToUtcIso,
  validateScheduled,
  formatScheduledKst,
} from '@/components/SendMethodSelector';
import type { CheckIn } from '@/lib/types';

interface TemplateRow {
  id: string;
  event_type: string;
  channel: string;
  body: string;
  is_active: boolean;
  // T-20260609-foot-MSG-TEMPLATE-MMS Part B: 템플릿 첨부 이미지(있으면 선택 시 자동 첨부 → MMS)
  image_path?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkIn: CheckIn | null;
  clinicId: string;
  /** 진입점 태그 — 예약 발송 source 구분(대시보드 우클릭=manual / 메시지설정=settings). */
  entrySource?: 'dashboard' | 'settings';
}

/** 템플릿 표기명 — AdminSettings EVENT_TYPE_LABELS 와 동일 키 (없으면 event_type 그대로) */
const EVENT_LABELS: Record<string, string> = {
  resv_confirm: 'T01 예약 확정',
  resv_reminder_d1: 'T02 D-1 리마인드',
  resv_reminder_morning: 'T03 당일 아침',
  noshow: 'T04 노쇼 후속',
  manual_send: '수동 발송',
};

/** 예약 없는 고객의 {날짜}/{시간} placeholder — 편집 가능 상태로 채워둠 (AC-3) */
const NO_RESV_PLACEHOLDER = '(예약 없음)';

/** 치환 변수 컨텍스트 — 자동발송 send-notification EF 의 renderTemplate vars 와 동일 키. */
interface SubstVars {
  고객명: string;
  지점명: string;
  지점전화번호: string;
  날짜: string;
  시간: string;
}

/**
 * 템플릿 본문의 5개 괄호 변수를 전부 치환 (AC-1).
 * 자동발송 서버 경로(send-notification renderTemplate)와 동일하게 `{키}` 전역 치환.
 */
function renderTemplate(body: string, vars: SubstVars): string {
  let rendered = body;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.split(`{${key}}`).join(value ?? '');
  }
  return rendered;
}

function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/[^0-9]/g, '');
}

/**
 * 템플릿 로드 — image_path 포함. 마이그레이션 미적용(컬럼 부재) 환경에선 컬럼 없이 폴백.
 * (Vercel 자동배포가 마이그레이션보다 앞설 수 있으므로 수동발송 회귀 차단 — AC-11)
 */
async function loadTemplatesResilient(clinicId: string): Promise<TemplateRow[]> {
  const withImg = await (supabase.from('notification_templates') as any)
    .select('id, event_type, channel, body, is_active, image_path')
    .eq('clinic_id', clinicId)
    .order('event_type');
  if (!withImg.error) return (withImg.data as TemplateRow[]) ?? [];
  // image_path 컬럼 부재 등 → 폴백
  const base = await (supabase.from('notification_templates') as any)
    .select('id, event_type, channel, body, is_active')
    .eq('clinic_id', clinicId)
    .order('event_type');
  return (base.data as TemplateRow[]) ?? [];
}

/**
 * 예약 날짜 포맷 — 자동발송 서버와 동일 결과("6월 9일")를 TZ 영향 없이 생성.
 * 서버: new Date(reservation_date).toLocaleDateString("ko-KR", { month:"long", day:"numeric" }).
 * reservation_date 는 'YYYY-MM-DD' 문자열 → 구성요소 직접 파싱(브라우저/서버 TZ 차이 회피).
 */
function formatResvDate(reservationDate: string | null | undefined): string {
  if (!reservationDate) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(reservationDate);
  if (!m) return '';
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}

/** 예약 시간 포맷 — 서버와 동일하게 'HH:MM:SS' → 'HH:MM' */
function formatResvTime(reservationTime: string | null | undefined): string {
  return (reservationTime ?? '').slice(0, 5);
}

/** 오늘 날짜(KST) 'YYYY-MM-DD' */
function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 고객의 다음(없으면 가장 최근) 예약 1건 조회 — 취소/노쇼 제외 (티켓 §3).
 * 1순위: 오늘 이후(>=) 예약 중 가장 가까운 미래.
 * 2순위: 그런 예약이 없으면 가장 최근 과거 예약.
 */
async function loadCustomerResv(
  clinicId: string,
  customerId: string,
): Promise<{ reservation_date?: string; reservation_time?: string } | null> {
  const today = todayKST();
  // 1순위: 다음 예약 (오늘 포함 미래, date asc / time asc)
  const { data: upcoming } = await (supabase.from('reservations') as any)
    .select('reservation_date, reservation_time')
    .eq('clinic_id', clinicId)
    .eq('customer_id', customerId)
    .not('status', 'in', '(cancelled,noshow)')
    .gte('reservation_date', today)
    .order('reservation_date', { ascending: true })
    .order('reservation_time', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (upcoming) return upcoming as { reservation_date?: string; reservation_time?: string };

  // 2순위: 가장 최근 과거 예약 (date desc / time desc)
  const { data: recent } = await (supabase.from('reservations') as any)
    .select('reservation_date, reservation_time')
    .eq('clinic_id', clinicId)
    .eq('customer_id', customerId)
    .not('status', 'in', '(cancelled,noshow)')
    .order('reservation_date', { ascending: false })
    .order('reservation_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (recent as { reservation_date?: string; reservation_time?: string } | null) ?? null;
}

export default function SendSmsDialog({ open, onOpenChange, checkIn, clinicId, entrySource = 'dashboard' }: Props) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  // ── T-20260612-foot-SMS-SCHEDULE-SEND-OPTION: 발송방식(즉시/예약) ──
  // sendMethod.mode='immediate' → 기존 EF 즉시 발송. 'scheduled' → scheduled_messages 적재.
  // scheduleAvailable: scheduled_messages 테이블 존재 여부 probe(마이그 적용 전이면 false → 예약 비활성).
  const [sendMethod, setSendMethod] = useState<SendMethodValue>({ mode: 'immediate', localValue: '' });
  const [scheduleAvailable, setScheduleAvailable] = useState(false);
  // ── T-20260609-foot-MSG-TEMPLATE-MMS Part B(AC-6): 이미지 첨부(MMS) ──
  // imagePath: 이미 업로드된 경로(템플릿 첨부 이미지). imageFile: 즉석 첨부(아직 업로드 전).
  // 둘 중 하나라도 있으면 MMS 발송. preview 로 표시.
  const [imagePath, setImagePath]     = useState<string | null>(null);
  const [imageFile, setImageFile]     = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // 치환 변수 컨텍스트 (지점명·지점전화번호·예약 날짜/시간) — 템플릿과 동시 로드
  const [vars, setVars] = useState<SubstVars>({
    고객명: '',
    지점명: '',
    지점전화번호: '',
    날짜: '',
    시간: '',
  });
  // ── T-20260610-foot-CTXMENU-STALE-PHONE ──
  // livePhone: customers.phone DB refetch 결과(SSOT). phoneResolved: 권위있게 읽었는지 여부.
  // customer_id 가 있으면 오픈 시 항상 최신 phone 을 다시 읽어 stale 스냅샷을 덮는다.
  const [livePhone, setLivePhone] = useState<string | null>(null);
  const [phoneResolved, setPhoneResolved] = useState(false);

  const customerName = checkIn?.customer_name ?? '';
  // 수신번호 소스: customers.phone(권위 refetch)을 우선. 아직 못 읽었으면(로딩/customer_id 없음)
  // 종전대로 check_ins.customer_phone prop fallback (walk-in 미연결 고객 등).
  const phone = phoneResolved ? livePhone : (checkIn?.customer_phone ?? null);
  const hasPhone = digitsOnly(phone).length > 0;

  // 오픈/고객 변경 시 상태 리셋 + 템플릿 + 치환 변수 컨텍스트 동시 로드
  useEffect(() => {
    if (!open || !clinicId) return;
    setSelectedId('');
    setBody('');
    setConfirmStep(false);
    setImagePath(null);
    setImageFile(null);
    setImagePreview(null);
    setLivePhone(null);
    setPhoneResolved(false);
    setSendMethod({ mode: 'immediate', localValue: '' });
    setScheduleAvailable(false);
    setLoading(true);
    const custId = checkIn?.customer_id ?? null;
    let cancelled = false;

    // scheduled_messages 사용 가능 여부 probe — 테이블 미배포(마이그 전) 환경에서
    // '예약 발송' 비활성화하여 즉시 발송 회귀를 차단(배포-마이그 순서 레이스 안전).
    (async () => {
      const probe = await (supabase.from('scheduled_messages') as any)
        .select('id', { head: true, count: 'exact' })
        .limit(1);
      if (!cancelled) setScheduleAvailable(!probe.error);
    })();
    (async () => {
      // 템플릿 + 지점 정보 + 발신번호 + 고객 다음/최근 예약 + 고객 최신 전화번호를 병렬 조회
      const [tmplRows, clinicRes, capRes, resvRes, custRes] = await Promise.all([
        loadTemplatesResilient(clinicId),
        (supabase.from('clinics') as any)
          .select('name')
          .eq('id', clinicId)
          .maybeSingle(),
        // select('*') = 전방호환: sms_display_name 컬럼 미적용(마이그레이션 전) 시에도
        // PostgREST 에러 없이 누락 필드는 undefined → clinics.name fallback. (배포-마이그레이션 순서 레이스 차단)
        (supabase.from('clinic_messaging_capability') as any)
          .select('*')
          .eq('clinic_id', clinicId)
          .maybeSingle(),
        // 다음(없으면 최근) 예약: 취소/노쇼 제외. 가장 가까운 미래 우선, 없으면 가장 최근 과거.
        custId
          ? loadCustomerResv(clinicId, custId)
          : Promise.resolve(null),
        // T-20260610-foot-CTXMENU-STALE-PHONE: 수신번호 SSOT — customers.phone 최신값 refetch.
        // check_ins.customer_phone(스냅샷) 대신 이 값을 표기·발송에 사용해 차트 수정 직후 stale 차단.
        custId
          ? (supabase.from('customers') as any)
              .select('phone')
              .eq('id', custId)
              .maybeSingle()
          : Promise.resolve(null),
      ]);
      if (cancelled) return;

      // 고객 최신 전화번호 반영 — 조회 성공(에러 없음)했을 때만 권위값으로 채택.
      // 행이 있으면 phone(없으면 null), 행이 없거나 에러면 미해결 → prop fallback 유지.
      const custRow = (custRes as any)?.data as { phone?: string | null } | null | undefined;
      const custErr = (custRes as any)?.error;
      if (custId && !custErr) {
        setLivePhone(custRow?.phone ?? null);
        setPhoneResolved(true);
      }

      // 사용자 정의(custom) 템플릿의 is_active=false 는 soft-delete(삭제 처리) → 발송 선택에서 제외.
      // reserved 자동발송 템플릿은 is_active=false 여도 수동 발송 선택은 허용(자동발송 off 의미).
      //   (T-20260609-foot-MSG-TEMPLATE-CRUD AC-3)
      const rows = (tmplRows ?? [])
        .filter((t) => t.is_active !== false || isReservedEventType(t.event_type))
        .sort((a, b) => Number(b.is_active) - Number(a.is_active));
      setTemplates(rows);

      const clinicName = ((clinicRes as any)?.data as { name?: string } | null)?.name ?? '';
      const capData = (capRes as any)?.data as
        { sender_number?: string | null; sms_display_name?: string | null } | null;
      const senderNumber = capData?.sender_number ?? '';
      // ── T-20260610-foot-SMS-DISPLAYNAME-SPLIT (AC-1) ──
      // {지점명}: 문자 전용 표시명(sms_display_name) 우선, 빈값/NULL이면 clinics.name fallback.
      // 자동발송 EF(send-notification)·템플릿 미리보기와 동일 우선순위(정합).
      const clinicDisplayName = capData?.sms_display_name || clinicName;
      const resv = resvRes as { reservation_date?: string; reservation_time?: string } | null;
      const dateStr = formatResvDate(resv?.reservation_date);
      const timeStr = formatResvTime(resv?.reservation_time);

      setVars({
        고객명: checkIn?.customer_name ?? '',
        지점명: clinicDisplayName,
        지점전화번호: senderNumber,
        // 예약 없는 고객: placeholder 로 채우되 편집 가능 유지 (AC-3)
        날짜: dateStr || NO_RESV_PLACEHOLDER,
        시간: timeStr || NO_RESV_PLACEHOLDER,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clinicId, checkIn?.id, checkIn?.customer_id, checkIn?.customer_name]);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setConfirmStep(false);
      const tmpl = templates.find((t) => t.id === id);
      if (tmpl) setBody(renderTemplate(tmpl.body, vars));
      // 즉석 첨부 파일은 유지하되, 템플릿 자체 첨부 이미지가 있으면 자동 첨부(즉석 파일 없을 때만).
      if (tmpl?.image_path && !imageFile) {
        setImagePath(tmpl.image_path);
        void signedMmsImageUrl(tmpl.image_path).then((url) => setImagePreview(url));
      } else if (!imageFile) {
        setImagePath(null);
        setImagePreview(null);
      }
    },
    [templates, vars, imageFile],
  );

  const handlePickImage = useCallback(async (file: File | null) => {
    if (!file) return;
    const err = validateMmsImage(file);
    if (err) { toast.error(err); return; }
    const warn = await checkMmsResolution(file);
    if (warn) toast.error(warn); // 경고만 — 첨부 허용
    setImageFile(file);
    setImagePath(null); // 발송 시 업로드 → 경로 확정
    setImagePreview(URL.createObjectURL(file));
    setConfirmStep(false);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePath(null);
    setImagePreview(null);
    setConfirmStep(false);
  }, []);

  const hasImage = Boolean(imageFile || imagePath);
  const byteLen = new TextEncoder().encode(body).length;
  const channelLabel = hasImage ? 'MMS' : (byteLen <= 90 ? 'SMS' : 'LMS');

  // 예약 모드면 발송 일시가 유효(미래)해야 발송 가능 (과거시각 차단 AC).
  const scheduledInvalid =
    sendMethod.mode === 'scheduled' && validateScheduled(sendMethod.localValue) !== null;
  const canSend =
    hasPhone && body.trim().length > 0 && selectedId !== '' && !sending &&
    templates.length > 0 && !scheduledInvalid;
  const isScheduled = sendMethod.mode === 'scheduled' && scheduleAvailable;

  const doSend = useCallback(async () => {
    if (!checkIn || !canSend) return;
    setSending(true);
    try {
      // 즉석 첨부 파일이면 발송 직전 업로드 → 경로 확정. 템플릿 첨부 이미지는 기존 경로 그대로.
      let finalImagePath = imagePath;
      if (imageFile) {
        try {
          finalImagePath = await uploadMmsImage(imageFile, clinicId, 'manual');
        } catch (e) {
          toast.error(`이미지 업로드 실패: ${String(e)}`);
          setSending(false);
          setConfirmStep(false);
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      // ── 예약 발송: scheduled_messages 적재 (즉시 발송하지 않음) ──
      // pg_cron dispatch_scheduled_messages() 가 지정 시각 도래 시 send-notification EF 로 발송.
      if (isScheduled) {
        const utcIso = parseScheduledKstToUtcIso(sendMethod.localValue);
        const stillInvalid = validateScheduled(sendMethod.localValue);
        if (!utcIso || stillInvalid) {
          toast.error(stillInvalid ?? '발송 일시가 올바르지 않습니다.');
          setConfirmStep(false);
          return;
        }
        const { error: insErr } = await (supabase.from('scheduled_messages') as any).insert({
          clinic_id: clinicId,
          customer_id: checkIn.customer_id,
          recipient_phone: phone,
          body: body.trim(),
          channel: finalImagePath ? 'mms' : 'sms',
          scheduled_at: utcIso,
          source: entrySource === 'settings' ? 'settings_scheduled' : 'manual_scheduled',
          created_by: session?.user?.id ?? null,
          ...(finalImagePath ? { image_path: finalImagePath } : {}),
        });
        if (insErr) {
          // 테이블 미배포 등 → 즉시 발송 동선은 보존, 예약만 안내 후 차단.
          toast.error(`예약 발송 등록 실패: ${insErr.message ?? '잠시 후 다시 시도하세요.'}`);
          setConfirmStep(false);
          return;
        }
        toast.confirm(`예약 발송 등록 완료 — ${formatScheduledKst(sendMethod.localValue)} 발송 예정`);
        onOpenChange(false);
        return;
      }

      // ── 즉시 발송 (기존 동선) ──
      const { data, error } = await supabase.functions.invoke('send-notification', {
        body: {
          _action: 'manual_send',
          clinic_id: clinicId,
          customer_id: checkIn.customer_id,
          recipient_phone: phone,
          body: body.trim(),
          source: entrySource === 'settings' ? 'manual_settings' : 'manual_dashboard',
          // image_path 는 첨부가 있을 때만 전달(없으면 키 생략 → 종전 SMS/LMS 무영향, AC-11)
          ...(finalImagePath ? { image_path: finalImagePath } : {}),
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (error) {
        toast.error(`문자 발송 실패: ${error.message}`);
        return;
      }
      const res = data as { success?: boolean; message?: string } | null;
      if (res?.success) {
        toast.confirm('문자 발송 완료');
        onOpenChange(false);
      } else {
        toast.error(res?.message ?? '문자 발송에 실패했습니다.');
        setConfirmStep(false);
      }
    } catch (e) {
      toast.error(`문자 발송 오류: ${String(e)}`);
    } finally {
      setSending(false);
    }
  }, [checkIn, canSend, clinicId, phone, body, imageFile, imagePath, onOpenChange, isScheduled, sendMethod, entrySource]);

  if (!checkIn) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-teal-600" />
            문자 발송
          </DialogTitle>
          <DialogDescription>
            선택한 템플릿을 이번 발송에 한해 수정할 수 있습니다. (원본 템플릿은 변경되지 않습니다)
          </DialogDescription>
        </DialogHeader>

        {/* 대상 고객 — 성함 + 전화번호 자동 표시 (오발송 방지) */}
        <div
          data-testid="sms-recipient-box"
          className="rounded-lg border bg-teal-50/60 px-3 py-2.5 text-sm"
        >
          <div className="flex items-center gap-2 text-teal-800 font-semibold">
            <User className="h-4 w-4 shrink-0" />
            <span data-testid="sms-recipient-name">{customerName || '(이름 없음)'}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-gray-600">
            <Phone className="h-4 w-4 shrink-0" />
            {/* AC-3: 발송 직전 수신번호(최신 customers.phone) 읽기전용 노출 — 마지막 확인용 */}
            {loading && checkIn?.customer_id && !phoneResolved ? (
              <span data-testid="sms-recipient-phone-loading" className="text-gray-400">
                수신번호 확인 중…
              </span>
            ) : hasPhone ? (
              <span data-testid="sms-recipient-phone" className="font-mono">{phone}</span>
            ) : (
              <span data-testid="sms-recipient-nophone" className="text-red-600">연락처 미등록</span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            위 수신번호는 고객차트 최신 번호입니다. 발송 전 확인하세요.
          </p>
        </div>

        {/* 템플릿 선택 */}
        {loading ? (
          <p className="text-sm text-gray-500 py-3">템플릿 불러오는 중…</p>
        ) : templates.length === 0 ? (
          <div
            data-testid="sms-no-template"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
          >
            등록된 템플릿이 없습니다 — 메시지 설정 → ③ 템플릿 관리에서 추가하세요.
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">템플릿 선택</label>
            <select
              data-testid="sms-template-select"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              value={selectedId}
              onChange={(e) => handleSelect(e.target.value)}
            >
              <option value="">— 템플릿을 선택하세요 —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {(EVENT_LABELS[t.event_type] ?? t.event_type)}
                  {t.is_active ? '' : ' (비활성)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 본문 미리보기 + 자유 편집 */}
        {selectedId !== '' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">본문 (자유 편집 가능)</label>
              <span className="text-[11px] text-gray-400">
                {byteLen}byte · {channelLabel}
              </span>
            </div>
            {/* T-20260609-foot-MSG-TEMPLATE-MMS Part C(AC10): 본문 입력 영역 약 2배 확장
                — 약도·약국 안내 등 장문 입력 시 스크롤 없이 한눈에. rows 5→10 + min-h 보강.
                T-20260609-foot-SMS-TEXTAREA-2X: 김주연 총괄 요청 — 현재 대비 약 2배 추가 확장.
                rows 10→20 + min-h 220→440px. 발송 로직·바이트 카운터·길이제한 동작 불변(크기만 확대). */}
            <Textarea
              data-testid="sms-body-textarea"
              value={body}
              onChange={(e) => { setBody(e.target.value); setConfirmStep(false); }}
              rows={20}
              className="resize-y text-sm min-h-[440px]"
            />

            {/* T-20260609-foot-MSG-TEMPLATE-MMS Part B(AC-6): 이미지 첨부 → MMS */}
            <div className="space-y-1.5 pt-1">
              {imagePreview ? (
                <div data-testid="sms-image-preview" className="relative inline-block">
                  <img
                    src={imagePreview}
                    alt="첨부 이미지 미리보기"
                    className="max-h-32 rounded border object-contain"
                  />
                  <button
                    type="button"
                    data-testid="sms-image-remove-btn"
                    onClick={handleRemoveImage}
                    className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700"
                    aria-label="이미지 제거"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label
                  data-testid="sms-image-pick-label"
                  className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
                >
                  <ImagePlus className="h-4 w-4" />
                  이미지 첨부 (JPG · 200KB 이하 → MMS)
                  <input
                    type="file"
                    data-testid="sms-image-input"
                    accept={MMS_ACCEPT}
                    className="hidden"
                    onChange={(e) => { void handlePickImage(e.target.files?.[0] ?? null); e.target.value = ''; }}
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {/* 발송 방식 선택 (즉시/예약) — 템플릿 선택 후 노출 */}
        {selectedId !== '' && (
          <SendMethodSelector
            value={sendMethod}
            onChange={(v) => { setSendMethod(v); setConfirmStep(false); }}
            available={scheduleAvailable}
          />
        )}

        {/* 확인 단계 (오발송 가드) */}
        {confirmStep && (
          <div
            data-testid="sms-confirm-banner"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {isScheduled ? (
              <span>
                <b>{customerName}</b>({phone}) 님께 <b>{formatScheduledKst(sendMethod.localValue)}</b> 에
                문자가 예약 발송됩니다. 등록하시겠습니까?
              </span>
            ) : (
              <span>
                <b>{customerName}</b>({phone}) 님께 실제로 문자가 즉시 발송됩니다. 발송하시겠습니까?
              </span>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            취소
          </Button>
          {!confirmStep ? (
            <Button
              data-testid="sms-send-btn"
              onClick={() => setConfirmStep(true)}
              disabled={!canSend}
              className="bg-teal-600 hover:bg-teal-700"
            >
              {isScheduled ? '예약 발송' : '발송'}
            </Button>
          ) : (
            <Button
              data-testid="sms-send-confirm-btn"
              onClick={doSend}
              disabled={sending}
              className="bg-red-600 hover:bg-red-700"
            >
              {sending
                ? (isScheduled ? '등록 중…' : '발송 중…')
                : (isScheduled ? '예약 등록' : '확정 발송')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
