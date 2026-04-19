import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Phone } from 'lucide-react';

interface CallLog {
  id: string;
  call_started_at: string;
  call_direction: string | null;
  call_category: string | null;
  call_subcategory: string | null;
  call_result: string | null;
  memo: string | null;
}

interface LeadInfo {
  id: string;
  created_at: string;
  source: string;
}

const RESULT_LABELS: Record<string, string> = {
  reservation_done: '예약완료',
  recall_promise: '재통화약속',
  no_answer: '부재중',
  wrong_number: '결번',
  no_response: '무응답',
  phone_off: '전원오프',
  rejected: '거절/차단',
  scheduling: '일정조율중',
  text_only: '문자/카톡만',
  other: '기타',
};

interface Props {
  customerId: string;
  phone: string;
}

export default function TmCallHistoryTab({ customerId, phone }: Props) {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Get call logs by customer_id
      const { data: logData } = await supabase
        .from('tm_call_logs')
        .select('id, call_started_at, call_direction, call_category, call_subcategory, call_result, memo')
        .eq('customer_id', customerId)
        .order('call_started_at', { ascending: false })
        .limit(50);

      // Also check by lead_id
      const { data: leads } = await supabase
        .from('leads')
        .select('id, created_at, source')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (leads && leads.length > 0) {
        setLeadInfo(leads[0] as LeadInfo);

        // Get logs by lead_id too
        const { data: leadLogs } = await supabase
          .from('tm_call_logs')
          .select('id, call_started_at, call_direction, call_category, call_subcategory, call_result, memo')
          .eq('lead_id', leads[0].id)
          .order('call_started_at', { ascending: false })
          .limit(50);

        // Merge and dedupe
        const allLogs = [...(logData || []), ...(leadLogs || [])];
        const unique = Array.from(new Map(allLogs.map(l => [l.id, l])).values());
        unique.sort((a, b) => new Date(b.call_started_at).getTime() - new Date(a.call_started_at).getTime());
        setLogs(unique as CallLog[]);
      } else {
        setLogs((logData || []) as CallLog[]);
      }

      setLoading(false);
    })();
  }, [customerId]);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4 text-center">로딩 중...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">콜 이력</h4>
        <a href={`tel:${phone}`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <Phone className="h-3 w-3" /> 전화걸기
        </a>
      </div>

      {/* Lead origin */}
      {leadInfo && (
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs">
          <span className="font-medium text-blue-800">리드 유입</span>
          <span className="ml-2 text-blue-600">{format(new Date(leadInfo.created_at), 'yyyy-MM-dd HH:mm')}</span>
          <span className="ml-2 text-blue-600">· {leadInfo.source}</span>
        </div>
      )}

      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">콜 이력이 없습니다</p>
      ) : (
        <div className="space-y-1.5">
          {logs.map(log => (
            <div key={log.id} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">
                  {format(new Date(log.call_started_at), 'yyyy-MM-dd HH:mm')}
                  <span className="ml-1.5">{log.call_direction === 'inbound' ? '📥 수신' : '📤 발신'}</span>
                </span>
                <span className="text-xs font-medium">
                  {RESULT_LABELS[log.call_result || ''] || log.call_result || '-'}
                </span>
              </div>
              {(log.call_category || log.call_subcategory) && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {[log.call_category, log.call_subcategory].filter(Boolean).join(' > ')}
                </div>
              )}
              {log.memo && (
                <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{log.memo}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
