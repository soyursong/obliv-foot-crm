import { useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { getClinic } from '@/lib/clinic';
import { formatAmount } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Clinic } from '@/lib/types';

interface DailyVisit {
  date: string;
  label: string;
  total: number;
  new_patient: number;
  returning: number;
}

interface DailyRevenue {
  date: string;
  label: string;
  single: number;
  package: number;
  total: number;
}

interface StaffPerf {
  id: string;
  name: string;
  role: string;
  check_in_count: number;
  revenue: number;
}

export default function Stats() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [visits, setVisits] = useState<DailyVisit[]>([]);
  const [revenue, setRevenue] = useState<DailyRevenue[]>([]);
  const [staffPerf, setStaffPerf] = useState<StaffPerf[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getClinic().then(setClinic).catch(() => setClinic(null));
  }, []);

  useEffect(() => {
    if (!clinic) return;
    const load = async () => {
      setLoading(true);
      const today = new Date();
      const from = format(subDays(today, 13), 'yyyy-MM-dd');
      const to = format(today, 'yyyy-MM-dd');

      const [checkInsRes, paymentsRes, pkgPaymentsRes, staffRes] = await Promise.all([
        supabase
          .from('check_ins')
          .select('checked_in_at, visit_type')
          .eq('clinic_id', clinic.id)
          .gte('checked_in_at', `${from}T00:00:00+09:00`)
          .lte('checked_in_at', `${to}T23:59:59+09:00`),
        supabase
          .from('payments')
          .select('amount, payment_type, created_at')
          .eq('clinic_id', clinic.id)
          .gte('created_at', `${from}T00:00:00+09:00`)
          .lte('created_at', `${to}T23:59:59+09:00`),
        supabase
          .from('package_payments')
          .select('amount, payment_type, created_at')
          .eq('clinic_id', clinic.id)
          .gte('created_at', `${from}T00:00:00+09:00`)
          .lte('created_at', `${to}T23:59:59+09:00`),
        supabase
          .from('staff')
          .select('id, name, role')
          .eq('clinic_id', clinic.id)
          .eq('active', true),
      ]);

      const checkIns = (checkInsRes.data ?? []) as { checked_in_at: string; visit_type: string }[];
      const payments = (paymentsRes.data ?? []) as { amount: number; payment_type: string; created_at: string }[];
      const pkgPayments = (pkgPaymentsRes.data ?? []) as { amount: number; payment_type: string; created_at: string }[];
      const staffList = (staffRes.data ?? []) as { id: string; name: string; role: string }[];

      const visitMap: Record<string, { total: number; new_patient: number; returning: number }> = {};
      const revenueMap: Record<string, { single: number; package: number }> = {};

      for (let i = 0; i <= 13; i++) {
        const d = format(subDays(today, 13 - i), 'yyyy-MM-dd');
        visitMap[d] = { total: 0, new_patient: 0, returning: 0 };
        revenueMap[d] = { single: 0, package: 0 };
      }

      for (const ci of checkIns) {
        const d = ci.checked_in_at.slice(0, 10);
        if (visitMap[d]) {
          visitMap[d].total++;
          if (ci.visit_type === 'new') visitMap[d].new_patient++;
          else visitMap[d].returning++;
        }
      }

      for (const p of payments) {
        const d = p.created_at.slice(0, 10);
        if (revenueMap[d]) {
          const amt = p.payment_type === 'refund' ? -p.amount : p.amount;
          revenueMap[d].single += amt;
        }
      }
      for (const p of pkgPayments) {
        const d = p.created_at.slice(0, 10);
        if (revenueMap[d]) {
          const amt = p.payment_type === 'refund' ? -p.amount : p.amount;
          revenueMap[d].package += amt;
        }
      }

      setVisits(
        Object.entries(visitMap).map(([date, v]) => ({
          date,
          label: format(new Date(date), 'M/d(EEE)', { locale: ko }),
          ...v,
        })),
      );

      setRevenue(
        Object.entries(revenueMap).map(([date, r]) => ({
          date,
          label: format(new Date(date), 'M/d(EEE)', { locale: ko }),
          single: r.single,
          package: r.package,
          total: r.single + r.package,
        })),
      );

      const monthStart = format(today, 'yyyy-MM-01');
      const [ciMonth, payMonth, pkgMonth] = await Promise.all([
        supabase
          .from('check_ins')
          .select('consultant_id, therapist_id, technician_id')
          .eq('clinic_id', clinic.id)
          .gte('checked_in_at', `${monthStart}T00:00:00+09:00`)
          .lte('checked_in_at', `${to}T23:59:59+09:00`)
          .in('status', ['done', 'cancelled']),
        supabase
          .from('payments')
          .select('amount, payment_type, check_in_id')
          .eq('clinic_id', clinic.id)
          .gte('created_at', `${monthStart}T00:00:00+09:00`)
          .lte('created_at', `${to}T23:59:59+09:00`),
        supabase
          .from('check_ins')
          .select('id, consultant_id')
          .eq('clinic_id', clinic.id)
          .gte('checked_in_at', `${monthStart}T00:00:00+09:00`)
          .lte('checked_in_at', `${to}T23:59:59+09:00`),
      ]);

      const monthCheckIns = (ciMonth.data ?? []) as { consultant_id: string | null; therapist_id: string | null; technician_id: string | null }[];
      const monthPayments = (payMonth.data ?? []) as { amount: number; payment_type: string; check_in_id: string | null }[];
      const monthCiMap = (pkgMonth.data ?? []) as { id: string; consultant_id: string | null }[];

      const ciToConsultant: Record<string, string> = {};
      for (const ci of monthCiMap) {
        if (ci.consultant_id) ciToConsultant[ci.id] = ci.consultant_id;
      }

      const staffCounts: Record<string, number> = {};
      const staffRevenue: Record<string, number> = {};

      for (const ci of monthCheckIns) {
        for (const id of [ci.consultant_id, ci.therapist_id, ci.technician_id]) {
          if (id) staffCounts[id] = (staffCounts[id] ?? 0) + 1;
        }
      }

      for (const p of monthPayments) {
        if (!p.check_in_id) continue;
        const consultantId = ciToConsultant[p.check_in_id];
        if (consultantId) {
          const amt = p.payment_type === 'refund' ? -p.amount : p.amount;
          staffRevenue[consultantId] = (staffRevenue[consultantId] ?? 0) + amt;
        }
      }

      setStaffPerf(
        staffList.map((s) => ({
          id: s.id,
          name: s.name,
          role: s.role,
          check_in_count: staffCounts[s.id] ?? 0,
          revenue: staffRevenue[s.id] ?? 0,
        })).sort((a, b) => b.revenue - a.revenue || b.check_in_count - a.check_in_count),
      );

      setLoading(false);
    };
    load();
  }, [clinic]);

  const totals = useMemo(() => {
    const v = visits.reduce((a, b) => a + b.total, 0);
    const r = revenue.reduce((a, b) => a + b.total, 0);
    return { visits: v, revenue: r };
  }, [visits, revenue]);

  const ROLE_LABEL: Record<string, string> = {
    director: '원장',
    consultant: '상담실장',
    coordinator: '코디네이터',
    therapist: '치료사',
    technician: '관리사',
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        통계 로딩 중…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">통계 대시보드</h1>
        <span className="text-xs text-muted-foreground">최근 14일 기준</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">14일 총 방문</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.visits}건</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">14일 총 매출</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatAmount(totals.revenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">일평균 방문</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(totals.visits / 14)}건</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">일평균 매출</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatAmount(Math.round(totals.revenue / 14))}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">일별 방문 추이</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={visits}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="new_patient" name="신규" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="returning" name="재진" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="total" name="전체" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">일별 매출 추이</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={revenue}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 10000)}만`} />
                <Tooltip formatter={(v) => formatAmount(Number(v))} />
                <Legend />
                <Bar dataKey="single" name="단건 결제" fill="#3b82f6" stackId="a" />
                <Bar dataKey="package" name="패키지 결제" fill="#10b981" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">이번 달 직원별 실적</CardTitle>
        </CardHeader>
        <CardContent>
          {staffPerf.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">데이터 없음</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">이름</th>
                    <th className="pb-2 font-medium">직책</th>
                    <th className="pb-2 font-medium text-right">담당 건수</th>
                    <th className="pb-2 font-medium text-right">매출 기여</th>
                  </tr>
                </thead>
                <tbody>
                  {staffPerf.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{s.name}</td>
                      <td className="py-2 text-muted-foreground">{ROLE_LABEL[s.role] ?? s.role}</td>
                      <td className="py-2 text-right tabular-nums">{s.check_in_count}</td>
                      <td className="py-2 text-right tabular-nums font-medium">{formatAmount(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
