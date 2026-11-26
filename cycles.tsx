import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CycleReview } from './cycle-review';
import catalog from './catalog.json';
import type { ApiClient, CustomExercise, ExerciseItem, LoadUnit, TrainingCycle } from './types';

const BASE_MOVES = Array.from(
  new Set(['徒手深蹲', '髋部拉伸', '俯卧撑', '平板支撑', '弹力带划船', ...catalog.map((x) => x.name)])
);

function shiftDate(day: string, offsetDays: number): string {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

interface StudentWeeksProps {
  api: ApiClient;
  choose: (day: string) => void;
}

export function StudentWeeks({ api, choose }: StudentWeeksProps) {
  const [weeks, setWeeks] = useState<Array<{ goal: string; week: string; number: number }>>([]);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      api('cycle-weeks')
        .then((rows) => {
          if (live) setWeeks(rows);
        })
        .catch(() => {});

    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
    };
  }, []);

  if (!weeks.length) return null;

  return (
    <label>
      已发布周期周
      <select value="" onChange={(event) => event.target.value && choose(event.target.value)}>
        <option value="">跳转到训练周</option>
        {weeks.map((week, index) => (
          <option key={index} value={week.week}>
            {week.goal} · 第 {week.number} 周 · {week.week}
          </option>
        ))}
      </select>
    </label>
  );
}

interface CycleDeskProps {
  api: ApiClient;
  student: number;
  name?: string;
  day: string;
  customExercises?: CustomExercise[];
  close: () => void;
  onPublish: (weekStart: string) => void;
}

export function CycleDesk({
  api,
  student,
  name,
  day,
  customExercises = [],
  close,
  onPublish,
}: CycleDeskProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<TrainingCycle[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [weekIdx, setWeekIdx] = useState(0);
  const [draft, setDraft] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState(shiftDate(day, -((new Date(day).getUTCDay() + 6) % 7)));
  const [length, setLength] = useState(4);
  const [percent, setPercent] = useState(100);
  const [scaleTarget, setScaleTarget] = useState<'qty' | 'load'>('qty');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const allMoves = useMemo(
    () => Array.from(new Set([...customExercises.map((item) => item.name), ...BASE_MOVES])),
    [customExercises]
  );

  const cycle = list.find((item) => item.id === cycleId);
  const weekStart = cycle ? shiftDate(cycle.start_day, weekIdx * 7) : '';

  const callCycle = (action: string, args: Record<string, unknown> = {}) =>
    api('coach/cycle/' + action, {
      student,
      cycle: cycleId,
      idx: weekIdx,
      rev: draft?.rev || 0,
      ...args,
    });

  async function runAction(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshList(preferId = '') {
    const result = await callCycle('list');
    setList(result.cycles);
    setCycleId(preferId || result.cycles[0]?.id || '');
    setWeekIdx(0);
  }

  useEffect(() => {
    dialog.current?.showModal();
    runAction(() => refreshList());
  }, []);

  useEffect(() => {
    let live = true;
    setDraft(null);
    setDirty(false);
    if (cycleId) {
      callCycle('load')
        .then((result) => {
          if (live) setDraft(result);
        })
        .catch((error: Error) => {
          if (live) setMessage(error.message);
        });
    }
    return () => {
      live = false;
    };
  }, [cycleId, weekIdx]);

  function confirmLeave() {
    return !dirty || confirm('放弃本周未保存的修改？');
  }

  function updateDay(dayIndex: number, items: ExerciseItem[]) {
    setDraft({
      ...draft,
      days: draft.days.map((dayItems: ExerciseItem[], idx: number) => (idx === dayIndex ? items : dayItems)),
    });
    setDirty(true);
    setMessage('');
  }

  async function saveWeek(action: 'save' | 'publish') {
    const result = await callCycle(action, {
      days: draft.days,
      discardReference: draft.discardReference === true,
    });
    setDraft(result);
    setDirty(false);
    setMessage(action === 'publish' ? '本周已发布' : '周草稿已保存');
    if (action === 'publish') {
      onPublish(weekStart);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="desk"
      aria-label="多周训练周期"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && confirmLeave()) close();
      }}
    >
      <div className="deskhead">
        <h2>{name} · 多周训练周期</h2>
        <button disabled={busy} onClick={() => confirmLeave() && close()}>
          关闭
        </button>
      </div>

      <fieldset disabled={busy}>
        <legend>新建周期</legend>
        <label>
          周期目标
          <input maxLength={300} value={goal} onChange={(event) => setGoal(event.target.value)} />
        </label>
        <label>
          开始周一
          <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label>
          周期周数
          <input
            type="number"
            min={2}
            max={52}
            value={length}
            onChange={(event) => setLength(+event.target.value)}
          />
        </label>
        <button
          disabled={!goal.trim()}
          onClick={() =>
            confirmLeave() &&
            runAction(async () => {
              const created = await callCycle('create', { goal, start, weeks: length });
              await refreshList(created.id);
              setGoal('');
            })
          }
        >
          建立周期
        </button>
      </fieldset>

      {Boolean(cycle) && (
        <>
          <div className="editor-row">
            <label>
              当前周期
              <select
                disabled={busy}
                value={cycleId}
                onChange={(event) => {
                  if (confirmLeave()) {
                    setCycleId(event.target.value);
                    setWeekIdx(0);
                    setMessage('');
                  }
                }}
              >
                {list.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.goal} · {item.start_day}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="alt"
              disabled={busy}
              onClick={() => {
                if (!confirm(`确定删除周期「${cycle!.goal}」？（已发布到日历的训练计划与反馈将保留）`)) {
                  return;
                }
                runAction(async () => {
                  await callCycle('delete');
                  setDirty(false);
                  await refreshList();
                  setMessage('周期已删除');
                });
              }}
            >
              删除周期
            </button>
          </div>

          <CycleReview
            key={String(student) + cycleId}
            load={() => callCycle('review')}
            save={(note, reviewRev) => callCycle('confirm-review', { note, reviewRev })}
          />

          <label>
            编排周次
            <select
              disabled={busy}
              value={weekIdx}
              onChange={(event) => {
                if (confirmLeave()) {
                  setWeekIdx(+event.target.value);
                  setMessage('');
                }
              }}
            >
              {Array.from({ length: cycle!.weeks }, (_, index) => (
                <option key={index} value={index}>
                  第 {index + 1} 周 · {shiftDate(cycle!.start_day, 7 * index)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {draft && cycle && (
        <>
          <p>
            {weekStart} 至 {shiftDate(weekStart, 6)} ·{' '}
            {draft.published ? '已发布' : dirty ? '有未保存修改' : '周草稿'}
          </p>

          <fieldset disabled={busy || Boolean(draft.published)}>
            <legend>每日训练</legend>
            <p>
              生成时会将周期目标、上周计划与反馈、RPE 、已确认的上周期复盘和已接受的记忆发送给
              DeepSeek。
            </p>
            <button
              onClick={() => {
                if (
                  (dirty || draft.days.some((items: ExerciseItem[]) => items.length)) &&
                  !confirm('重新生成并替换本周草稿？')
                ) {
                  return;
                }
                runAction(async () => {
                  setMessage('正在生成周期周草稿…');
                  const generated = await callCycle('generate');
                  setDraft(generated);
                  setDirty(false);
                  setMessage('AI 草稿已保存，请逐日审核');
                });
              }}
            >
              AI 生成本周草稿
            </button>

            {draft.reference && (
              <details>
                <summary>本周编排依据</summary>
                <p>{draft.reference.reason}</p>
                {draft.reference.previousReview && (
                  <p>
                    上周期复盘 · {draft.reference.previousReview.goal} ·{' '}
                    {draft.reference.previousReview.note}
                  </p>
                )}
                <small>
                  {draft.reference.previousStart} 至 {draft.reference.previousEnd}
                </small>
                {!draft.reference.previous.length && <p>上周没有已发布训练。</p>}
                {draft.reference.previous.map((item: any) => (
                  <p key={item.day}>
                    {item.day} ·{' '}
                    {item.completed == null
                      ? '待反馈'
                      : `${item.completed}/${item.planned} 组 · RPE ${item.rpe}`}
                  </p>
                ))}
                {draft.reference.memories.map((memory: string, index: number) => (
                  <p key={index}>已确认记忆 · {memory}</p>
                ))}
              </details>
            )}

            {weekIdx > 0 && (
              <div className="editor-row">
                <label>
                  调整目标
                  <select
                    aria-label="调整目标"
                    value={scaleTarget}
                    onChange={(event) => setScaleTarget(event.target.value as 'qty' | 'load')}
                  >
                    <option value="qty">每组次数或时长</option>
                    <option value="load">负重负荷</option>
                  </select>
                </label>
                <label>
                  每组次数或时长比例 (%)
                  <input
                    type="number"
                    min={25}
                    max={200}
                    value={percent}
                    onChange={(event) => setPercent(+event.target.value)}
                  />
                </label>
                <button
                  onClick={() => {
                    if (
                      (dirty || draft.days.some((items: ExerciseItem[]) => items.length)) &&
                      !confirm('用上一周的安排替换本周编辑内容？')
                    ) {
                      return;
                    }
                    runAction(async () => {
                      const copied = await callCycle('copy', { percent, scaleTarget });
                      setDraft({
                        ...draft,
                        days: copied.days,
                        reference: null,
                        discardReference: true,
                      });
                      setDirty(true);
                      setMessage('已复制，可继续逐日调整');
                    });
                  }}
                >
                  复用上一周
                </button>
              </div>
            )}

            <datalist id="cycle-moves">
              {allMoves.map((move) => (
                <option key={move} value={move} />
              ))}
            </datalist>

            {draft.days.map((dayItems: ExerciseItem[], dayIndex: number) => (
              <article key={dayIndex}>
                <h3>
                  周{'一二三四五六日'[dayIndex]} · {shiftDate(weekStart, dayIndex)}
                </h3>
                {!dayItems.length && <small>休息日</small>}
                {dayItems.map((item, itemIndex) => {
                  const updateField = <K extends keyof ExerciseItem>(key: K, value: ExerciseItem[K]) =>
                    updateDay(
                      dayIndex,
                      dayItems.map((entry, idx) => (idx === itemIndex ? { ...entry, [key]: value } : entry))
                    );
                  const loadUnit: LoadUnit = item.loadUnit || (item.load != null ? 'kg' : '自重');

                  return (
                    <div key={itemIndex} className="plan-editor-item">
                      <div className="editor-row">
                        <label>
                          动作
                          <input
                            list="cycle-moves"
                            value={item.name}
                            onChange={(event) => updateField('name', event.target.value)}
                          />
                        </label>
                        <label>
                          组数
                          <input
                            type="number"
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
                        <button
                          onClick={() => updateDay(dayIndex, dayItems.filter((_, idx) => idx !== itemIndex))}
                        >
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
                              updateDay(
                                dayIndex,
                                dayItems.map((entry, idx) =>
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
                            placeholder={loadUnit === '自重' ? '—' : loadUnit}
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
                            placeholder="如 8"
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
                            placeholder="如 120"
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
                            placeholder="要点/注意事项"
                            value={item.cue ?? ''}
                            onChange={(event) => updateField('cue', event.target.value)}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() =>
                    updateDay(dayIndex, [
                      ...dayItems,
                      { name: allMoves[0], sets: 3, qty: 10, unit: '次', loadUnit: '自重' },
                    ])
                  }
                >
                  添加动作
                </button>
              </article>
            ))}

            <button onClick={() => runAction(() => saveWeek('save'))}>保存周草稿</button>
            <button onClick={() => runAction(() => saveWeek('publish'))}>确认发布本周</button>
          </fieldset>
        </>
      )}

      {message && <output>{message}</output>}
    </dialog>
  );
}
