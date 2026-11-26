import React, { useEffect, useState } from 'react';
import type { ApiClient } from './types';

interface ReadinessRow {
  day: string;
  sleep: number;
  fatigue: number;
  soreness: number;
  mood: number;
  note: string;
  score: number;
  updated: string;
}

const SCORE_OPTIONS = [
  { value: 1, label: '1 · 很差' },
  { value: 2, label: '2 · 偏低' },
  { value: 3, label: '3 · 一般' },
  { value: 4, label: '4 · 良好' },
  { value: 5, label: '5 · 极佳' },
];

export function StudentReadiness({ api, day }: { api: ApiClient; day: string }) {
  const [today, setToday] = useState<ReadinessRow | null>(null);
  const [history, setHistory] = useState<ReadinessRow[]>([]);
  const [sleep, setSleep] = useState(4);
  const [fatigue, setFatigue] = useState(4);
  const [soreness, setSoreness] = useState(4);
  const [mood, setMood] = useState(4);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  async function load() {
    const res = await api('readiness?day=' + day);
    setToday(res.today);
    setHistory(res.history || []);
    if (res.today) {
      setSleep(res.today.sleep);
      setFatigue(res.today.fatigue);
      setSoreness(res.today.soreness);
      setMood(res.today.mood);
      setNote(res.today.note || '');
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, [day]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatusMsg('');
    try {
      const saved = await api('readiness', { day, sleep, fatigue, soreness, mood, note });
      setStatusMsg(
        `状态已记录 · 综合分 ${saved.score}${saved.lowAlert ? '（偏低，已提醒教练关注）' : ''}`
      );
      await load();
    } catch (error) {
      setStatusMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="readiness-section" aria-label="晨起状态打卡">
      <details>
        <summary>
          晨起状态打卡 · {today ? `今日综合分 ${today.score}` : '未打卡'}
        </summary>
        <form onSubmit={submit} className="editor-row">
          <label>
            睡眠质量
            <select value={sleep} onChange={(e) => setSleep(+e.target.value)}>
              {SCORE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            精力恢复
            <select value={fatigue} onChange={(e) => setFatigue(+e.target.value)}>
              {SCORE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            肌肉轻松度
            <select value={soreness} onChange={(e) => setSoreness(+e.target.value)}>
              {SCORE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            训练状态
            <select value={mood} onChange={(e) => setMood(+e.target.value)}>
              {SCORE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', width: '100%' }}>
            状态备注
            <input
              maxLength={300}
              placeholder="例如：昨晚熬夜、左膝略酸（选填）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button disabled={busy}>提交状态打卡</button>
        </form>
        {statusMsg && <p role="status">{statusMsg}</p>}
        {history.length > 0 && (
          <div className="readiness-history">
            <small>最近打卡记录</small>
            {history.slice(0, 5).map((item) => (
              <small key={item.day}>
                {item.day} · 综合 {item.score}（睡 {item.sleep} / 精 {item.fatigue} / 肌 {item.soreness} / 态{' '}
                {item.mood}）{item.note ? ' · ' + item.note : ''}
              </small>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}

export function CoachReadiness({ api, student, day }: { api: ApiClient; student: number; day: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ReadinessRow[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || !student) return;
    let live = true;
    setErr('');
    api(`readiness?student=${student}&day=${day}`)
      .then((res) => {
        if (live) setHistory(res.history || []);
      })
      .catch((error: Error) => {
        if (live) setErr(error.message);
      });
    return () => {
      live = false;
    };
  }, [open, student, day]);

  return (
    <>
      <button type="button" className="alt" disabled={!student} onClick={() => setOpen(!open)}>
        {open ? '收起状态监控' : '状态监控'}
      </button>
      {open && (
        <div className="readiness-coach-box">
          {err ? (
            <aside>{err}</aside>
          ) : history.length === 0 ? (
            <small>这名学员还没有晨起状态记录。</small>
          ) : (
            history.slice(0, 7).map((item) => (
              <small key={item.day}>
                {item.day} · 综合 {item.score}（睡 {item.sleep} / 精 {item.fatigue} / 肌 {item.soreness} / 态{' '}
                {item.mood}）{item.note ? ' · ' + item.note : ''}
              </small>
            ))
          )}
        </div>
      )}
    </>
  );
}
