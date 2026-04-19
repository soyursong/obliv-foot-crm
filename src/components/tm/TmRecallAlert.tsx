import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RecallItem {
  id: string;
  lead_id: string;
  recall_at: string;
  memo: string | null;
  lead_name?: string;
  lead_phone?: string;
}

interface Props {
  callerId: string;
  onRecallDue: (leadId: string) => void;
}

export function useTmRecallAlert({ callerId, onRecallDue }: Props) {
  const notifiedRef = useRef<Set<string>>(new Set());

  const checkRecalls = useCallback(async () => {
    if (!callerId) return;
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('tm_call_logs')
      .select('id, lead_id, recall_at, memo')
      .eq('recall_done', false)
      .not('recall_at', 'is', null)
      .lte('recall_at', now)
      .eq('caller_id', callerId)
      .limit(20);

    if (!data || data.length === 0) return;

    for (const item of data as RecallItem[]) {
      if (notifiedRef.current.has(item.id)) continue;
      notifiedRef.current.add(item.id);

      // Get lead info
      const { data: lead } = await supabase
        .from('leads')
        .select('name, phone')
        .eq('id', item.lead_id)
        .maybeSingle();

      const name = (lead as any)?.name || '고객';
      const phone = (lead as any)?.phone || '';

      // Browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(`🔔 재콜: ${name} (${phone})`, {
          body: '약속 시간입니다',
          tag: item.id,
        });
        n.onclick = () => {
          window.focus();
          onRecallDue(item.lead_id);
        };
      }

      onRecallDue(item.lead_id);
    }
  }, [callerId, onRecallDue]);

  useEffect(() => {
    if (!callerId) return;

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    checkRecalls();
    const interval = setInterval(checkRecalls, 60_000);
    return () => clearInterval(interval);
  }, [callerId, checkRecalls]);
}
