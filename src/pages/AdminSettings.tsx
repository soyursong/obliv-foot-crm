/**
 * AdminSettings — 메시지 설정 (/admin/settings)
 * T-20260525-foot-MESSAGING-V1 S1 AC-3
 *
 * 접근: admin/manager/director 전용
 * 섹션:
 *   ⓪ 연결 설정 (admin 전용 — Solapi API 자격증명)
 *   ① 채널 가능 여부
 *   ② 자동 발송 규칙
 *   ③ 템플릿 관리
 *   ④ 수동 발송 (미구현 stub)
 *   ⑤ 발송 이력
 *   ⑥ 수신거부 명단
 *   ⑦ 셀프접수 QR 다운로드 (admin/manager — foot-native, T-20260531-foot-...-SELFCHECKIN-QR-DOWNLOAD)
 *
 * 롱레(happy-flow-queue) AdminSettings.tsx 0% 변경 복제 — foot-crm 패턴 적응:
 *   - AdminLayout 제거 (router Outlet 패턴)
 *   - useClinic() / useAuth() 기반 clinic/role 조회
 *   - toast from sonner (@/lib/toast)
 *   - supabase from @/lib/supabase
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MessageSquare, Settings, ChevronRight, Loader2, AlertCircle,
  CheckCircle2, Phone, Send, History, Ban, Zap, QrCode, Download,
} from 'lucide-react';
import type { Clinic } from '@/lib/types';

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

interface MessagingCapability {
  id: string;
  clinic_id: string;
  enabled: boolean;
  solapi_api_key_vault_name: string | null;
  solapi_secret_vault_name: string | null;
  sender_number: string | null;
  solapi_validation_status: 'unchecked' | 'pending' | 'verified' | 'not_registered' | 'api_unreachable' | null;
  send_start_hour: number;
  send_end_hour: number;
  kakao_channel_id: string | null;
  created_at: string;
  updated_at: string;
}

interface NotificationTemplate {
  id: string;
  clinic_id: string;
  event_type: 'resv_confirm' | 'resv_reminder_d1' | 'resv_reminder_morning' | 'noshow';
  channel: 'sms' | 'lms' | 'alimtalk';
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface NotificationLog {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  reservation_id: string | null;
  event_type: string;
  channel: string;
  recipient_phone: string;
  body_rendered: string | null;
  status: 'sent' | 'failed' | 'opt_out' | 'skipped' | 'pending';
  solapi_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

interface NotificationOptOut {
  id: string;
  clinic_id: string;
  phone: string;
  opted_out_at: string;
  reason: string | null;
}

type Section = '0_connection' | '1_channels' | '2_rules' | '3_templates' | '4_manual' | '5_history' | '6_optout' | '7_selfcheckin_qr';

const EVENT_TYPE_LABELS: Record<string, string> = {
  resv_confirm:          'T01 예약 확정',
  resv_reminder_d1:      'T02 D-1 리마인드',
  resv_reminder_morning: 'T03 당일 아침',
  noshow:                'T04 노쇼 후속',
};

const EVENT_TYPE_DESC: Record<string, string> = {
  resv_confirm:          '예약 status=reserved 전환 시 즉시',
  resv_reminder_d1:      '매일 18:00 — 내일 예약자 대상',
  resv_reminder_morning: '매일 09:00 — 오늘 예약자 대상 (현재 비활성)',
  noshow:                '노쇼 전환 후 1시간',
};

const STATUS_BADGE_STYLE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' }> = {
  sent:     { label: '발송 완료', variant: 'success' },
  failed:   { label: '실패',     variant: 'destructive' },
  opt_out:  { label: '수신거부', variant: 'secondary' },
  skipped:  { label: '건너뜀',  variant: 'outline' },
  pending:  { label: '야간 대기',variant: 'outline' },
};

const DEFAULT_TEMPLATES: Record<string, string> = {
  resv_confirm:          '[오블리브 {지점명}] {고객명}님, {날짜} {시간} 예약이 확정되었습니다.\n변경/취소: {지점전화번호}',
  resv_reminder_d1:      '[오블리브 {지점명}] {고객명}님, 내일 {시간} 방문 예정입니다.\n변경/취소: {지점전화번호}',
  resv_reminder_morning: '[오블리브 {지점명}] {고객명}님, 오늘 {시간}에 뵙겠습니다. 편히 오세요.',
  noshow:                '[오블리브 {지점명}] {고객명}님, 오늘 {시간} 방문이 확인되지 않았습니다.\n재예약 도와드릴게요: {지점전화번호}',
};

const SECTIONS: { id: Section; label: string; icon: React.ReactNode; adminOnly?: boolean; mgrPlus?: boolean }[] = [
  { id: '0_connection', label: '⓪ 연결 설정',     icon: <Settings className="h-4 w-4" />,      adminOnly: true },
  { id: '1_channels',   label: '① 채널 가능 여부', icon: <Zap className="h-4 w-4" /> },
  { id: '2_rules',      label: '② 자동 발송 규칙', icon: <MessageSquare className="h-4 w-4" /> },
  { id: '3_templates',  label: '③ 템플릿 관리',    icon: <ChevronRight className="h-4 w-4" /> },
  { id: '4_manual',     label: '④ 수동 발송',      icon: <Send className="h-4 w-4" /> },
  { id: '5_history',    label: '⑤ 발송 이력',      icon: <History className="h-4 w-4" /> },
  { id: '6_optout',     label: '⑥ 수신거부 명단',  icon: <Ban className="h-4 w-4" /> },
  { id: '7_selfcheckin_qr', label: '⑦ 셀프접수 QR 다운로드', icon: <QrCode className="h-4 w-4" />, mgrPlus: true },
];

function extractErrorMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function AdminSettings() {
  const navigate = useNavigate();
  const clinic = useClinic();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>('1_channels');

  const [capability, setCapability]   = useState<MessagingCapability | null>(null);
  const [templates, setTemplates]     = useState<NotificationTemplate[]>([]);
  const [logs, setLogs]               = useState<NotificationLog[]>([]);
  const [optOuts, setOptOuts]         = useState<NotificationOptOut[]>([]);

  const role      = profile?.role ?? '';
  const isAdmin   = role === 'admin';
  const isManager = role === 'manager';

  // ── 권한 가드 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return;
    if (!['admin', 'manager', 'director'].includes(role)) {
      navigate('/admin', { replace: true });
    }
  }, [profile, role, navigate]);

  // ── 데이터 로드 ───────────────────────────────────────────────────────────────
  const loadCapability = useCallback(async (cid: string) => {
    const { data } = await (supabase.from('clinic_messaging_capability') as any)
      .select('*')
      .eq('clinic_id', cid)
      .maybeSingle();
    setCapability(data ?? null);
  }, []);

  const loadTemplates = useCallback(async (cid: string) => {
    const { data } = await (supabase.from('notification_templates') as any)
      .select('*')
      .eq('clinic_id', cid)
      .order('event_type');
    setTemplates((data as NotificationTemplate[]) ?? []);
  }, []);

  const loadLogs = useCallback(async (cid: string) => {
    const { data } = await (supabase.from('notification_logs') as any)
      .select('*')
      .eq('clinic_id', cid)
      .order('created_at', { ascending: false })
      .limit(100);
    setLogs((data as NotificationLog[]) ?? []);
  }, []);

  const loadOptOuts = useCallback(async (cid: string) => {
    const { data } = await (supabase.from('notification_opt_outs') as any)
      .select('*')
      .eq('clinic_id', cid)
      .order('opted_out_at', { ascending: false });
    setOptOuts((data as NotificationOptOut[]) ?? []);
  }, []);

  useEffect(() => {
    if (!clinic) return;
    (async () => {
      await Promise.all([
        loadCapability(clinic.id),
        loadTemplates(clinic.id),
        loadLogs(clinic.id),
        loadOptOuts(clinic.id),
      ]);
      setLoading(false);
    })();
  }, [clinic, loadCapability, loadTemplates, loadLogs, loadOptOuts]);

  if (loading || !clinic) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const visibleSections = SECTIONS.filter(
    (s) => (!s.adminOnly || isAdmin) && (!s.mgrPlus || isAdmin || isManager),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* 좌측 섹션 네비 */}
      <aside className="hidden md:flex flex-col w-52 shrink-0 border-r bg-muted/30 p-3 gap-1 overflow-y-auto">
        <p className="text-xs font-semibold text-muted-foreground px-2 py-1 mb-1">메시지 설정</p>
        {visibleSections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
              activeSection === s.id
                ? 'bg-accent text-accent-foreground font-medium'
                : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            {s.icon}
            <span className="leading-tight">{s.label}</span>
          </button>
        ))}
      </aside>

      {/* 모바일: 상단 탭 */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="md:hidden flex gap-1 overflow-x-auto p-2 border-b bg-background shrink-0">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeSection === s.id
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* 콘텐츠 영역 */}
        <div className="flex-1 overflow-auto p-4 md:p-6">
          {activeSection === '0_connection' && isAdmin && (
            <SectionConnection
              clinicId={clinic.id}
              capability={capability}
              onRefresh={async () => { await loadCapability(clinic.id); }}
              onRefreshLogs={async () => { await loadLogs(clinic.id); }}
            />
          )}
          {activeSection === '1_channels' && (
            <SectionChannels capability={capability} />
          )}
          {activeSection === '2_rules' && (
            <SectionRules
              clinicId={clinic.id}
              templates={templates}
              onRefresh={() => loadTemplates(clinic.id)}
            />
          )}
          {activeSection === '3_templates' && (
            <SectionTemplates
              clinicId={clinic.id}
              templates={templates}
              onRefresh={() => loadTemplates(clinic.id)}
            />
          )}
          {activeSection === '4_manual' && (
            <SectionManual clinicId={clinic.id} />
          )}
          {activeSection === '5_history' && (
            <SectionHistory logs={logs} onRefresh={() => loadLogs(clinic.id)} />
          )}
          {activeSection === '6_optout' && (
            <SectionOptOut
              clinicId={clinic.id}
              optOuts={optOuts}
              onRefresh={() => loadOptOuts(clinic.id)}
            />
          )}
          {activeSection === '7_selfcheckin_qr' && (isAdmin || isManager) && (
            <SectionSelfCheckinQR clinic={clinic} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 발신번호 검증 상태 배지 ────────────────────────────────────────────────────
function SenderValidationBadge({ status }: {
  status: MessagingCapability['solapi_validation_status'];
}) {
  if (!status || status === 'unchecked') {
    return <p className="text-xs text-muted-foreground">SOLAPI 검증 미실시 — 저장 후 자동 검증됩니다.</p>;
  }
  if (status === 'pending') {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        SOLAPI 화이트리스트 검증 중...
      </p>
    );
  }
  if (status === 'verified') {
    return (
      <p className="text-xs text-green-600 flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        SOLAPI 화이트리스트 등록 확인
      </p>
    );
  }
  if (status === 'not_registered') {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-2 space-y-0.5">
        <p className="text-xs text-red-700 font-medium flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          SOLAPI 화이트리스트 미등록 — SMS 발송 차단됨
        </p>
        <p className="text-xs text-red-600">솔라피 콘솔에서 이 번호를 등록한 뒤 [재검증]을 클릭하세요.</p>
      </div>
    );
  }
  if (status === 'api_unreachable') {
    return (
      <p className="text-xs text-amber-600 flex items-center gap-1">
        <AlertCircle className="h-3 w-3 shrink-0" />
        SOLAPI API 연결 실패 — 검증 불가 (경고만, 발송은 허용)
      </p>
    );
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ⓪ 연결 설정
// ══════════════════════════════════════════════════════════════════════════════

function SectionConnection({
  clinicId, capability, onRefresh, onRefreshLogs,
}: {
  clinicId: string;
  capability: MessagingCapability | null;
  onRefresh: () => Promise<void>;
  onRefreshLogs?: () => Promise<void>;
}) {
  const [apiKey, setApiKey]               = useState('');
  const [apiSecret, setApiSecret]         = useState('');
  const [senderNumber, setSenderNumber]   = useState(capability?.sender_number ?? '');
  const [enabled, setEnabled]             = useState(capability?.enabled ?? false);
  const [saving, setSaving]               = useState(false);
  const [testing, setTesting]             = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testPhone, setTestPhone]         = useState('');
  const [testPhoneError, setTestPhoneError] = useState<string | null>(null);
  const [validationPolling, setValidationPolling] = useState(false);

  useEffect(() => {
    setSenderNumber(capability?.sender_number ?? '');
    setEnabled(capability?.enabled ?? false);
  }, [capability]);

  const handleValidate = useCallback(async () => {
    if (!clinicId) return;
    setValidationPolling(true);
    try {
      const { data: phase1 } = await (supabase.rpc as any)('validate_solapi_sender', { p_clinic_id: clinicId });
      await onRefresh();
      if (phase1 === 'pending') {
        await new Promise<void>((resolve) => setTimeout(resolve, 2500));
        await (supabase.rpc as any)('validate_solapi_sender', { p_clinic_id: clinicId });
        await onRefresh();
      }
    } catch (err) {
      console.error('[SenderValidate] error:', err);
    } finally {
      setValidationPolling(false);
    }
  }, [clinicId, onRefresh]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)('admin_save_messaging_config', {
        p_clinic_id:     clinicId,
        p_sender_number: senderNumber.trim() || null,
        p_enabled:       enabled,
        p_api_key:       apiKey.trim() || null,
        p_api_secret:    apiSecret.trim() || null,
      });
      if (error) throw error;
      setApiKey('');
      setApiSecret('');
      await onRefresh();
      toast.success('설정이 저장되었습니다.');
      if (senderNumber.trim()) {
        setTimeout(() => void handleValidate(), 2000);
      }
    } catch (err) {
      toast.error(`저장 실패: ${extractErrorMsg(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const openTestModal = () => {
    if (!capability?.sender_number) {
      toast.error('발신번호 미등록 — ⓪ 연결 설정에서 발신번호를 먼저 저장하세요.');
      return;
    }
    setTestPhone('');
    setTestPhoneError(null);
    setTestModalOpen(true);
  };

  const handleTest = async () => {
    const phone = testPhone.trim().replace(/[^0-9]/g, '');
    if (!phone || phone.length < 10) {
      setTestPhoneError('전화번호 형식 오류');
      return;
    }
    setTestPhoneError(null);
    if (!capability?.sender_number) {
      toast.error('발신번호 미등록 — ⓪ 연결 설정에서 발신번호를 먼저 저장하세요.');
      setTestModalOpen(false);
      return;
    }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('send-notification', {
        body: { _action: 'test_sms', clinic_id: clinicId, recipient_phone: phone },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      const result = (data as { success?: boolean; message?: string });
      if (result?.success === true) {
        toast.success('전송 완료 — 본인 번호로 테스트 SMS가 발송되었습니다.');
        setTestModalOpen(false);
        setTestPhone('');
        await onRefreshLogs?.();
      } else {
        const msg = result?.message ?? '알 수 없는 오류';
        toast.error(`발송 실패: ${msg}`);
      }
    } catch (err) {
      toast.error(`테스트 실패: ${extractErrorMsg(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">⓪ 연결 설정</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Solapi API 자격증명과 발신번호를 등록합니다. Secret 값은 재노출되지 않습니다.
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">메시지 발송 활성화</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Solapi API Key</label>
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={capability?.solapi_api_key_vault_name ? '••••••••••••••••' : 'NCxxxxxxxxxxxx'}
            autoComplete="off"
          />
          {capability?.solapi_api_key_vault_name && (
            <p className="text-xs text-muted-foreground">현재 키 등록됨. 변경 시에만 입력하세요.</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Solapi API Secret</label>
          <Input
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder={capability?.solapi_secret_vault_name ? '재입력 시에만 노출' : 'Secret Key'}
            type="password"
            autoComplete="new-password"
          />
          {capability?.solapi_secret_vault_name && (
            <p className="text-xs text-muted-foreground">Secret 등록됨. 재입력 전까지는 마스킹 상태.</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">발신번호</label>
          <Input
            value={senderNumber}
            onChange={(e) => setSenderNumber(e.target.value)}
            placeholder="01012345678"
          />
          {capability?.sender_number ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  등록됨: {capability.sender_number}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 py-0 text-xs"
                  onClick={handleValidate}
                  disabled={validationPolling}
                  data-testid="sender-revalidate-btn"
                >
                  {validationPolling ? <Loader2 className="h-3 w-3 animate-spin" /> : '재검증'}
                </Button>
              </div>
              <SenderValidationBadge status={capability.solapi_validation_status} />
            </div>
          ) : (
            <p className="text-xs text-amber-600">발신번호가 등록되지 않았습니다. 저장 후 SMS 발송이 가능합니다.</p>
          )}
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          저장
        </Button>
      </div>

      {/* 연결 테스트 */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">연결 테스트</h3>
            <p className="text-xs text-muted-foreground mt-0.5">본인 번호로 테스트 SMS 1건을 발송합니다.</p>
          </div>
          <Button variant="outline" size="sm" onClick={openTestModal} data-testid="connection-test-btn">
            <Phone className="h-4 w-4 mr-1" />
            연결 테스트
          </Button>
        </div>
        {!capability?.sender_number && (
          <div className="flex items-center gap-2 text-xs text-amber-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            발신번호 미등록 — 연결 설정에서 발신번호를 먼저 저장하세요.
          </div>
        )}
      </div>

      {/* 테스트 모달 */}
      <Dialog
        open={testModalOpen}
        onOpenChange={(v) => { if (!v) { setTestModalOpen(false); setTestPhone(''); setTestPhoneError(null); } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              연결 테스트
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">본인 번호를 입력하면 테스트 SMS 1건을 발송합니다.</p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">수신 번호</label>
              <Input
                value={testPhone}
                onChange={(e) => { setTestPhone(e.target.value); setTestPhoneError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTest(); }}
                placeholder="01012345678"
                autoComplete="tel"
                data-testid="test-phone-input"
              />
              {testPhoneError && (
                <p className="text-xs text-destructive flex items-center gap-1" data-testid="phone-error">
                  <AlertCircle className="h-3 w-3" />
                  {testPhoneError}
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setTestModalOpen(false); setTestPhone(''); setTestPhoneError(null); }} disabled={testing}>
                취소
              </Button>
              <Button onClick={handleTest} disabled={testing} data-testid="test-send-btn">
                {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                발송
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ① 채널 가능 여부
// ══════════════════════════════════════════════════════════════════════════════

function SectionChannels({ capability }: { capability: MessagingCapability | null }) {
  const hasSender = !!(capability?.sender_number);
  const channels = [
    { name: 'SMS',   enabled: capability?.enabled ?? false, hasKey: !!(capability?.solapi_api_key_vault_name), hasSender, note: '90byte 이내 발송. 초과 시 LMS 자동 전환.' },
    { name: 'LMS',   enabled: capability?.enabled ?? false, hasKey: !!(capability?.solapi_api_key_vault_name), hasSender, note: '90byte 초과 본문 자동 LMS 전환. 추가 요금 적용.' },
    { name: '알림톡', enabled: false, hasKey: false, hasSender: false, note: 'Phase 2 — 카카오 비즈니스 채널 인증 후 활성화' },
  ];
  const isFullyActive = (ch: typeof channels[0]) => ch.enabled && ch.hasKey && ch.hasSender;
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">① 채널 가능 여부</h2>
        <p className="text-sm text-muted-foreground mt-1">현재 지점에서 사용 가능한 발송 채널 상태입니다.</p>
      </div>
      <div className="space-y-3">
        {channels.map((ch) => {
          const active = isFullyActive(ch);
          return (
            <div key={ch.name} className="rounded-lg border p-4 flex items-start gap-4">
              <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{ch.name}</span>
                  <Badge variant={active ? 'success' : 'secondary'}>{active ? '활성' : '비활성'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{ch.note}</p>
              </div>
            </div>
          );
        })}
      </div>
      {(!capability?.enabled || !capability?.solapi_api_key_vault_name || !hasSender) && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 rounded-lg p-3 border border-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            {!capability?.enabled && '발송 활성화'}
            {!capability?.enabled && (!capability?.solapi_api_key_vault_name || !hasSender) && ' · '}
            {!capability?.solapi_api_key_vault_name && 'API 자격증명'}
            {!capability?.solapi_api_key_vault_name && !hasSender && ' · '}
            {!hasSender && '발신번호'}
            {' '}미설정 — ⓪ 연결 설정에서 저장하세요.
          </span>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 자동 발송 규칙
// ══════════════════════════════════════════════════════════════════════════════

function SectionRules({ clinicId, templates, onRefresh }: {
  clinicId: string;
  templates: NotificationTemplate[];
  onRefresh: () => void;
}) {
  const eventTypes = ['resv_confirm', 'resv_reminder_d1', 'resv_reminder_morning', 'noshow'] as const;
  const [saving, setSaving] = useState<string | null>(null);

  const getTemplate = (et: string) => templates.find((t) => t.event_type === et && t.channel === 'sms');

  const handleToggle = async (eventType: string, isActive: boolean) => {
    setSaving(eventType);
    try {
      const existing = getTemplate(eventType);
      if (existing) {
        const { data, error } = await (supabase.from('notification_templates') as any)
          .update({ is_active: isActive })
          .eq('id', existing.id)
          .select('id');
        if (error) throw error;
        if (!data || (data as any[]).length === 0) throw new Error('업데이트 권한 없음 — 역할을 확인하세요');
      } else if (isActive) {
        const { error } = await (supabase.from('notification_templates') as any)
          .insert({ clinic_id: clinicId, event_type: eventType, channel: 'sms', body: DEFAULT_TEMPLATES[eventType] ?? `[{지점명}] {고객명}님께 안내드립니다.`, is_active: true });
        if (error) throw error;
      }
      onRefresh();
      toast.success(`${EVENT_TYPE_LABELS[eventType]} ${isActive ? '활성화' : '비활성화'}`);
    } catch (err) {
      toast.error(`저장 실패: ${extractErrorMsg(err)}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">② 자동 발송 규칙</h2>
        <p className="text-sm text-muted-foreground mt-1">4가지 트리거별 자동 발송 여부를 설정합니다.</p>
      </div>
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 border-b">
              <th className="text-left px-4 py-3 font-medium">트리거</th>
              <th className="text-left px-4 py-3 font-medium">발송 조건</th>
              <th className="text-left px-4 py-3 font-medium">채널</th>
              <th className="text-center px-4 py-3 font-medium w-24">활성</th>
            </tr>
          </thead>
          <tbody>
            {eventTypes.map((et) => {
              const tmpl = getTemplate(et);
              const active = tmpl?.is_active ?? false;
              return (
                <tr key={et} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{EVENT_TYPE_LABELS[et]}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{EVENT_TYPE_DESC[et]}</td>
                  <td className="px-4 py-3"><Badge variant="outline">SMS</Badge></td>
                  <td className="px-4 py-3 text-center">
                    {saving === et
                      ? <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                      : <Switch checked={active} onCheckedChange={(v) => handleToggle(et, v)} />
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">* 템플릿 본문은 ③ 템플릿 관리에서 수정하세요.</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 템플릿 관리
// ══════════════════════════════════════════════════════════════════════════════

function SectionTemplates({ clinicId, templates, onRefresh }: {
  clinicId: string;
  templates: NotificationTemplate[];
  onRefresh: () => void;
}) {
  const [editTarget, setEditTarget] = useState<NotificationTemplate | null>(null);
  const [editBody, setEditBody]     = useState('');
  const [saving, setSaving]         = useState(false);

  const eventTypes = ['resv_confirm', 'resv_reminder_d1', 'resv_reminder_morning', 'noshow'] as const;
  const getTemplate = (et: string) => templates.find((t) => t.event_type === et && t.channel === 'sms');

  const openEdit = (tmpl: NotificationTemplate | null, et: string) => {
    if (tmpl) { setEditTarget(tmpl); setEditBody(tmpl.body); }
    else {
      setEditTarget({ id: '', clinic_id: clinicId, event_type: et as NotificationTemplate['event_type'], channel: 'sms', body: DEFAULT_TEMPLATES[et] ?? '', is_active: false, created_at: '', updated_at: '' });
      setEditBody(DEFAULT_TEMPLATES[et] ?? '');
    }
  };

  const handleSave = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      if (editTarget.id) {
        const { data, error } = await (supabase.from('notification_templates') as any)
          .update({ body: editBody })
          .eq('id', editTarget.id)
          .select('id');
        if (error) throw error;
        if (!data || (data as any[]).length === 0) throw new Error('저장 권한 없음');
      } else {
        const { error } = await (supabase.from('notification_templates') as any)
          .insert({ clinic_id: clinicId, event_type: editTarget.event_type, channel: editTarget.channel, body: editBody, is_active: editTarget.is_active });
        if (error) throw error;
      }
      onRefresh();
      setEditTarget(null);
      toast.success('템플릿이 저장되었습니다.');
    } catch (err) {
      toast.error(`저장 실패: ${extractErrorMsg(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const previewBody = (body: string) =>
    body
      .replace(/{고객명}/g, '홍길동')
      .replace(/{날짜}/g, '2026-05-26')
      .replace(/{시간}/g, '14:30')
      .replace(/{지점명}/g, '풋센터종로')
      .replace(/{지점전화번호}/g, '010-8827-7791');

  const byteLen = (s: string) => new TextEncoder().encode(s).length;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">③ 템플릿 관리</h2>
        <p className="text-sm text-muted-foreground mt-1">
          치환 변수: {'{고객명} {날짜} {시간} {지점명} {지점전화번호}'}
        </p>
      </div>
      <div className="space-y-3">
        {eventTypes.map((et) => {
          const tmpl = getTemplate(et);
          return (
            <div key={et} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{EVENT_TYPE_LABELS[et]}</span>
                <Button size="sm" variant="outline" onClick={() => openEdit(tmpl ?? null, et)}>
                  {tmpl ? '수정' : '등록'}
                </Button>
              </div>
              {tmpl
                ? <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded p-2">{tmpl.body}</pre>
                : <p className="text-xs text-muted-foreground">템플릿이 없습니다. [등록]을 눌러 추가하세요.</p>
              }
              {tmpl && <p className="text-xs text-muted-foreground">{byteLen(tmpl.body)}byte {byteLen(tmpl.body) > 90 ? '→ LMS 발송' : '(SMS)'}</p>}
            </div>
          );
        })}
      </div>
      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? EVENT_TYPE_LABELS[editTarget.event_type] : ''} 템플릿 수정</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">본문</label>
              <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={5} className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">
                {byteLen(editBody)}byte{byteLen(editBody) > 90 ? ' — LMS로 발송됩니다' : ' (SMS)'}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">미리보기</label>
              <pre className="text-xs bg-muted/30 rounded p-3 whitespace-pre-wrap">{previewBody(editBody)}</pre>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditTarget(null)}>취소</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                저장
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 수동 발송 (stub — Phase 2)
// ══════════════════════════════════════════════════════════════════════════════

function SectionManual({ clinicId: _clinicId }: { clinicId: string }) {
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">④ 수동 발송</h2>
        <p className="text-sm text-muted-foreground mt-1">개별·타겟 발송 기능 (Phase 2 구현 예정)</p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        준비 중입니다. D-1 자동 발송 안정화 후 오픈됩니다.
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 발송 이력
// ══════════════════════════════════════════════════════════════════════════════

function SectionHistory({ logs, onRefresh }: { logs: NotificationLog[]; onRefresh: () => void }) {
  const [statusFilter, setStatusFilter]   = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');

  const filtered = logs.filter((l) => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (channelFilter !== 'all' && l.channel !== channelFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">⑤ 발송 이력</h2>
          <p className="text-sm text-muted-foreground">최근 100건</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>새로고침</Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="sent">발송 완료</SelectItem>
            <SelectItem value="failed">실패</SelectItem>
            <SelectItem value="opt_out">수신거부</SelectItem>
            <SelectItem value="skipped">건너뜀</SelectItem>
            <SelectItem value="pending">대기</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-28"><SelectValue placeholder="채널" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 채널</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="lms">LMS</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">발송 이력이 없습니다.</p>
      ) : (
        <div className="rounded-lg border overflow-x-auto" data-testid="notification-log-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="text-left px-4 py-3 font-medium">일시</th>
                <th className="text-left px-4 py-3 font-medium">트리거</th>
                <th className="text-left px-4 py-3 font-medium">채널</th>
                <th className="text-left px-4 py-3 font-medium">수신번호</th>
                <th className="text-center px-4 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => {
                const badge = STATUS_BADGE_STYLE[log.status] ?? { label: log.status, variant: 'outline' as const };
                return (
                  <tr key={log.id} className="border-b last:border-0">
                    <td className="px-4 py-2 text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                    </td>
                    <td className="px-4 py-2 text-xs">{EVENT_TYPE_LABELS[log.event_type] ?? log.event_type}</td>
                    <td className="px-4 py-2 text-xs uppercase">{log.channel}</td>
                    <td className="px-4 py-2 text-xs font-mono">{log.recipient_phone}</td>
                    <td className="px-4 py-2 text-center">
                      <Badge variant={badge.variant as any} className="text-xs">{badge.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 수신거부 명단
// ══════════════════════════════════════════════════════════════════════════════

function SectionOptOut({ clinicId, optOuts, onRefresh }: {
  clinicId: string;
  optOuts: NotificationOptOut[];
  onRefresh: () => void;
}) {
  const [newPhone, setNewPhone] = useState('');
  const [reason, setReason]     = useState('');
  const [adding, setAdding]     = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleAdd = async () => {
    const phone = newPhone.trim().replace(/[^0-9]/g, '');
    if (!phone) { toast.error('번호를 입력하세요'); return; }
    setAdding(true);
    try {
      const { error } = await (supabase.from('notification_opt_outs') as any)
        .insert({ clinic_id: clinicId, phone, reason: reason.trim() || null });
      if (error?.code === '23505') { toast.error('이미 등록된 번호입니다'); }
      else if (error) { throw error; }
      else { setNewPhone(''); setReason(''); onRefresh(); toast.success(`${phone} 수신거부 등록 완료`); }
    } catch (err) { toast.error(`등록 실패: ${extractErrorMsg(err)}`); }
    finally { setAdding(false); }
  };

  const handleRemove = async (id: string, phone: string) => {
    setRemoving(id);
    try {
      await (supabase.from('notification_opt_outs') as any).delete().eq('id', id);
      onRefresh();
      toast.success(`${phone} 수신거부 해제 완료`);
    } catch (err) { toast.error(`해제 실패: ${extractErrorMsg(err)}`); }
    finally { setRemoving(null); }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">⑥ 수신거부 명단</h2>
        <p className="text-sm text-muted-foreground mt-1">
          등록된 번호로는 어떤 발송도 차단됩니다. 셀프체크인 미동의 시 자동 적재.
        </p>
      </div>
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-semibold">번호 추가</h3>
        <div className="flex gap-2">
          <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="01012345678" className="flex-1" />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (선택)" className="flex-1" />
        </div>
        <Button onClick={handleAdd} disabled={adding} className="w-full">
          {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}추가
        </Button>
      </div>
      {optOuts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">수신거부 번호가 없습니다.</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b">
                <th className="text-left px-4 py-3 font-medium">전화번호</th>
                <th className="text-left px-4 py-3 font-medium">등록일시</th>
                <th className="text-left px-4 py-3 font-medium">사유</th>
                <th className="w-16 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {optOuts.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono text-sm">{o.phone}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(o.opted_out_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{o.reason ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm" variant="ghost"
                      className="text-destructive h-7 px-2"
                      disabled={removing === o.id}
                      onClick={() => handleRemove(o.id, o.phone)}
                    >
                      {removing === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : '해제'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ 셀프접수 QR 다운로드 (T-20260531-foot-JONGNOFOOT-SELFCHECKIN-QR-DOWNLOAD)
//   - foot-native: clinic.slug(jongno-foot) 기반 셀프접수 URL을 가리키는 QR 발급.
//   - QR 생성: SelfCheckIn.tsx 와 동일한 foot 기존 패턴(api.qrserver.com) 재사용.
//   - HFQ 코드/DB 런타임 참조 0. footCrmClient 미신설.
// ══════════════════════════════════════════════════════════════════════════════

/** object URL/외부 URL 이미지를 비동기 로드 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('QR 이미지 로드 실패'));
    img.src = src;
  });
}

/** Blob → 파일 다운로드 트리거 */
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function SectionSelfCheckinQR({ clinic }: { clinic: Clinic }) {
  const [busy, setBusy] = useState<'qr' | 'poster' | null>(null);

  // foot 셀프접수 URL — App.tsx 의 /checkin/:clinicSlug 라우트(jongno-foot). HFQ 도메인 아님.
  const checkinUrl = `${window.location.origin}/checkin/${clinic.slug}`;
  // foot 기존 QR 생성 패턴(SelfCheckIn.tsx) 재사용 — 신규 npm 도입 없음.
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(checkinUrl)}&qzone=2&margin=0&format=png`;

  // QR PNG 원본을 fetch → 동일 출처 object URL 로 변환(canvas taint 방지 + 다운로드 재사용)
  const fetchQrBlob = useCallback(async (): Promise<Blob> => {
    const res = await fetch(qrImageUrl);
    if (!res.ok) throw new Error(`QR 생성 응답 오류 (${res.status})`);
    return res.blob();
  }, [qrImageUrl]);

  const handleDownloadQr = async () => {
    setBusy('qr');
    try {
      const blob = await fetchQrBlob();
      triggerBlobDownload(blob, `셀프접수QR_${clinic.slug}.png`);
      toast.success('QR 이미지를 다운로드했습니다.');
    } catch (err) {
      toast.error(`다운로드 실패: ${extractErrorMsg(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPoster = async () => {
    setBusy('poster');
    try {
      const blob = await fetchQrBlob();
      const objUrl = URL.createObjectURL(blob);
      let qrImg: HTMLImageElement;
      try {
        qrImg = await loadImage(objUrl); // object URL = 동일 출처 → canvas taint 없음
      } finally {
        URL.revokeObjectURL(objUrl);
      }

      const W = 1080, H = 1527; // A4 비율 포스터
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('이 브라우저는 포스터 생성을 지원하지 않습니다.');

      // 배경 (크림)
      ctx.fillStyle = '#FDF8F2';
      ctx.fillRect(0, 0, W, H);
      // 상단 밴드 (브라운)
      ctx.fillStyle = '#5C3D1E';
      ctx.fillRect(0, 0, W, 250);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FDF8F2';
      ctx.font = 'bold 66px sans-serif';
      ctx.fillText(clinic.name, W / 2, 130);
      ctx.font = '42px sans-serif';
      ctx.fillText('셀프 접수', W / 2, 200);
      // 안내 문구
      ctx.fillStyle = '#3D2B1A';
      ctx.font = 'bold 58px sans-serif';
      ctx.fillText('QR을 촬영해 접수해주세요', W / 2, 440);
      ctx.fillStyle = '#7B5130';
      ctx.font = '36px sans-serif';
      ctx.fillText('휴대폰 카메라로 아래 코드를 비추면', W / 2, 520);
      ctx.fillText('접수 화면으로 이동합니다', W / 2, 572);
      // QR 흰 카드
      const qrSize = 600;
      const qx = (W - qrSize) / 2;
      const qy = 670;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(qx - 44, qy - 44, qrSize + 88, qrSize + 88);
      ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);
      // 하단 URL
      ctx.fillStyle = '#8B7355';
      ctx.font = '30px sans-serif';
      ctx.fillText(checkinUrl, W / 2, qy + qrSize + 130);

      const posterBlob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('포스터 생성 실패'))),
          'image/png',
        ),
      );
      triggerBlobDownload(posterBlob, `셀프접수포스터_${clinic.slug}.png`);
      toast.success('포스터를 다운로드했습니다.');
    } catch (err) {
      toast.error(`포스터 생성 실패: ${extractErrorMsg(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-xl space-y-6" data-testid="selfcheckin-qr-section">
      <div>
        <h2 className="text-lg font-semibold">⑦ 셀프접수 QR 다운로드</h2>
        <p className="text-sm text-muted-foreground mt-1">
          데스크에 비치할 셀프접수 QR을 발급합니다. 고객이 QR을 촬영하면 이 지점의 셀프접수 화면으로 진입합니다.
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-lg border bg-white p-3">
            <img
              src={qrImageUrl}
              alt="셀프접수 QR 코드"
              width={240}
              height={240}
              className="block"
              data-testid="selfcheckin-qr-preview"
            />
          </div>
          <code className="text-xs text-muted-foreground break-all text-center" data-testid="selfcheckin-qr-url">
            {checkinUrl}
          </code>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={handleDownloadQr}
            disabled={busy !== null}
            className="flex-1"
            data-testid="selfcheckin-qr-download-btn"
          >
            {busy === 'qr' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            QR 이미지 다운로드
          </Button>
          <Button
            variant="outline"
            onClick={handleDownloadPoster}
            disabled={busy !== null}
            className="flex-1"
            data-testid="selfcheckin-poster-download-btn"
          >
            {busy === 'poster' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            포스터 다운로드
          </Button>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            인쇄 후 데스크에 비치하세요. 기존에 인쇄해 둔 QR이 있다면, 이 코드로 교체해야 셀프접수가 정상 동작합니다.
          </span>
        </div>
      </div>
    </div>
  );
}
