import React, { useEffect, useState } from 'react';
import type { CycleWeekReview } from './types';

interface CycleReviewData {
  weeks: CycleWeekReview[];
  note: string;
  rev: number;
}

interface CycleReviewProps {
  load: () => Promise<CycleReviewData>;
  save: (note: string, reviewRev: number) => Promise<{ note: string; rev: number }>;
}

export function CycleReview({ load, save }: CycleReviewProps) {
  const [data, setData] = useState<CycleReviewData | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    load()
      .then((result) => {
        if (active) {
          setData(result);
          setNote(result.note);
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <details>
      <summary>训练周期复盘</summary>
      {data && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {[
                    '训练周',
                    '计划与反馈',
                    '已确认完成 / 计划组数',
                    '平均 RPE',
                    '测评成绩与较上次变化',
                    '周总容量 / 预估 1RM',
                  ].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.weeks.map((week, index) => (
                  <tr key={week.start}>
                    <th>
                      第 {index + 1} 周 · {week.start}
                    </th>
                    <td>{week.published ? `${week.reported} / ${week.sessions} 场已反馈` : '未发布'}</td>
                    <td>
                      {week.published ? `${week.reported ? week.completed : '—'} / ${week.planned}` : '—'}
                    </td>
                    <td>{week.rpe ?? '—'}</td>
                    <td>
                      {week.tests.length
                        ? week.tests.map((test) => (
                            <div key={JSON.stringify([test.day, test.metric, test.unit])}>
                              {test.day.slice(5)} {test.metric} {test.score}
                              {test.unit}（
                              {test.delta == null
                                ? '首次记录'
                                : (test.delta > 0 ? '+' : '') + test.delta + test.unit}
                              ）
                            </div>
                          ))
                        : '无测评'}
                    </td>
                    <td>
                      {week.volumeKg != null && week.volumeKg > 0 ? (
                        <div>
                          {week.volumeKg} kg
                          {week.volumeDeltaPct != null
                            ? `（较上周 ${week.volumeDeltaPct > 0 ? '+' : ''}${week.volumeDeltaPct}%）`
                            : ''}
                          {(week.topE1rms || []).map((item) => (
                            <div key={item.exercise}>
                              {item.exercise} 1RM {item.e1rmKg} kg
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label>
            复盘结论
            <textarea
              maxLength={1200}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setMessage('');
              }}
            />
          </label>

          <button
            disabled={busy || note.trim() === data.note}
            onClick={async () => {
              setBusy(true);
              try {
                const saved = await save(note, data.rev);
                setData({ ...data, ...saved });
                setNote(saved.note);
                setMessage(saved.note ? '结论已确认，供下一周期生成草稿时参考' : '已清除结论');
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            确认复盘结论
          </button>
        </>
      )}
      {message && <output>{message}</output>}
    </details>
  );
}
