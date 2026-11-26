import React, { useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import type { ApiClient, AssessmentRow, Student } from './types';

interface E1rmPoint {
  day: string;
  exercise: string;
  e1rmKg: number;
  volumeKg: number;
}

interface PersonalReportResponse {
  student: Student;
  start: string;
  end: string;
  totalVolumeKg?: number | null;
  sessions: Array<{
    day: string;
    total: number;
    done: number;
    rpe: number | null;
    volumeKg?: number | null;
  }>;
  scores: AssessmentRow[];
  e1rmSeries?: E1rmPoint[];
}

function buildLines(report: PersonalReportResponse): Array<[string, string]> {
  const submitted = report.sessions.filter((session) => session.rpe != null);
  const total = report.sessions.reduce((sum, session) => sum + session.total, 0);
  const done = report.sessions.reduce((sum, session) => sum + session.done, 0);

  const result: Array<[string, string]> = [
    ['个人训练报告', report.student.name],
    ['报告周期', `${report.start} 至 ${report.end}`],
    ['训练概况', `${report.sessions.length} 场计划 · ${submitted.length} 场反馈 · 完成 ${done}/${total} 组`],
    [
      '平均 RPE',
      submitted.length
        ? (submitted.reduce((sum, session) => sum + (session.rpe || 0), 0) / submitted.length).toFixed(1)
        : '暂无反馈',
    ],
  ];

  if (report.totalVolumeKg != null && report.totalVolumeKg > 0) {
    result.push(['区间总容量（吨位）', `${report.totalVolumeKg} kg`]);
  }

  result.push(['训练完成与 RPE', '完成组数 / 计划组数']);
  for (const session of report.sessions) {
    const volText = session.volumeKg != null ? ` · 容量 ${session.volumeKg} kg` : '';
    result.push([
      session.day,
      `${session.done} / ${session.total} 组 · ${session.rpe == null ? '待反馈' : 'RPE ' + session.rpe}${volText}`,
    ]);
  }
  if (!report.sessions.length) {
    result.push(['', '所选期间没有已发布训练']);
  }

  const e1rms = report.e1rmSeries || [];
  if (e1rms.length) {
    result.push(['动作预估 1RM', '按同动作比较区间内相邻两次 Epley 预估 1RM']);
    let prevPoint: E1rmPoint | null = null;
    for (const point of e1rms) {
      const delta =
        prevPoint && prevPoint.exercise === point.exercise
          ? Number((point.e1rmKg - prevPoint.e1rmKg).toFixed(1))
          : null;
      result.push([
        point.day,
        `${point.exercise} · 预估 1RM ${point.e1rmKg} kg · ${
          delta == null ? '区间首次' : '较上次 ' + (delta > 0 ? '+' : '') + delta + ' kg'
        }`,
      ]);
      prevPoint = point;
    }
  }

  result.push(['测评成绩', '按同项目、同单位比较区间内相邻两次成绩']);
  let previous: AssessmentRow | null = null;
  for (const score of report.scores) {
    const delta =
      previous && previous.metric === score.metric && previous.unit === score.unit
        ? Number((score.score - previous.score).toPrecision(10))
        : null;
    result.push([
      score.day,
      `${score.metric} · ${score.score} ${score.unit} · ${delta == null ? '区间首次' : '较上次 ' + (delta > 0 ? '+' : '') + delta}`,
    ]);
    previous = score;
  }
  if (!report.scores.length) {
    result.push(['', '所选期间没有测评成绩']);
  }

  return result;
}

function buildTrendCharts(report: PersonalReportResponse) {
  const groups = new Map<string, Array<[string, number]>>();
  for (const score of report.scores) {
    const label = `${score.metric} ${score.unit}`;
    const list = groups.get(label) || [];
    list.push([score.day, score.score]);
    groups.set(label, list);
  }

  const e1rmGroups = new Map<string, Array<[string, number]>>();
  for (const point of report.e1rmSeries || []) {
    const label = `预估 1RM · ${point.exercise} (kg)`;
    const list = e1rmGroups.get(label) || [];
    list.push([point.day, point.e1rmKg]);
    e1rmGroups.set(label, list);
  }

  const volumePoints: Array<[string, number]> = report.sessions
    .filter((s) => s.volumeKg != null && s.volumeKg > 0)
    .map((s) => [s.day, s.volumeKg as number]);

  const series: Array<[string, Array<[string, number]>, number | null]> = [
    ['完成组数占比 (%)', report.sessions.map((s) => [s.day, Math.round((100 * s.done) / s.total)]), 100],
    [
      '主观用力程度 (RPE)',
      report.sessions.filter((s) => s.rpe != null).map((s) => [s.day, s.rpe as number]),
      10,
    ],
    ...(volumePoints.length ? [['场次总容量 (kg)', volumePoints, null] as [string, Array<[string, number]>, null]] : []),
    ...Array.from(e1rmGroups, ([label, points]): [string, Array<[string, number]>, null] => [
      label,
      points,
      null,
    ]),
    ...Array.from(groups, ([label, points]): [string, Array<[string, number]>, null] => [
      label,
      points,
      null,
    ]),
  ];

  return series
    .filter(([, points]) => points.length > 0)
    .map(([label, points, cap]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 180;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#f3f6ef';
      ctx.fillRect(0, 0, 1000, 180);
      ctx.fillStyle = '#234f3f';
      ctx.font = '22px Microsoft YaHei,sans-serif';
      ctx.fillText(label, 18, 30);

      const vals = points.map((p) => p[1]);
      const lo = cap ? 0 : Math.min(...vals);
      const hi = cap || Math.max(...vals);
      const t0 = Date.parse(report.start);
      const span = Math.max(86400000, Date.parse(report.end) - t0);
      const coords = points.map(([day, val]) => [
        40 + (920 * (Date.parse(day) - t0)) / span,
        120 - (hi === lo ? 0.5 : (val - lo) / (hi - lo)) * 65,
      ]);

      ctx.strokeStyle = '#31745d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      coords.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      coords.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.font = '17px Microsoft YaHei,sans-serif';
      ctx.fillText(report.start, 18, 165);
      ctx.textAlign = 'right';
      ctx.fillText(report.end, 980, 165);
      return { label, canvas };
    });
}

function exportPdf(
  rows: Array<[string, string]>,
  report: PersonalReportResponse,
  charts: Array<{ label: string; canvas: HTMLCanvasElement }>
) {
  const doc = new jsPDF({ compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d')!;
  let y = 0;
  let page = 0;

  function startPage() {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1240, 1754);
    ctx.fillStyle = '#194c38';
    ctx.font = 'bold 42px Microsoft YaHei, sans-serif';
    ctx.fillText('练记 · 个人训练报告', 65, 90);
    ctx.font = '25px Microsoft YaHei, sans-serif';
    ctx.fillText(`${report.student.name}   ${report.start} 至 ${report.end}`, 65, 145);
    y = 225;
  }

  function flushPage() {
    if (page++) doc.addPage();
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
  }

  startPage();
  for (const chart of charts) {
    if (y + 205 > 1640) {
      flushPage();
      startPage();
    }
    ctx.drawImage(chart.canvas, 65, y, 1090, 196);
    y += 210;
  }

  for (const [k, v] of rows) {
    let line = '';
    for (const ch of `${k}    ${v}`) {
      if (ctx.measureText(line + ch).width > 1090) {
        ctx.fillText(line, 65, y);
        y += 44;
        line = '';
        if (y > 1640) {
          flushPage();
          startPage();
        }
      }
      line += ch;
    }
    ctx.fillText(line, 65, y);
    y += 58;
    if (y > 1640) {
      flushPage();
      startPage();
    }
  }

  if (y > 225 || !page) flushPage();
  doc.save(`个人训练报告-${report.student.name}-${report.end}.pdf`);
}

interface PersonalReportProps {
  api: ApiClient;
  students: Student[];
  sid: number;
  day: string;
}

export function PersonalReport({ api, students, sid, day }: PersonalReportProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestSeq = useRef(0);
  const firstDay = new Date(day + 'T12:00:00Z');
  firstDay.setUTCDate(firstDay.getUTCDate() - 29);

  const [studentId, setStudentId] = useState(sid);
  const [start, setStart] = useState(firstDay.toISOString().slice(0, 10));
  const [end, setEnd] = useState(day);
  const [report, setReport] = useState<PersonalReportResponse | null>(null);
  const [message, setMessage] = useState('');

  function clearPreview() {
    requestSeq.current += 1;
    setReport(null);
    setMessage('');
  }

  async function previewReport() {
    clearPreview();
    const seq = requestSeq.current;
    try {
      const data: PersonalReportResponse = await api(
        `coach/personal-report?student=${studentId}&start=${start}&end=${end}`
      );
      if (requestSeq.current === seq) setReport(data);
    } catch (error) {
      if (requestSeq.current === seq) setMessage((error as Error).message);
    }
  }

  const rows = report ? buildLines(report) : [];
  const charts = useMemo(() => (report ? buildTrendCharts(report) : []), [report]);

  return (
    <>
      <button
        className="alt"
        disabled={!sid}
        onClick={() => {
          clearPreview();
          setStudentId(sid);
          dialog.current?.showModal();
        }}
      >
        个人训练报告
      </button>

      <dialog ref={dialog} className="desk" aria-label="个人训练报告">
        <div className="deskhead">
          <h2>个人训练报告</h2>
          <button onClick={() => dialog.current?.close()}>关闭</button>
        </div>

        <label>
          报告学员
          <select
            value={studentId}
            onChange={(event) => {
              clearPreview();
              setStudentId(+event.target.value);
            }}
          >
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name} · #{student.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          开始日期
          <input
            type="date"
            value={start}
            onChange={(event) => {
              clearPreview();
              setStart(event.target.value);
            }}
          />
        </label>

        <label>
          结束日期
          <input
            type="date"
            value={end}
            onChange={(event) => {
              clearPreview();
              setEnd(event.target.value);
            }}
          />
        </label>

        <button disabled={!start || !end || end < start} onClick={previewReport}>
          预览报告
        </button>
        {end < start && <small>结束日期应在开始日期之后</small>}
        {message && <aside>{message}</aside>}

        {report && (
          <>
            <button onClick={() => exportPdf(rows, report, charts)}>导出 PDF</button>
            <div>
              {charts.map((chart) => (
                <img
                  key={chart.label}
                  style={{ width: '100%', display: 'block', marginTop: 8 }}
                  src={chart.canvas.toDataURL()}
                  alt={chart.label + '趋势'}
                />
              ))}
            </div>
            <table>
              <tbody>
                {rows.map(([k, v], index) => (
                  <tr key={index}>
                    <th>{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </dialog>
    </>
  );
}
