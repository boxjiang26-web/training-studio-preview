import React, { useEffect, useRef, useState } from 'react';
import type { ApiClient, ExerciseItem, LoadUnit, Student } from './types';

function offsetDay(day: string, offset: number): string {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function getMonday(day: string): string {
  const weekdayOffset = (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return offsetDay(day, -weekdayOffset);
}

interface WeekAssistantProps {
  api: ApiClient;
  students: Student[];
  sid: number;
  day: string;
  close: () => void;
  published: (studentId: number, weekStart: string) => void;
}

export function WeekAssistant({ api, students, sid, day, close, published }: WeekAssistantProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [student, setStudent] = useState(sid);
  const [week, setWeek] = useState(getMonday(day));
  const [goal, setGoal] = useState('');
  const [draft, setDraft] = useState<any>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    setReady(false);
    setDraft(null);
    setGoal('');
    setMessage('');

    api('coach/ai/load', { student, week })
      .then((result) => {
        if (!live) return;
        setDraft(result.draft);
        setGoal(result.draft?.goal || '');
        setMoves(result.moves);
        setReady(true);
      })
      .catch((error: Error) => {
        if (live) setMessage(error.message);
      });

    return () => {
      live = false;
    };
  }, [student, week]);

  async function runAction(action: 'generate' | 'save' | 'publish') {
    setBusy(true);
    setMessage(action === 'generate' ? '正在生成周草稿…' : '');
    try {
      const result = await api('coach/ai/' + action, {
        student,
        week,
        goal,
        days: draft?.days,
        rev: draft?.rev || 0,
      });
      setDraft(result.draft);
      setGoal(result.draft.goal);
      setMessage(
        action === 'publish'
          ? '本周计划已发布'
          : action === 'save'
            ? '修改已保存'
            : '草稿已生成，请逐日审核'
      );
      if (action === 'publish') {
        published(student, week);
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function editDay(dayIndex: number, items: ExerciseItem[]) {
    setDraft({
      ...draft,
      days: draft.days.map((current: ExerciseItem[], idx: number) => (idx === dayIndex ? items : current)),
    });
    setMessage('有未保存修改');
  }

  return (
    <dialog
      className="desk"
      ref={dialog}
      onCancel={(event) => (busy ? event.preventDefault() : close())}
      aria-label="AI 周计划"
    >
      <div className="deskhead">
        <h2>AI 周计划</h2>
        <button disabled={busy} onClick={close}>
          关闭
        </button>
      </div>

      <fieldset disabled={busy}>
        <label>
          编排学员
          <select value={student} onChange={(event) => setStudent(+event.target.value)}>
            {students.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · #{item.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          训练周
          <input
            type="date"
            value={week}
            onChange={(event) => event.target.value && setWeek(getMonday(event.target.value))}
          />
        </label>

        <label style={{ display: 'grid' }}>
          训练目标
          <textarea
            maxLength={500}
            disabled={draft?.published}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>

        <small>
          生成时会按训练目标与肌群/器械从 648 条动作目录及自定义动作中智能检索候选，并结合近期负荷/RPE/预估
          1RM 发送给 DeepSeek。生成结果仅教练可见。
        </small>
        <button
          disabled={!ready || !goal.trim() || draft?.published}
          onClick={() => runAction('generate')}
        >
          {draft ? '重新生成草稿' : '生成周草稿'}
        </button>
      </fieldset>

      {message && <output role="status">{message}</output>}

      {draft && (
        <>
          <h3>{draft.published ? '已发布安排' : '待审核安排'}</h3>
          <p>{draft.reason}</p>

          <details>
            <summary>
              参考记录 · {draft.context.feedback.length} 场反馈，{draft.context.tests.length} 项测评记录，
              {draft.context.memories?.length || 0} 条已确认记忆
            </summary>
            {(draft.context.memories || []).map((note: string, index: number) => (
              <p key={index}>已确认记忆 · {note}</p>
            ))}
            {draft.context.feedback.map((item: any) => (
              <p key={item.day}>
                {item.day} · RPE {item.rpe} · {item.completed}/{item.total} 组
                {item.volumeKg ? ` · 容量 ${item.volumeKg} kg` : ''} · {item.note}
              </p>
            ))}
            {draft.context.tests.map((test: any, index: number) => (
              <p key={index}>
                {test.day} · {test.metric} {test.score} {test.unit}
              </p>
            ))}
          </details>

          <fieldset disabled={busy || draft.published}>
            {draft.days.map((items: ExerciseItem[], dayIndex: number) => (
              <article key={dayIndex}>
                <h3>
                  周{'一二三四五六日'[dayIndex]} · {offsetDay(week, dayIndex)}
                </h3>
                {!items.length && <small>休息日</small>}
                {items.map((item, itemIndex) => {
                  const updateField = <K extends keyof ExerciseItem>(key: K, value: ExerciseItem[K]) =>
                    editDay(
                      dayIndex,
                      items.map((entry, idx) => (idx === itemIndex ? { ...entry, [key]: value } : entry))
                    );
                  const loadUnit: LoadUnit = item.loadUnit || (item.load != null ? 'kg' : '自重');
                  const moveList = moves.includes(item.name) ? moves : [item.name, ...moves];

                  return (
                    <div key={itemIndex} className="plan-editor-item">
                      <div className="editor-row">
                        <label>
                          动作
                          <select
                            value={item.name}
                            onChange={(event) => updateField('name', event.target.value)}
                          >
                            {moveList.map((move) => (
                              <option key={move}>{move}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          组数
                          <input
                            type="number"
                            min="1"
                            max="30"
                            value={item.sets}
                            onChange={(event) => updateField('sets', +event.target.value)}
                          />
                        </label>
                        <label>
                          每组
                          <input
                            type="number"
                            value={item.qty}
                            onChange={(event) => updateField('qty', +event.target.value)}
                          />
                        </label>
                        <label>
                          单位
                          <select
                            value={item.unit}
                            onChange={(event) =>
                              updateField('unit', event.target.value as ExerciseItem['unit'])
                            }
                          >
                            <option>次</option>
                            <option>秒</option>
                          </select>
                        </label>
                        <button onClick={() => editDay(dayIndex, items.filter((_, idx) => idx !== itemIndex))}>
                          移除
                        </button>
                      </div>

                      <div className="editor-row strength-fields">
                        <label>
                          负荷类型
                          <select
                            aria-label="负荷类型"
                            value={loadUnit}
                            onChange={(event) => {
                              const nextUnit = event.target.value as LoadUnit;
                              editDay(
                                dayIndex,
                                items.map((entry, idx) =>
                                  idx === itemIndex
                                    ? {
                                        ...entry,
                                        loadUnit: nextUnit,
                                        load: nextUnit === '自重' ? null : entry.load ?? null,
                                      }
                                    : entry
                                )
                              );
                            }}
                          >
                            <option value="自重">自重</option>
                            <option value="kg">kg</option>
                            <option value="lb">lb</option>
                            <option value="%1RM">%1RM</option>
                          </select>
                        </label>
                        <label>
                          负荷
                          <input
                            aria-label="负荷"
                            type="number"
                            step="0.5"
                            min={0}
                            max={2000}
                            disabled={loadUnit === '自重'}
                            value={item.load ?? ''}
                            onChange={(event) =>
                              updateField('load', event.target.value === '' ? null : Number(event.target.value))
                            }
                          />
                        </label>
                        <label>
                          目标 RPE
                          <input
                            aria-label="目标 RPE"
                            type="number"
                            step="0.5"
                            min={1}
                            max={10}
                            value={item.targetRpe ?? ''}
                            onChange={(event) =>
                              updateField(
                                'targetRpe',
                                event.target.value === '' ? null : Number(event.target.value)
                              )
                            }
                          />
                        </label>
                        <label>
                          间歇(秒)
                          <input
                            aria-label="间歇(秒)"
                            type="number"
                            min={0}
                            max={1800}
                            value={item.restSec ?? ''}
                            onChange={(event) =>
                              updateField('restSec', event.target.value === '' ? null : Number(event.target.value))
                            }
                          />
                        </label>
                        <label>
                          节奏 Tempo
                          <input
                            aria-label="节奏 Tempo"
                            className="tempo-input"
                            maxLength={16}
                            placeholder="3-1-1-0"
                            value={item.tempo ?? ''}
                            onChange={(event) => updateField('tempo', event.target.value)}
                          />
                        </label>
                        <label>
                          提示备注
                          <input
                            aria-label="提示备注"
                            className="cue-input"
                            maxLength={120}
                            value={item.cue ?? ''}
                            onChange={(event) => updateField('cue', event.target.value)}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
                <button
                  disabled={items.length >= 10}
                  onClick={() =>
                    editDay(dayIndex, [
                      ...items,
                      { name: moves[0], sets: 2, qty: 8, unit: '次', loadUnit: '自重' },
                    ])
                  }
                >
                  添加动作
                </button>
              </article>
            ))}

            <button disabled={goal !== draft.goal} onClick={() => runAction('save')}>
              保存逐日修改
            </button>
            <button disabled={goal !== draft.goal} onClick={() => runAction('publish')}>
              确认发布本周计划
            </button>
          </fieldset>
        </>
      )}
    </dialog>
  );
}
