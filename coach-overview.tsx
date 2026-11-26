import React, { useEffect, useState } from 'react';
import type { ApiClient } from './types';

interface OverviewStudentRow {
  id: number;
  name: string;
  status: 'completed' | 'pending' | 'draft' | 'rest';
  rpe: number | null;
  volumeKg: number | null;
  unread: number;
  readinessScore?: number | null;
}

interface HighRpeAlert {
  id: number;
  name: string;
  day: string;
  rpe: number;
}

interface LowReadinessAlert {
  id: number;
  name: string;
  day: string;
  score: number;
  sleep: number;
  fatigue: number;
  soreness: number;
}

interface OverviewData {
  day: string;
  totalStudents: number;
  pendingToday: number;
  completedToday: number;
  highRpeAlerts: HighRpeAlert[];
  lowReadinessAlerts?: LowReadinessAlert[];
  unreadMessages: number;
  pendingMemories: number;
  rosterToday: OverviewStudentRow[];
}

const STATUS_LABEL: Record<OverviewStudentRow['status'], string> = {
  completed: '已完成',
  pending: '待练',
  draft: '草稿未发',
  rest: '未排课',
};

interface CoachOverviewProps {
  api: ApiClient;
  today: string;
  version: number;
  selectedStudentId: number;
  onSelectStudent: (studentId: number, day?: string) => void;
}

export function CoachOverview({
  api,
  today,
  version,
  selectedStudentId,
  onSelectStudent,
}: CoachOverviewProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    api('coach/overview?day=' + today)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [today, version]);

  if (!data) return null;

  const alertCount = data.highRpeAlerts.length + (data.lowReadinessAlerts?.length || 0);
  const todoCount = data.unreadMessages + data.pendingMemories;

  return (
    <section className="overview-panel" aria-label="今日总览看板">
      <div className="overview-head">
        <div>
          <h2>今日工作台总览</h2>
          <small>
            {data.day} · 活跃学员 {data.totalStudents} 人
          </small>
        </div>
        <button
          type="button"
          className="alt"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起今日明细' : '展开今日明细'}
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <small>今日待练</small>
          <strong>{data.pendingToday}</strong>
        </div>
        <div className="kpi-card kpi-good">
          <small>今日已完成</small>
          <strong>{data.completedToday}</strong>
        </div>
        <div className={`kpi-card ${alertCount > 0 ? 'kpi-warn' : ''}`}>
          <small>疲劳 / 状态预警</small>
          <strong>{alertCount}</strong>
        </div>
        <div className="kpi-card">
          <small>未读消息 / 待审记忆</small>
          <strong>
            {data.unreadMessages} / {data.pendingMemories}
          </strong>
          {todoCount === 0 && <small>全部已处理</small>}
        </div>
      </div>

      {data.highRpeAlerts.length > 0 && (
        <div className="alert-strip">
          <strong>近 7 日高 RPE 预警（≥9）：</strong>
          {data.highRpeAlerts.slice(0, 5).map((alert) => (
            <button
              type="button"
              key={`${alert.id}-${alert.day}`}
              className="alert-chip"
              onClick={() => onSelectStudent(alert.id, alert.day)}
            >
              {alert.name} · {alert.day.slice(5)} RPE {alert.rpe}
            </button>
          ))}
        </div>
      )}

      {(data.lowReadinessAlerts || []).length > 0 && (
        <div className="alert-strip readiness-strip">
          <strong>今日状态偏低预警：</strong>
          {(data.lowReadinessAlerts || []).slice(0, 5).map((alert) => (
            <button
              type="button"
              key={`r-${alert.id}-${alert.day}`}
              className="alert-chip"
              onClick={() => onSelectStudent(alert.id, alert.day)}
            >
              {alert.name} · 状态分 {alert.score}（睡 {alert.sleep} / 累 {alert.fatigue} / 酸 {alert.soreness}）
            </button>
          ))}
        </div>
      )}

      {expanded && (
        <div className="overview-roster">
          {data.rosterToday.length === 0 ? (
            <p>还没有活跃学员，请在左侧新建学员档案。</p>
          ) : (
            data.rosterToday.map((row) => (
              <button
                type="button"
                key={row.id}
                className={`overview-row status-${row.status} ${row.id === selectedStudentId ? 'is-selected' : ''}`}
                onClick={() => onSelectStudent(row.id, today)}
              >
                <span className="ov-name">{row.name}</span>
                <span className="ov-badge">{STATUS_LABEL[row.status]}</span>
                {row.rpe != null && <small>RPE {row.rpe}</small>}
                {row.volumeKg != null && <small>{row.volumeKg} kg</small>}
                {row.readinessScore != null && <small>状态 {row.readinessScore}</small>}
                {row.unread > 0 && <small className="ov-unread">未读 {row.unread}</small>}
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
