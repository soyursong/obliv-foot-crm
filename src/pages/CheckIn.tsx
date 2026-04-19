import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { t, Language } from '@/lib/i18n';
import { getKSTDateString } from '@/lib/utils';

type Step = 'ask' | 'select-reservation' | 'walk-in-form' | 'resident-id';

interface TodayReservation {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  reservation_time: string;
}

const COUNTRY_CODES = [
  { code: '+82', label: '🇰🇷 +82' },
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+81', label: '🇯🇵 +81' },
  { code: '+86', label: '🇨🇳 +86' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+61', label: '🇦🇺 +61' },
  { code: '+65', label: '🇸🇬 +65' },
  { code: '+66', label: '🇹🇭 +66' },
  { code: '+84', label: '🇻🇳 +84' },
];

const REFERRAL_SOURCES_KO = ['네이버 검색', '인스타그램', '지인 소개', '네이버 블로그', '유튜브', '네이버 지도', '기타'];
const REFERRAL_SOURCES_EN = ['Search Engine', 'Instagram', 'Friend Referral', 'Blog', 'YouTube', 'Map App', 'Other'];

function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

function lastFourDigits(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.slice(-4);
}

export default function CheckIn() {
  const { clinicSlug } = useParams<{ clinicSlug: string }>();
  const navigate = useNavigate();
  const [lang, setLang] = useState<Language>('ko');
  const [clinicName, setClinicName] = useState('');
  const [clinicId, setClinicId] = useState('');

  // Step flow
  const [step, setStep] = useState<Step>('ask');
  const [todayReservations, setTodayReservations] = useState<TodayReservation[]>([]);
  const [selectedReservation, setSelectedReservation] = useState<TodayReservation | null>(null);

  // Walk-in form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+82');
  const [referralSource, setReferralSource] = useState('');

  // Shared
  const [residentId, setResidentId] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!clinicSlug) return;
    supabase
      .from('clinics')
      .select('id, name')
      .eq('slug', clinicSlug)
      .single()
      .then(({ data }) => {
        if (data) {
          setClinicId(data.id);
          setClinicName(data.name);
        }
      });
  }, [clinicSlug]);

  const handleHasReservation = async () => {
    setLoading(true);
    try {
      const today = getKSTDateString();
      const { data } = await (supabase as any).rpc('get_today_reservations', { p_clinic_id: clinicId, p_date: today });
      const reservations = (data || []) as TodayReservation[];
      if (reservations.length === 0) {
        toast({ title: lang === 'ko' ? '오늘 예약이 없습니다. 정보를 입력해주세요.' : 'No reservations found today.', variant: 'destructive' });
        setStep('walk-in-form');
      } else {
        setTodayReservations(reservations);
        setStep('select-reservation');
      }
    } catch (err) {
      console.error(err);
      toast({ title: lang === 'ko' ? '오류가 발생했습니다.' : 'An error occurred.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectReservation = (res: TodayReservation) => {
    setSelectedReservation(res);
    setName(res.customer_name);
    setStep('resident-id');
  };

  const handleWalkInNext = () => {
    if (!name.trim() || !phone.trim() || !referralSource) return;
    setStep('resident-id');
  };

  const handleFinalSubmit = async () => {
    if (!residentId.trim() || !consent) return;
    setLoading(true);

    try {
      const { data: queueData } = await supabase.rpc('next_queue_number', { p_clinic_id: clinicId });
      const queueNumber = (queueData as number) || 1;

      let customerId: string | null = null;
      let reservationId: string | null = null;
      let customerName = name.trim();
      let customerPhone = '';

      if (selectedReservation) {
        // 예약 고객
        customerId = selectedReservation.customer_id;
        customerPhone = selectedReservation.customer_phone;
        customerName = selectedReservation.customer_name;
        reservationId = selectedReservation.id;
        // 주민번호 업데이트
        await supabase.from('customers').update({ resident_id: residentId.trim() } as any).eq('id', customerId);
        // 예약 상태 업데이트
        const today = getKSTDateString();
        await (supabase as any).rpc('match_reservation_for_checkin', { p_customer_id: customerId, p_date: today });
      } else {
        // 워크인 고객
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        // 박민지 #6: 한국 번호는 010 형식 그대로 저장
        if (countryCode === '+82') {
          customerPhone = cleanPhone.startsWith('0') ? cleanPhone : '0' + cleanPhone;
        } else {
          const normalized = cleanPhone.replace(/^0/, '');
          customerPhone = `${countryCode}${normalized}`;
        }

        // W2-03: 010-0000-0000 더미폰은 기존 매칭 건너뛰고 항상 신규 생성
        const isDummyPhone = customerPhone.replace(/[^0-9]/g, '') === '01000000000';
        if (!isDummyPhone) {
          const { data: existing } = await (supabase as any)
            .rpc('find_customer_by_phone', { p_clinic_id: clinicId, p_phone: customerPhone });
          if (existing && (existing as any[]).length > 0) {
            customerId = (existing as any[])[0].id;
            await supabase.from('customers').update({ resident_id: residentId.trim() } as any).eq('id', customerId);
          }
        }
        if (!customerId) {
          const { data: newC } = await supabase
            .from('customers')
            .insert({ clinic_id: clinicId, name: customerName, phone: customerPhone, resident_id: residentId.trim() } as any)
            .select('id')
            .single();
          if (newC) customerId = newC.id;
        }
      }

      const { data, error } = await supabase.from('check_ins').insert({
        clinic_id: clinicId,
        queue_number: queueNumber,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_id: customerId,
        reservation_id: reservationId,
        referral_source: selectedReservation ? 'tm_reservation' : referralSource,
        language: lang,
      }).select('id').single();

      if (error) throw error;
      navigate(`/wait/${data.id}`);
    } catch (err) {
      console.error(err);
      toast({ title: lang === 'ko' ? '체크인에 실패했습니다. 다시 시도해주세요.' : 'Check-in failed.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const referralSources = lang === 'ko' ? REFERRAL_SOURCES_KO : REFERRAL_SOURCES_EN;

  const isLoading = !clinicId && !!clinicSlug;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[480px]" style={{ minHeight: '258px' }}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: '258px' }}>
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
            <p className="text-muted-foreground text-sm">불러오는 중...</p>
          </div>
        ) : (
          <>
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-between mb-4">
            <div />
            <button
              onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
              className="text-sm font-medium text-accent px-3 py-1 rounded-full border border-accent/30 hover:bg-accent/10 transition"
            >
              {lang === 'ko' ? 'English' : '한국어'}
            </button>
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t(lang, 'brandName')}</h1>
          <p className="text-muted-foreground mt-1">{clinicName}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {lang === 'ko' ? '셀프 체크인' : 'Self Check-in'}
          </p>
        </div>

        {/* Step 1: 예약 여부 질문 */}
        {step === 'ask' && (
          <div className="space-y-4">
            <p className="text-center text-lg font-medium">
              {lang === 'ko' ? '예약하셨나요?' : 'Do you have a reservation?'}
            </p>
            <div className="flex gap-3">
              <Button
                className="flex-1 h-14 text-lg bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleHasReservation}
                disabled={loading}
              >
                {loading ? '...' : lang === 'ko' ? '네, 예약했어요' : 'Yes'}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-14 text-lg"
                onClick={() => setStep('walk-in-form')}
              >
                {lang === 'ko' ? '아니요' : 'No'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2a: 예약 리스트에서 본인 선택 */}
        {step === 'select-reservation' && (
          <div className="space-y-3">
            <p className="text-center text-sm font-medium text-muted-foreground mb-4">
              {lang === 'ko' ? '본인 이름을 선택해주세요' : 'Select your name'}
            </p>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {todayReservations.map((res) => (
                <button
                  key={res.id}
                  className="w-full text-left p-4 rounded-lg border hover:bg-accent/5 hover:border-accent transition flex justify-between items-center"
                  onClick={() => handleSelectReservation(res)}
                >
                  <div>
                    <span className="text-base font-medium">{maskName(res.customer_name)}</span>
                    <span className="text-sm text-muted-foreground ml-2">****{lastFourDigits(res.customer_phone)}</span>
                  </div>
                  <span className="text-sm text-accent font-medium">{String(res.reservation_time).slice(0, 5)}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" className="w-full mt-2" onClick={() => setStep('ask')}>
              {lang === 'ko' ? '← 돌아가기' : '← Back'}
            </Button>
          </div>
        )}

        {/* Step 2b: 워크인 정보 입력 */}
        {step === 'walk-in-form' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t(lang, 'name')}</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={lang === 'ko' ? '홍길동' : 'John Doe'} required className="h-12 text-base" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t(lang, 'phone')}</label>
              <div className="flex gap-2">
                <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="h-12 rounded-lg border border-input bg-background px-3 text-base w-[120px] shrink-0">
                  {COUNTRY_CODES.map((cc) => (<option key={cc.code} value={cc.code}>{cc.label}</option>))}
                </select>
                <Input
                  value={phone}
                  onChange={(e) => {
                    let v = e.target.value.replace(/[^0-9]/g, '');
                    if (countryCode === '+82' && v.length > 0) {
                      if (!v.startsWith('0')) v = '0' + v;
                      if (v.length >= 4) v = v.slice(0, 3) + '-' + v.slice(3);
                      if (v.length >= 9) v = v.slice(0, 8) + '-' + v.slice(8);
                      if (v.length > 13) v = v.slice(0, 13);
                    }
                    setPhone(v);
                  }}
                  placeholder={countryCode === '+82' ? '010-0000-0000' : ''}
                  required type="tel" className="h-12 text-base flex-1"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {lang === 'ko' ? '방문 경로' : 'How did you find us?'} <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {referralSources.map((source) => (
                  <button key={source} type="button" onClick={() => setReferralSource(source)}
                    className={`h-10 rounded-lg border text-sm font-medium transition-colors ${referralSource === source ? 'border-accent bg-accent/10 text-accent' : 'border-input bg-background text-foreground hover:bg-muted'}`}>
                    {source}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep('ask')}>{lang === 'ko' ? '← 돌아가기' : '← Back'}</Button>
              <Button className="flex-1 h-12 bg-accent text-accent-foreground" onClick={handleWalkInNext} disabled={!name.trim() || !phone.trim() || !referralSource}>
                {lang === 'ko' ? '다음' : 'Next'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: 주민번호 입력 + 개인정보동의 */}
        {step === 'resident-id' && (
          <div className="space-y-4">
            {selectedReservation && (
              <div className="p-3 bg-accent/5 rounded-lg border border-accent/20 text-center">
                <p className="text-sm text-muted-foreground">{lang === 'ko' ? '예약 확인' : 'Reservation confirmed'}</p>
                <p className="text-lg font-medium mt-1">{selectedReservation.customer_name}</p>
                <p className="text-sm text-accent">{String(selectedReservation.reservation_time).slice(0, 5)}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {lang === 'ko' ? '주민등록번호' : 'Resident ID'} <span className="text-destructive">*</span>
              </label>
              <Input
                value={residentId}
                onChange={(e) => {
                  let v = e.target.value.replace(/[^0-9]/g, '');
                  if (v.length > 6) v = v.slice(0, 6) + '-' + v.slice(6);
                  if (v.length > 14) v = v.slice(0, 14);
                  setResidentId(v);
                }}
                placeholder="000000-0000000"
                required className="h-12 text-base"
              />
            </div>
            <div className="flex items-start gap-3 py-2">
              <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
              <div className="flex-1">
                <Dialog>
                  <DialogTrigger asChild>
                    <label htmlFor="consent" className="text-sm font-medium text-foreground cursor-pointer underline decoration-dotted underline-offset-2">
                      {t(lang, 'privacyConsent')}
                    </label>
                  </DialogTrigger>
                  <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>{t(lang, 'privacyTitle')}</DialogTitle></DialogHeader>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>• {t(lang, 'privacyItems')}</p>
                      <p>• {t(lang, 'privacyPurpose')}</p>
                      <p>• {t(lang, 'privacyRetention')}</p>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setStep(selectedReservation ? 'select-reservation' : 'walk-in-form'); setSelectedReservation(null); }}>
                {lang === 'ko' ? '← 돌아가기' : '← Back'}
              </Button>
              <Button
                className="flex-1 h-14 text-lg font-semibold bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleFinalSubmit}
                disabled={!residentId.trim() || !consent || loading}
              >
                {loading ? (lang === 'ko' ? '체크인 중...' : 'Checking in...') : t(lang, 'checkIn')}
              </Button>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
