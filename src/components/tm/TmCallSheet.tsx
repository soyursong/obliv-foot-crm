import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { maskPhone } from '@/lib/i18n';
import { format } from 'date-fns';
import { Phone } from 'lucide-react';

interface Lead {
  id: string;
  name: string;
  phone: string;
  source: string;
  interested_treatment: string | null;
  status: string;
  assigned_at: string | null;
  clinic_id: string | null;
  customer_id: string | null;
  memo: string | null;
}

interface CallLog {
  id: string;
  call_started_at: string;
  call_result: string | null;
  memo: string | null;
  call_category: string | null;
  call_subcategory: string | null;
}

interface CallTypeCode {
  id: string;
  category: string;
  subcategory: string;
}

interface Props {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  onSaved: (goNext: boolean) => void;
  clinicId: string;
  callerId: string;
  services: { id: string; name: string }[];
}

const CALL_RESULTS = [
  { value: 'reservation_done', label: '예약완료' },
  { value: 'recall_promise', label: '재통화약속' },
  { value: 'no_answer', label: '부재중' },
  { value: 'wrong_number', label: '결번' },
  { value: 'no_response', label: '무응답' },
  { value: 'phone_off', label: '전원오프' },
  { value: 'rejected', label: '거절/차단' },
  { value: 'scheduling', label: '일정조율중' },
  { value: 'text_only', label: '문자/카톡만' },
  { value: 'other', label: '기타' },
];

export default function TmCallSheet({ lead, open, onClose, onSaved, clinicId, callerId, services }: Props) {
  const [callHistory, setCallHistory] = useState<CallLog[]>([]);
  const [typeCodes, setTypeCodes] = useState<CallTypeCode[]>([]);
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [callResult, setCallResult] = useState('');
  const [memo, setMemo] = useState('');
  const [resDate, setResDate] = useState('');
  const [resTime, setResTime] = useState('');
  const [resService, setResService] = useState('');
  const [recallDate, setRecallDate] = useState('');
  const [recallTime, setRecallTime] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lead) return;
    (async () => {
      const { data } = await supabase
        .from('tm_call_logs')
        .select('id, call_started_at, call_result, memo, call_category, call_subcategory')
        .eq('lead_id', lead.id)
        .order('call_started_at', { ascending: false })
        .limit(3);
      setCallHistory((data || []) as CallLog[]);
    })();
  }, [lead]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('call_type_codes')
        .select('id, category, subcategory')
        .eq('is_active', true)
        .order('display_order');
      setTypeCodes((data || []) as CallTypeCode[]);
    })();
  }, []);

  useEffect(() => {
    setCategory('');
    setSubcategory('');
    setCallResult('');
    setMemo('');
    setResDate('');
    setResTime('');
    setResService('');
    setRecallDate('');
    setRecallTime('');
  }, [lead]);

  const categories = [...new Set(typeCodes.map(c => c.category))];
  const subcategories = typeCodes.filter(c => c.category === category).map(c => c.subcategory);

  const handleSave = async (goNext: boolean) => {
    if (!lead || !callResult) {
      toast.error('처리결과를 선택해주세요');
      return;
    }
    setSaving(true);
    try {
      // Insert call log
      const logData: any = {
        clinic_id: clinicId,
        lead_id: lead.id,
        customer_id: lead.customer_id || null,
        caller_id: callerId,
        call_category: category || null,
        call_subcategory: subcategory || null,
        call_result: callResult,
        memo: memo || null,
        call_direction: 'outbound',
      };

      if (callResult === 'recall_promise' && recallDate && recallTime) {
        logData.recall_at = `${recallDate}T${recallTime}:00`;
        logData.recall_done = false;
      }

      let reservationId: string | null = null;

      // If reservation done, create reservation
      if (callResult === 'reservation_done' && resDate && resTime) {
        // Ensure customer exists
        let customerId = lead.customer_id;
        if (!customerId) {
          const { data: newCust } = await supabase
            .from('customers')
            .insert({ clinic_id: clinicId, name: lead.name, phone: lead.phone, lead_id: lead.id, lead_source: lead.source })
            .select('id')
            .single();
          if (newCust) {
            customerId = newCust.id;
            await supabase.from('leads').update({ customer_id: customerId } as any).eq('id', lead.id);
          }
        }

        if (customerId) {
          const { data: resData } = await supabase
            .from('reservations')
            .insert({
              clinic_id: clinicId,
              customer_id: customerId,
              reservation_date: resDate,
              reservation_time: resTime,
              service_id: resService || null,
              status: 'reserved',
              created_by: callerId,
              lead_id: lead.id,
              referral_source: lead.source,
            })
            .select('id')
            .single();
          if (resData) reservationId = resData.id;
        }
      }

      if (reservationId) logData.reservation_id = reservationId;

      await supabase.from('tm_call_logs').insert(logData);

      // Update lead status
      const statusMap: Record<string, string> = {
        reservation_done: 'converted',
        recall_promise: 'recall',
        no_answer: 'no_answer',
        wrong_number: 'closed',
        rejected: 'closed',
        phone_off: 'no_answer',
        no_response: 'no_answer',
        scheduling: 'in_progress',
        text_only: 'in_progress',
        other: lead.status,
      };
      const newStatus = statusMap[callResult] || lead.status;
      await supabase.from('leads').update({ status: newStatus, updated_at: new Date().toISOString() } as any).eq('id', lead.id);

      toast.success('콜 결과가 저장되었습니다');
      onSaved(goNext);
    } catch (e: any) {
      toast.error('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-[480px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>콜 결과 입력</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Customer Info */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{lead.name}</span>
              <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                <Phone className="h-3.5 w-3.5" />
                {maskPhone(lead.phone)}
              </a>
            </div>
            <div className="text-xs text-muted-foreground">
              유입: {lead.source} {lead.interested_treatment && `· 관심: ${lead.interested_treatment}`}
            </div>
            {lead.assigned_at && (
              <div className="text-xs text-muted-foreground">배분일: {format(new Date(lead.assigned_at), 'yyyy-MM-dd')}</div>
            )}
          </div>

          {/* Previous calls */}
          {callHistory.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-1.5">이전 콜 이력</h4>
              <div className="space-y-1">
                {callHistory.map(h => (
                  <div key={h.id} className="text-xs bg-muted/30 rounded px-2 py-1.5">
                    <span className="text-muted-foreground">{format(new Date(h.call_started_at), 'MM/dd HH:mm')}</span>
                    <span className="ml-2 font-medium">{CALL_RESULTS.find(r => r.value === h.call_result)?.label || h.call_result}</span>
                    {h.memo && <span className="ml-2 text-muted-foreground">{h.memo}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category */}
          {categories.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">상담유형</Label>
                <Select value={category} onValueChange={(v) => { setCategory(v); setSubcategory(''); }}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {subcategories.length > 0 && (
                <div>
                  <Label className="text-xs">소분류</Label>
                  <Select value={subcategory} onValueChange={setSubcategory}>
                    <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      {subcategories.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Call Result */}
          <div>
            <Label className="text-xs font-semibold">처리결과 *</Label>
            <RadioGroup value={callResult} onValueChange={setCallResult} className="mt-2 grid grid-cols-2 gap-2">
              {CALL_RESULTS.map(r => (
                <div key={r.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={r.value} id={`cr-${r.value}`} />
                  <Label htmlFor={`cr-${r.value}`} className="text-sm cursor-pointer">{r.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Conditional: Reservation */}
          {callResult === 'reservation_done' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-green-800">예약 정보</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">예약일</Label>
                  <Input type="date" value={resDate} onChange={e => setResDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">예약시간</Label>
                  <Input type="time" value={resTime} onChange={e => setResTime(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">시술</Label>
                <Select value={resService} onValueChange={setResService}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {services.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Conditional: Recall */}
          {callResult === 'recall_promise' && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-3">
              <h4 className="text-sm font-semibold text-orange-800">재콜 약속</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">날짜</Label>
                  <Input type="date" value={recallDate} onChange={e => setRecallDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">시간</Label>
                  <Input type="time" value={recallTime} onChange={e => setRecallTime(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* Memo */}
          <div>
            <Label className="text-xs">상담내용</Label>
            <Textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3} placeholder="통화 내용을 입력하세요" />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => handleSave(false)} disabled={saving}>
              저장
            </Button>
            <Button className="flex-1 bg-accent text-accent-foreground" onClick={() => handleSave(true)} disabled={saving}>
              저장 + 다음 콜
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
