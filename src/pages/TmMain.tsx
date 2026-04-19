import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getSelectedClinic } from '@/lib/clinic';
import { maskPhone } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Phone, FileText, Plus, Filter } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import TmCallSheet from '@/components/tm/TmCallSheet';
import { useTmRecallAlert } from '@/components/tm/TmRecallAlert';
import { format, addDays } from 'date-fns';

interface Lead {
  id: string;
  name: string;
  phone: string;
  source: string;
  interested_treatment: string | null;
  status: string;
  assigned_at: string | null;
  assigned_to: string | null;
  clinic_id: string | null;
  customer_id: string | null;
  memo: string | null;
  created_at: string | null;
}

interface CallLog {
  lead_id: string;
  call_result: string | null;
  call_started_at: string;
  recall_at: string | null;
  recall_done: boolean | null;
}

const TYPE_ICONS: Record<string, string> = {
  recall_due: '🔴',
  new: '🟡',
  retry: '🟠',
  preventive: '🟢',
  noshow: '🔵',
};

const TYPE_LABELS: Record<string, string> = {
  recall_due: '재콜약속',
  new: '신규',
  retry: '리콜',
  preventive: '예방콜',
  noshow: '취부콜',
};

const STATUS_LABELS: Record<string, string> = {
  new: '미시도',
  no_answer: '부재',
  recall: '재콜약속',
  converted: '완료',
  closed: '완료',
  in_progress: '진행중',
};

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

export default function TmMain() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [clinicId, setClinicId] = useState('');
  const [callerId, setCallerId] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [reservationDates, setReservationDates] = useState<Record<string, string>>({});
  const [noShowCustomers, setNoShowCustomers] = useState<Set<string>>(new Set());

  // Filters
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(['recall_due', 'new', 'retry', 'preventive', 'noshow']));
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(['new', 'no_answer', 'recall', 'in_progress']));
  const [sortBy, setSortBy] = useState('priority');
  const [filterOpen, setFilterOpen] = useState(!isMobile);

  // Sheet
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [highlightLeadId, setHighlightLeadId] = useState<string | null>(null);

  // Recall alerts
  const handleRecallDue = useCallback((leadId: string) => {
    setHighlightLeadId(leadId);
  }, []);
  useTmRecallAlert({ callerId, onRecallDue: handleRecallDue });

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin'); return; }
      const clinic = await getSelectedClinic();
      if (clinic) setClinicId(clinic.id);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (profile) {
        setCallerId(profile.id);
        if (profile.role !== 'tm' && profile.role !== 'admin' && profile.role !== 'manager') {
          navigate('/admin/dashboard');
          return;
        }
      }
    })();
  }, [navigate]);

  const fetchData = useCallback(async () => {
    if (!clinicId) return;

    const { data: leadData } = await supabase
      .from('leads')
      .select('*')
      .eq('clinic_id', clinicId)
      .not('status', 'in', '(converted,closed)')
      .order('created_at', { ascending: false })
      .limit(500);
    setLeads((leadData || []) as Lead[]);

    const leadIds = (leadData || []).map((l: any) => l.id);
    if (leadIds.length > 0) {
      const { data: logData } = await supabase
        .from('tm_call_logs')
        .select('lead_id, call_result, call_started_at, recall_at, recall_done')
        .in('lead_id', leadIds)
        .order('call_started_at', { ascending: false });
      setCallLogs((logData || []) as CallLog[]);
    }

    const { data: svcData } = await supabase
      .from('services')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('active', true);
    setServices((svcData || []) as { id: string; name: string }[]);

    // Check upcoming reservations (D-1, D-2)
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    const dayAfter = format(addDays(new Date(), 2), 'yyyy-MM-dd');
    const { data: resData } = await supabase
      .from('reservations')
      .select('customer_id, reservation_date')
      .eq('clinic_id', clinicId)
      .in('reservation_date', [tomorrow, dayAfter])
      .eq('status', 'reserved');
    const resMap: Record<string, string> = {};
    (resData || []).forEach((r: any) => { if (r.customer_id) resMap[r.customer_id] = r.reservation_date; });
    setReservationDates(resMap);

    // No-show customers
    const { data: nsData } = await supabase
      .from('check_ins')
      .select('customer_id')
      .eq('clinic_id', clinicId)
      .eq('status', 'no_show');
    setNoShowCustomers(new Set((nsData || []).map((n: any) => n.customer_id).filter(Boolean)));
  }, [clinicId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Compute lead types and sort
  const logsByLead = useMemo(() => {
    const map: Record<string, CallLog[]> = {};
    callLogs.forEach(l => {
      if (!map[l.lead_id]) map[l.lead_id] = [];
      map[l.lead_id].push(l);
    });
    return map;
  }, [callLogs]);

  const getLeadType = useCallback((lead: Lead): string => {
    const logs = logsByLead[lead.id] || [];
    const hasRecallDue = logs.some(l => l.recall_at && !l.recall_done && new Date(l.recall_at) <= new Date());
    if (hasRecallDue) return 'recall_due';
    if (lead.status === 'new' && logs.length === 0) return 'new';
    const lastResult = logs[0]?.call_result;
    if (lastResult === 'no_answer' || lastResult === 'no_response' || lastResult === 'phone_off') return 'retry';
    if (lead.customer_id && reservationDates[lead.customer_id]) return 'preventive';
    if (lead.customer_id && noShowCustomers.has(lead.customer_id)) return 'noshow';
    return 'new';
  }, [logsByLead, reservationDates, noShowCustomers]);

  const sortedLeads = useMemo(() => {
    const now = Date.now();
    const weightMap: Record<string, number> = { recall_due: 0, new: 1, retry: 2, preventive: 3, noshow: 4 };

    let filtered = leads.filter(lead => {
      const type = getLeadType(lead);
      if (!typeFilter.has(type)) return false;
      const statusLabel = lead.status === 'new' ? 'new' : lead.status === 'no_answer' ? 'no_answer' : lead.status === 'recall' ? 'recall' : lead.status === 'in_progress' ? 'in_progress' : lead.status;
      if (!statusFilter.has(statusLabel) && !statusFilter.has(lead.status)) return false;
      return true;
    });

    if (sortBy === 'priority') {
      filtered.sort((a, b) => {
        const wa = weightMap[getLeadType(a)] ?? 5;
        const wb = weightMap[getLeadType(b)] ?? 5;
        if (wa !== wb) return wa - wb;
        // Recall time
        const aRecall = (logsByLead[a.id] || []).find(l => l.recall_at && !l.recall_done);
        const bRecall = (logsByLead[b.id] || []).find(l => l.recall_at && !l.recall_done);
        if (aRecall?.recall_at && bRecall?.recall_at) return new Date(aRecall.recall_at).getTime() - new Date(bRecall.recall_at).getTime();
        if (aRecall?.recall_at) return -1;
        if (bRecall?.recall_at) return 1;
        // Oldest assignment first
        return new Date(a.assigned_at || a.created_at || '').getTime() - new Date(b.assigned_at || b.created_at || '').getTime();
      });
    } else if (sortBy === 'time') {
      filtered.sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());
    } else if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }

    return filtered;
  }, [leads, typeFilter, statusFilter, sortBy, getLeadType, logsByLead]);

  const completedCount = leads.filter(l => l.status === 'converted' || l.status === 'closed').length;
  const totalAssigned = leads.length + completedCount;

  const toggleFilter = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const handleSaved = (goNext: boolean) => {
    setSheetOpen(false);
    fetchData();
    if (goNext) {
      // Find next lead after current
      const currentIdx = sortedLeads.findIndex(l => l.id === selectedLead?.id);
      const next = sortedLeads[currentIdx + 1];
      if (next) {
        setSelectedLead(next);
        setSheetOpen(true);
      }
    }
  };

  return (
    <div className="min-h-screen bg-muted/50">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">TM</h1>
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/dashboard')}>← 대시보드</Button>
        </div>
        <Button size="sm" onClick={() => navigate('/tm/register')} className="bg-accent text-accent-foreground">
          <Plus className="h-4 w-4 mr-1" /> 리드 등록
        </Button>
      </header>

      <div className="flex flex-col lg:flex-row">
        {/* Filter Panel */}
        <div className="lg:w-64 lg:min-h-[calc(100vh-57px)] lg:border-r border-border bg-card p-4">
          <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold w-full lg:hidden mb-2">
              <Filter className="h-4 w-4" /> 필터 {!filterOpen && '▼'}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4" forceMount={!isMobile ? true : undefined}>
              <div className={isMobile && !filterOpen ? 'hidden' : ''}>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">유형</h4>
                {Object.entries(TYPE_LABELS).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                    <Checkbox checked={typeFilter.has(key)} onCheckedChange={() => toggleFilter(typeFilter, key, setTypeFilter)} />
                    <span>{TYPE_ICONS[key]} {label}</span>
                  </label>
                ))}
              </div>
              <div className={isMobile && !filterOpen ? 'hidden' : ''}>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">상태</h4>
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                    <Checkbox checked={statusFilter.has(key)} onCheckedChange={() => toggleFilter(statusFilter, key, setStatusFilter)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className={isMobile && !filterOpen ? 'hidden' : ''}>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">정렬</h4>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority">우선순위순</SelectItem>
                    <SelectItem value="time">시간순</SelectItem>
                    <SelectItem value="name">이름순</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Lead List */}
        <div className="flex-1 p-4">
          <div className="space-y-2">
            {sortedLeads.map(lead => {
              const type = getLeadType(lead);
              const logs = logsByLead[lead.id] || [];
              const lastLog = logs[0];
              const isHighlighted = highlightLeadId === lead.id;

              return (
                <div
                  key={lead.id}
                  className={`bg-card border rounded-lg p-3 flex items-center gap-3 transition-colors ${isHighlighted ? 'border-red-400 bg-red-50 ring-2 ring-red-200' : 'border-border'}`}
                >
                  <span className="text-lg shrink-0">{TYPE_ICONS[type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{lead.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{TYPE_LABELS[type]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {maskPhone(lead.phone)}
                      {lead.source && <span className="ml-2">· {lead.source}</span>}
                      {lead.interested_treatment && <span className="ml-2">· {lead.interested_treatment}</span>}
                    </div>
                    {lastLog && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        최근: {RESULT_LABELS[lastLog.call_result || ''] || lastLog.call_result || '-'}
                        <span className="ml-2">· 시도 {logs.length}회</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a href={`tel:${lead.phone}`} className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-muted">
                      <Phone className="h-4 w-4 text-accent" />
                    </a>
                    <Button variant="outline" size="sm" onClick={() => { setSelectedLead(lead); setSheetOpen(true); }}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> 상세
                    </Button>
                  </div>
                </div>
              );
            })}
            {sortedLeads.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                콜 대상이 없습니다
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="mt-4 bg-card border rounded-lg px-4 py-2 text-sm text-muted-foreground flex gap-4">
            <span>오늘 배분: <strong className="text-foreground">{totalAssigned}건</strong></span>
            <span>완료: <strong className="text-foreground">{completedCount}</strong></span>
            <span>잔여: <strong className="text-foreground">{sortedLeads.length}</strong></span>
          </div>
        </div>
      </div>

      <TmCallSheet
        lead={selectedLead}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={handleSaved}
        clinicId={clinicId}
        callerId={callerId}
        services={services}
      />
    </div>
  );
}
