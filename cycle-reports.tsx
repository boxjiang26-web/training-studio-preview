import React, { useEffect, useState } from 'react';
import type { ApiClient, CycleReportData, TrainingCycle } from './types';

function ReportBody({ report }: { report: CycleReportData }) {
  return (
    <div className="reportbody">
      <h3>{report.goal}</h3>
      <p>
        {report.name} · {report.start} 起 · 共 {report.weeks.length} 周
      </p>
      <h4>教练复盘结论</h4>
      <p>{report.note || '教练尚未确认结论'}</p>
      {report.weeks.map((week, index) => (
        <article key={week.start}>
          <h4>
            第 {index + 1} 周 · {week.start}
          </h4>
          <p>
            {week.published
              ? `反馈 ${week.reported} / ${week.sessions} 场 · 已确认完成 ${week.reported ? week.completed : '—'} / ${week.planned} 组`
              : '计划未发布'}{' '}
            · 平均 RPE {week.rpe ?? '—'}
          </p>
          {week.volumeKg != null && week.volumeKg > 0 && (
            <p>
              周总容量 {week.volumeKg} kg
              {week.volumeDeltaPct != null
                ? `（较上周 ${week.volumeDeltaPct > 0 ? '+' : ''}${week.volumeDeltaPct}%）`
                : ''}
              {week.topE1rms?.length
                ? ' · 预估 1RM：' +
                  week.topE1rms.map((item) => `${item.exercise} ${item.e1rmKg} kg`).join('、')
                : ''}
            </p>
          )}
          {week.tests.length ? (
            week.tests.map((test) => (
              <p key={JSON.stringify([test.day, test.metric, test.unit])}>
                {test.day} · {test.metric} {test.score}
                {test.unit} ·{' '}
                {test.delta == null
                  ? '首次记录'
                  : '较上次 ' + (test.delta > 0 ? '+' : '') + test.delta + test.unit}
              </p>
            ))
          ) : (
            <small>本周无测评</small>
          )}
        </article>
      ))}
    </div>
  );
}

interface CoachReportsProps {
  api: ApiClient;
  student: number;
}

export function CoachReports({ api, student }: CoachReportsProps) {
  const [open, setOpen] = useState(false);
  const [cycles, setCycles] = useState<TrainingCycle[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [preview, setPreview] = useState<{
    report: CycleReportData;
    version: string;
    sent: boolean;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api('coach/cycle/list', { student })
      .then((result) => {
        if (!live) return;
        setCycles(result.cycles);
        setCycleId(result.cycles[0]?.id || '');
        if (!result.cycles.length) setMessage('这份档案还没有训练周期');
      })
      .catch((error: Error) => {
        if (live) setMessage(error.message);
      });
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!cycleId || !open) return;
    let live = true;
    api('coach/cycle/preview-report', { student, cycle: cycleId })
      .then((result) => {
        if (live) setPreview(result);
      })
      .catch((error: Error) => {
        if (live) setMessage(error.message);
      });
    return () => {
      live = false;
    };
  }, [cycleId, open]);

  return (
    <>
      <button
        onClick={() => {
          setOpen(!open);
          setCycleId('');
          setPreview(null);
          setMessage('');
          setCycles([]);
        }}
        disabled={busy || !student}
      >
        {open ? '收起周期报告' : '周期报告'}
      </button>

      {open && (
        <section>
          <h2>周期报告预览</h2>
          <label>
            报告周期
            <select
              disabled={busy}
              value={cycleId}
              onChange={(event) => {
                setPreview(null);
                setMessage('');
                setCycleId(event.target.value);
              }}
            >
              {cycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.start_day} · {cycle.goal}
                </option>
              ))}
            </select>
          </label>

          {preview && (
            <>
              <ReportBody report={preview.report} />
              <button
                disabled={busy || preview.sent || !preview.report.note}
                onClick={async () => {
                  setBusy(true);
                  setMessage('');
                  try {
                    setPreview(
                      await api('coach/cycle/send-report', {
                        student,
                        cycle: cycleId,
                        version: preview.version,
                      })
                    );
                  } catch (error) {
                    setMessage((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {preview.sent ? '已发送给学员' : '确认发送给学员'}
              </button>
            </>
          )}

          {message && <output>{message}</output>}
        </section>
      )}
    </>
  );
}

export function StudentReports({ api }: { api: ApiClient }) {
  const [rows, setRows] = useState<Array<{ cycle: string; report: CycleReportData }>>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    function refresh() {
      api('cycle-reports')
        .then((result) => {
          if (live) {
            setRows(result);
            setMessage('');
          }
        })
        .catch((error: Error) => {
          if (live) setMessage(error.message);
        });
    }
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return (
    <section>
      <h2>我的周期报告</h2>
      {rows.map((entry) => (
        <details key={entry.cycle}>
          <summary>
            {entry.report.goal} · {entry.report.start}
          </summary>
          <ReportBody report={entry.report} />
        </details>
      ))}
      {!rows.length && !message && <small>还没有收到教练发送的报告</small>}
      {message && <output>{message}</output>}
    </section>
  );
}
