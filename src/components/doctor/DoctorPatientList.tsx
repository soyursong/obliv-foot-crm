// DoctorPatientList — 진료 완료 환자 리스트 + 빠른처방 버튼
// T-20260512-foot-QUICK-RX-BUTTON
//
// 오늘 접수된 환자 목록을 보여주고, 각 행에 빠른처방 버튼을 노출.
// 치료사: 원장 구두 지시 듣고 → 해당 환자 행 버튼 클릭 → 임시 처방 입력
// 원장  : 직접 버튼 클릭 → 바로 확정 / 또는 임시 처방 확인 후 확정 버튼

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Clock, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import QuickRxBar, { isDoctor } from './QuickRxBar';
import { STATUS_KO } from '@/lib/status';
import type { CheckInStatus } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PatientRow {
  id: string;
  customer_name: string;
  visit_type: 'new' | 'returning' | 'experience';
  status: CheckInStatus;
  checked_in_at: string;
  queue_number: number | null;
  prescription_status: 'none' | 'pending' | 'confirmed';
  doctor_confirmed_at: string | null;
  prescription_items: unknown;
  doctor_confirm_prescription: boolean;
}

// ---------------------------------------------------------------------------
// 처방 상태 배지
// ---------------------------------------------------------------------------
function PrescriptionStatusBadge({ status }: { status: PatientRow['prescription_status'] }) {
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
        <CheckCircle2 className="h-2.5 w-2.5" />
        확정
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        <Clock className="h-2.5 w-2.5" />
        임시
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
      처방 없음
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
function useTodayPatients(clinicId: string | null) {
  return useQuery({
    queryKey: ['quick_rx_patient_list', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('check_ins')
        .select(
          'id, customer_name, visit_type, status, checked_in_at, queue_number, prescription_status, doctor_confirmed_at, prescription_items, doctor_confirm_prescription',
        )
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', `${today}T00:00:00`)
        .lte('checked_in_at', `${today}T23:59:59`)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PatientRow[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function useConfirmPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (checkInId: string) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('check_ins')
        .update({
          prescription_status: 'confirmed',
          doctor_confirm_prescription: true,
          doctor_confirmed_at: now,
        })
        .eq('id', checkInId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick_rx_patient_list'] });
      toast.success('처방이 확정됐어요.');
    },
    onError: (e: Error) => toast.error(`확정 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// 방문 유형 배지
// ---------------------------------------------------------------------------
function VisitTypeBadge({ type }: { type: PatientRow['visit_type'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: '초진', cls: 'bg-blue-100 text-blue-700' },
    returning: { label: '재진', cls: 'bg-emerald-100 text-emerald-700' },
    // experience: 배지 미표시 (AC-4) — fallback 처리
  };
  const { label, cls } = map[type] ?? { label: type, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 환자 행 컴포넌트
// ---------------------------------------------------------------------------
function PatientRow({
  row,
  doctorMode,
  onRefresh,
}: {
  row: PatientRow;
  doctorMode: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const confirm = useConfirmPrescription();

  const hasPendingRx = row.prescription_status === 'pending';
  const isConfirmed = row.prescription_status === 'confirmed';

  return (
    <div
      className={`rounded-lg border transition ${
        hasPendingRx ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-card'
      }`}
      data-testid="patient-row"
    >
      {/* 기본 행 */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* 번호 */}
        <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">
          {row.queue_number ?? '—'}
        </span>

        {/* 이름 + 방문유형 */}
        <div className="flex items-center gap-2 min-w-[100px] shrink-0">
          <span className="text-sm font-semibold">{row.customer_name}</span>
          <VisitTypeBadge type={row.visit_type} />
        </div>

        {/* 상태 */}
        <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:block">
          {STATUS_KO[row.status] ?? row.status}
        </span>

        {/* 처방 상태 */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <PrescriptionStatusBadge status={row.prescription_status} />

          {/* 임시 처방이고 의사인 경우 → 확정 버튼 */}
          {hasPendingRx && doctorMode && (
            <Button
              size="sm"
              className="h-6 text-[11px] bg-teal-600 hover:bg-teal-700 px-2"
              onClick={() => confirm.mutate(row.id)}
              disabled={confirm.isPending}
              data-testid="confirm-prescription-btn"
            >
              {confirm.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-0.5" />
              )}
              확정
            </Button>
          )}

          {/* 임시 처방 알림 (치료사용) */}
          {hasPendingRx && !doctorMode && (
            <span className="text-[10px] text-amber-700 flex items-center gap-0.5">
              <AlertCircle className="h-3 w-3" />
              원장 확인 대기
            </span>
          )}

          {/* 펼치기 토글 */}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="rounded p-0.5 hover:bg-accent transition text-muted-foreground"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* 펼쳐진 영역 — 빠른처방 버튼 */}
      {expanded && !isConfirmed && (
        <div className="border-t px-3 py-2.5 bg-white rounded-b-lg">
          <QuickRxBar
            doctorMode={doctorMode}
            checkInId={row.id}
            onApplied={onRefresh}
            compact
          />
          {hasPendingRx && (
            <p className="text-[11px] text-amber-700 mt-1.5">
              ℹ 이미 임시 처방이 입력되어 있습니다. 버튼 클릭 시 덮어씌워집니다.
            </p>
          )}
        </div>
      )}

      {/* 확정된 경우 처방 내용 요약 */}
      {expanded && isConfirmed && (
        <div className="border-t px-3 py-2.5 bg-green-50/60 rounded-b-lg">
          <div className="flex items-center gap-1.5 text-[11px] text-green-700 font-medium mb-1">
            <CheckCircle2 className="h-3 w-3" />
            처방 확정 완료
            {row.doctor_confirmed_at && (
              <span className="ml-auto text-green-600 font-normal">
                {format(new Date(row.doctor_confirmed_at), 'HH:mm', { locale: ko })}
              </span>
            )}
          </div>
          {Array.isArray(row.prescription_items) && row.prescription_items.length > 0 && (
            <div className="space-y-0.5">
              {(row.prescription_items as Array<{ name: string; frequency: string; days: number }>)
                .slice(0, 3)
                .map((item, idx) => (
                  <p key={idx} className="text-[10px] text-muted-foreground">
                    {item.name} — {item.frequency} {item.days}일
                  </p>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DoctorPatientList — Main Export
// ---------------------------------------------------------------------------
export default function DoctorPatientList() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const doctorMode = isDoctor(profile?.role ?? '');

  const { data: patients = [], isLoading, refetch } = useTodayPatients(clinicId);

  // 필터 상태
  const [filter, setFilter] = useState<'all' | 'pending' | 'none'>('all');

  const filtered = patients.filter((p) => {
    if (filter === 'pending') return p.prescription_status === 'pending';
    if (filter === 'none') return p.prescription_status === 'none';
    return true;
  });

  const pendingCount = patients.filter((p) => p.prescription_status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">오늘 진료 환자 목록</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(), 'M월 d일 (EEE)', { locale: ko })} · {patients.length}명 접수
            {pendingCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">⚠ 임시처방 {pendingCount}명 대기 중</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 역할 배지 */}
          <span
            className={`text-[10px] font-medium px-2 py-1 rounded-full border ${
              doctorMode
                ? 'border-teal-400 bg-teal-50 text-teal-700'
                : 'border-amber-300 bg-amber-50 text-amber-700'
            }`}
          >
            {doctorMode ? '의사 모드 — 바로 확정' : '치료사 모드 — 임시 처방'}
          </span>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1">
        {[
          { key: 'all' as const, label: `전체 (${patients.length})` },
          { key: 'pending' as const, label: `임시 (${pendingCount})` },
          { key: 'none' as const, label: '처방 없음' },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === key
                ? 'bg-teal-600 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {filter === 'all' ? '오늘 접수된 환자가 없습니다.' : '해당 조건의 환자가 없습니다.'}
        </div>
      ) : (
        <div className="space-y-2" data-testid="patient-list">
          {filtered.map((row) => (
            <PatientRow
              key={row.id}
              row={row}
              doctorMode={doctorMode}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}

      {/* 사용 안내 */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground space-y-0.5">
        <p className="font-medium text-foreground/60">사용 방법</p>
        <p>• 환자 행 오른쪽 화살표를 눌러 빠른처방 버튼을 펼치세요.</p>
        <p>• {doctorMode ? '원장 모드: 버튼 클릭 시 바로 확정 처리됩니다.' : '치료사 모드: 버튼 클릭 시 임시(pending) 상태로 저장되고, 원장 확인 후 확정됩니다.'}</p>
        <p>• 임시(⚠) 상태인 행은 노란 테두리로 표시됩니다.</p>
      </div>
    </div>
  );
}
