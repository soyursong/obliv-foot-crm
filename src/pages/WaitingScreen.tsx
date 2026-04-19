import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { t, Language, formatQueueNumber, getStatusLabel, getStatusColorClass } from '@/lib/i18n';

interface CheckInData {
  id: string;
  queue_number: number;
  customer_name: string;
  status: string;
  language: string;
  clinic_id: string;
  reservation_id?: string | null;
}

interface ClinicData {
  name: string;
}

export default function WaitingScreen() {
  const { checkInId } = useParams<{ checkInId: string }>();
  const navigate = useNavigate();
  const [checkIn, setCheckIn] = useState<CheckInData | null>(null);
  const [clinic, setClinic] = useState<ClinicData | null>(null);
  const [ahead, setAhead] = useState(0);
  const [matchedResTime, setMatchedResTime] = useState<string | null>(null);
  const [summary, setSummary] = useState({ waiting: 0, consultation: 0, treatment: 0 });
  const [callAlert, setCallAlert] = useState<string | null>(null);
  const lang = (checkIn?.language as Language) || 'ko';

  const fetchAheadAndSummary = useCallback(async (clinicId: string, queueNumber: number) => {
    const { data: allCheckIns } = await supabase
      .from('check_ins')
      .select('queue_number, status')
      .eq('clinic_id', clinicId)
      .eq('created_date', new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));

    if (allCheckIns) {
      const waitingAhead = allCheckIns.filter(
        (c) => c.status === 'waiting' && c.queue_number < queueNumber
      ).length;
      setAhead(waitingAhead);
      setSummary({
        waiting: allCheckIns.filter((c) => c.status === 'waiting').length,
        consultation: allCheckIns.filter((c) => c.status === 'consultation').length,
        treatment: allCheckIns.filter((c) => c.status === 'treatment').length,
      });
    }
  }, []);

  useEffect(() => {
    if (!checkInId) return;

    const fetchData = async () => {
      const { data } = await supabase
        .from('check_ins')
        .select('id, queue_number, customer_name, status, language, clinic_id, reservation_id')
        .eq('id', checkInId)
        .single();

      if (data) {
        setCheckIn(data as CheckInData);
        const { data: clinicData } = await supabase
          .from('clinics')
          .select('name')
          .eq('id', data.clinic_id!)
          .single();
        if (clinicData) setClinic(clinicData);
        fetchAheadAndSummary(data.clinic_id!, data.queue_number);
        // Show matched reservation time
        if (data.reservation_id) {
          const { data: resData } = await supabase.from('reservations')
            .select('reservation_time').eq('id', data.reservation_id).single();
          if (resData) setMatchedResTime((resData as any).reservation_time?.slice(0, 5));
        }
      }
    };

    fetchData();

    const channel = supabase
      .channel(`check_in_${checkInId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'check_ins', filter: `id=eq.${checkInId}` },
        (payload) => {
          const newData = payload.new as CheckInData;
          const oldData = payload.old as CheckInData;
          setCheckIn(newData);

          if (newData.status !== oldData.status && newData.status !== 'done') {
            setCallAlert(newData.status);
            try {
              navigator.vibrate?.([200, 100, 200]);
            } catch {}
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2LkZeYl5KMhXx0bGVfXGBka3J5gIaLjo+PjYqGgXx2cW1qamtuc3mAhouQlJaXl5aSjYiCfHZxbWpqbG9zenp+');
            audio.play().catch(() => {});
          }

          if (newData.clinic_id) {
            fetchAheadAndSummary(newData.clinic_id, newData.queue_number);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [checkInId, fetchAheadAndSummary]);

  if (!checkIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
          <p className="text-muted-foreground text-sm" role="status" aria-live="polite">불러오는 중...</p>
        </div>
      </div>
    );
  }

  const getCallMessage = (status: string) => {
    if (status === 'consultation') return t(lang, 'callAlertConsultation');
    if (status === 'treatment') return t(lang, 'callAlertTreatment');
    return t(lang, 'callAlertDone');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 relative">
      {/* Call Alert Overlay */}
      {callAlert && (
        <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center text-accent-foreground animate-pulse-call ${getStatusColorClass(callAlert)}`}>
          <p className="text-4xl font-bold mb-4">{t(lang, 'callAlertTitle')}</p>
          <p className="text-2xl font-semibold mb-2">{checkIn.customer_name}</p>
          <p className="text-5xl font-bold mb-6">{formatQueueNumber(checkIn.queue_number)}</p>
          <p className="text-xl mb-8">{getCallMessage(callAlert)}</p>
          <Button
            onClick={() => setCallAlert(null)}
            className="text-lg px-8 py-4 h-auto bg-white text-foreground font-bold shadow-lg hover:bg-gray-100"
          >
            {t(lang, 'confirm')}
          </Button>
        </div>
      )}

      <div className="w-full max-w-[480px]">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">{t(lang, 'brandName')}</h1>
          <p className="text-muted-foreground mt-1">{clinic?.name}</p>
        </div>

        {/* Main Card */}
        <div className="bg-card rounded-2xl shadow-lg border border-border p-8 text-center mb-6">
          <p className="text-6xl font-bold text-foreground mb-4">
            {formatQueueNumber(checkIn.queue_number)}
          </p>
          <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-medium text-accent-foreground ${getStatusColorClass(checkIn.status || 'waiting')}`}>
            {getStatusLabel(checkIn.status || 'waiting', lang)}
          </span>
          {matchedResTime && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700">
              {lang === 'ko' ? `${matchedResTime} 예약이 확인되었습니다` : `Your ${matchedResTime} appointment has been confirmed`}
            </div>
          )}
          <div className="mt-6 text-lg text-muted-foreground">
            {t(lang, 'queueAhead')}: <span className="font-bold text-foreground">{ahead}{t(lang, 'people')}</span>
          </div>
          {ahead > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {lang === 'ko' ? `예상 대기시간: 약 ${ahead * 15}분` : `Estimated wait: ~${ahead * 15} min`}
            </p>
          )}
        </div>

        {/* Summary Bar */}
        {checkIn.status === 'waiting' && (
          <div className="text-center mb-4">
            <button
              onClick={async () => {
                const msg = lang === 'ko' ? '체크인을 취소하시겠습니까?' : 'Cancel your check-in?';
                if (!window.confirm(msg)) return;
                await supabase.from('check_ins').update({ status: 'no_show' } as any).eq('id', checkIn.id);
                navigate(-1);
              }}
              className="text-sm text-muted-foreground underline py-2 px-4 min-h-[44px]"
            >
              {lang === 'ko' ? '체크인 취소' : 'Cancel Check-in'}
            </button>
          </div>
        )}

        <div className="flex justify-center gap-4 text-sm text-muted-foreground">
          <span>{t(lang, 'summaryWaiting')} <strong className="text-foreground">{summary.waiting}</strong>{t(lang, 'people')}</span>
          <span>·</span>
          <span>{t(lang, 'summaryConsultation')} <strong className="text-foreground">{summary.consultation}</strong>{t(lang, 'people')}</span>
          <span>·</span>
          <span>{t(lang, 'summaryTreatment')} <strong className="text-foreground">{summary.treatment}</strong>{t(lang, 'people')}</span>
        </div>
      </div>
    </div>
  );
}
