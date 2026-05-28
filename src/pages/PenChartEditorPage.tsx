/**
 * T-20260528-foot-PENCHART-NEWWIN: 펜차트 별도 팝업 편집 창
 *
 * window.open('/penchart-editor?customerId=...&clinicId=...&checkInId=...') 로 호출.
 * 고객 데이터(이름/생년월일/차트번호/주민번호)를 Supabase에서 직접 로드한 뒤
 * PenChartTab을 popupMode=true 로 렌더 → 저장 후 BroadcastChannel 브로드캐스트 + window.close().
 *
 * 인증: 동일 origin → localStorage Supabase 세션 공유. 미인증 시 ProtectedRoute가 /login 리다이렉트.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PenChartTab } from '@/components/PenChartTab';

interface CustomerSnap {
  name: string;
  birth_date: string | null;
  chart_number: number | null;
  clinic_id: string;
}

export default function PenChartEditorPage() {
  const [searchParams] = useSearchParams();
  const customerId = searchParams.get('customerId') ?? '';
  const clinicIdParam = searchParams.get('clinicId') ?? '';
  const checkInId = searchParams.get('checkInId') ?? undefined;

  const [customer, setCustomer] = useState<CustomerSnap | null>(null);
  const [rrnFull, setRrnFull] = useState<string | null | undefined>(undefined); // undefined=로드전
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) {
      setError('고객 ID 누락 — URL에 customerId 파라미터가 필요합니다.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      // 고객 기본 정보 로드
      const { data, error: fetchErr } = await supabase
        .from('customers')
        .select('name, birth_date, chart_number, clinic_id')
        .eq('id', customerId)
        .maybeSingle();

      if (cancelled) return;
      if (fetchErr || !data) {
        setError(`고객 정보 로드 실패: ${fetchErr?.message ?? '존재하지 않는 고객'}`);
        setLoading(false);
        return;
      }
      setCustomer(data);

      // 주민번호 복호화 (보험차트 자동채움용)
      const { data: rrnData } = await supabase.rpc('rrn_decrypt', { customer_uuid: customerId });
      if (cancelled) return;
      if (rrnData) {
        const s = String(rrnData).replace(/\D/g, '');
        setRrnFull(s.slice(0, 6) + '-' + s.slice(6));
      } else {
        setRrnFull(null);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [customerId]);

  // 창 제목 설정
  useEffect(() => {
    if (customer) {
      document.title = `펜차트 — ${customer.name}`;
    }
  }, [customer]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        불러오는 중…
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-sm text-red-500">
        <p>{error ?? '오류가 발생했습니다.'}</p>
        <button
          className="text-xs text-muted-foreground underline"
          onClick={() => window.close()}
        >
          창 닫기
        </button>
      </div>
    );
  }

  const clinicId = clinicIdParam || customer.clinic_id;

  return (
    <div className="min-h-screen bg-white">
      <PenChartTab
        customerId={customerId}
        clinicId={clinicId}
        checkInId={checkInId}
        customerName={customer.name}
        customerBirthDate={customer.birth_date ?? undefined}
        customerChartNumber={customer.chart_number?.toString() ?? undefined}
        customerRrn={rrnFull ?? undefined}
        popupMode
      />
    </div>
  );
}
