import React, { useEffect, useMemo, useRef, useState } from 'react';
import catalog from './catalog.json';
import type { ApiClient, CustomExercise } from './types';

const CATEGORY_LABELS: Record<string, string> = {
  lower_strength: '下肢力量',
  upper_strength: '上肢力量',
  power_conditioning: '爆发与体能',
  prep_recovery: '准备与恢复',
  core: '核心',
  neck_specialty: '颈部专项',
  full_body_strength: '全身力量',
  custom: '自定义专项',
};

export interface LibraryExercise {
  id: string;
  name: string;
  en?: string;
  category: string;
  muscles: string[];
  equipment: string[];
  video?: string;
  poster?: string;
  notes?: string;
  custom?: boolean;
}

export const lookup = new Map<string, LibraryExercise>(
  catalog.map((row) => [row.name, row as LibraryExercise])
);

function Player({ row }: { row: LibraryExercise }) {
  const [mode, setMode] = useState<'video' | 'gif'>('video');
  const [failed, setFailed] = useState(false);

  function switchMode(next: 'video' | 'gif') {
    setFailed(false);
    setMode(next);
  }

  if (!row.video) return <p>{row.notes ? row.notes : '此动作暂无演示媒体。'}</p>;

  return (
    <>
      <div className="playbox">
        {failed ? (
          <p>
            演示暂时无法加载。
            <button onClick={() => setFailed(false)}>重试</button>
          </p>
        ) : mode === 'gif' ? (
          <img
            alt={row.name + ' 循环 GIF'}
            src={'/exercise-preview/' + row.id + '.gif'}
            onError={() => setFailed(true)}
          />
        ) : (
          <video
            controls
            autoPlay
            muted
            loop
            playsInline
            poster={row.poster}
            src={row.video}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="switcher">
        <button aria-pressed={mode === 'video'} onClick={() => switchMode('video')}>
          完整视频
        </button>
        <button aria-pressed={mode === 'gif'} onClick={() => switchMode('gif')}>
          循环 GIF · 前 5 秒
        </button>
      </div>
    </>
  );
}

interface LibraryProps {
  initial?: string;
  onClose: () => void;
  onAdd?: (exercise: LibraryExercise) => void;
  customExercises?: CustomExercise[];
  api?: ApiClient;
  coach?: boolean;
  onCustomChanged?: () => Promise<void> | void;
}

export function Library({
  initial,
  onClose,
  onAdd,
  customExercises = [],
  api,
  coach = false,
  onCustomChanged,
}: LibraryProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [term, setTerm] = useState('');
  const [group, setGroup] = useState('');
  const [videoOnly, setVideoOnly] = useState(false);
  const [page, setPage] = useState(0);

  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('lower_strength');
  const [newMuscles, setNewMuscles] = useState('');
  const [newEquipment, setNewEquipment] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const allExercises = useMemo<LibraryExercise[]>(
    () => [...customExercises, ...(catalog as LibraryExercise[])],
    [customExercises]
  );

  const byName = useMemo(() => new Map(allExercises.map((row) => [row.name, row])), [allExercises]);

  const [detail, setDetail] = useState<LibraryExercise | undefined>(
    initial ? byName.get(initial) || lookup.get(initial) : undefined
  );

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  const tokens = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = allExercises.filter(
    (row) =>
      (!group || row.category === group) &&
      (!videoOnly || Boolean(row.video)) &&
      tokens.every((token) =>
        [row.name, row.en || '', row.notes || '', ...row.muscles, ...row.equipment]
          .join(' ')
          .toLowerCase()
          .includes(token)
      )
  );

  async function createCustomExercise(event: React.FormEvent) {
    event.preventDefault();
    if (!api) return;
    setBusy(true);
    setStatusMsg('');
    try {
      const result = await api('coach/exercises', {
        name: newName,
        category: newCategory,
        muscles: newMuscles,
        equipment: newEquipment,
        notes: newNotes,
      });
      await onCustomChanged?.();
      setNewName('');
      setNewMuscles('');
      setNewEquipment('');
      setNewNotes('');
      setStatusMsg('自定义动作已创建：' + result.exercise.name);
      setDetail(result.exercise);
    } catch (error) {
      setStatusMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCustomExercise(exercise: LibraryExercise) {
    if (!api) return;
    setBusy(true);
    setStatusMsg('');
    try {
      await api('coach/exercises/delete', { id: exercise.id });
      await onCustomChanged?.();
      setDetail(undefined);
      setStatusMsg('已删除自定义动作：' + exercise.name);
    } catch (error) {
      setStatusMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="lib" onCancel={onClose} aria-label="动作资料库">
      <div className="libbar">
        <div>
          <small>{detail?.custom ? '教练自定义动作' : 'ReadyNex · 公开动作目录'}</small>
          <h2>{detail ? detail.name : '动作资料库'}</h2>
        </div>
        <button autoFocus onClick={onClose}>
          关闭
        </button>
      </div>

      {statusMsg && <output role="status">{statusMsg}</output>}

      {detail ? (
        <div className="detail">
          {detail.en && <p>{detail.en}</p>}
          <Player key={detail.id} row={detail} />
          <p>
            {[
              CATEGORY_LABELS[detail.category] || detail.category,
              detail.muscles.join('、'),
              detail.equipment.join('、'),
            ]
              .filter(Boolean)
              .join(' ／ ')}
          </p>
          {onAdd && <button onClick={() => onAdd(detail)}>加入当天计划</button>}
          {coach && detail.custom && api && (
            <button disabled={busy} className="alt" onClick={() => deleteCustomExercise(detail)}>
              删除自定义动作
            </button>
          )}
          {!initial && <button onClick={() => setDetail(undefined)}>返回动作列表</button>}
        </div>
      ) : (
        <>
          {coach && api && (
            <details className="custom-ex-box">
              <summary>新建自定义动作</summary>
              <form onSubmit={createCustomExercise} className="custom-ex-form">
                <label>
                  自定义动作名称
                  <input
                    required
                    maxLength={60}
                    placeholder="例如：箱式深蹲 / 壶铃摆荡"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </label>
                <label>
                  动作分类
                  <select value={newCategory} onChange={(event) => setNewCategory(event.target.value)}>
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  目标肌群（逗号分隔）
                  <input
                    placeholder="股四头肌、臀大肌"
                    value={newMuscles}
                    onChange={(event) => setNewMuscles(event.target.value)}
                  />
                </label>
                <label>
                  使用器械（逗号分隔）
                  <input
                    placeholder="杠铃、深蹲箱"
                    value={newEquipment}
                    onChange={(event) => setNewEquipment(event.target.value)}
                  />
                </label>
                <label style={{ display: 'grid' }}>
                  动作说明
                  <textarea
                    maxLength={300}
                    placeholder="要领或适用场景（选填）"
                    value={newNotes}
                    onChange={(event) => setNewNotes(event.target.value)}
                  />
                </label>
                <button disabled={busy || !newName.trim()}>保存自定义动作</button>
              </form>
            </details>
          )}

          <div className="libfilters">
            <label>
              搜索动作
              <input
                type="search"
                placeholder="动作、器械或肌群"
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              训练类别
              <select
                value={group}
                onChange={(event) => {
                  setGroup(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">全部类别</option>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={videoOnly}
                onChange={(event) => {
                  setVideoOnly(event.target.checked);
                  setPage(0);
                }}
              />
              有视频
            </label>
          </div>

          <p>
            {found.length} 个动作{customExercises.length ? `（含 ${customExercises.length} 个自定义动作）` : ''}
          </p>

          <div className="filmgrid">
            {found.slice(page * 12, page * 12 + 12).map((row) => (
              <button key={row.id} className="film" onClick={() => setDetail(row)}>
                <div className="cover">
                  {row.poster && (
                    <img
                      loading="lazy"
                      alt=""
                      src={row.poster}
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  )}
                  <span>{row.custom ? '★ 自定义' : row.video ? '▶ 演示' : '动作资料'}</span>
                </div>
                <div className="caption">
                  <small>{CATEGORY_LABELS[row.category] || row.category}</small>
                  <b>{row.name}</b>
                  <small>{row.muscles.join(' · ') || row.equipment.join(' · ') || '—'}</small>
                </div>
              </button>
            ))}
          </div>

          {found.length === 0 ? (
            <p>没有匹配动作，请更换关键词。</p>
          ) : (
            <nav>
              <button disabled={!page} onClick={() => setPage(page - 1)}>
                上一页
              </button>{' '}
              {page + 1} / {Math.ceil(found.length / 12)}{' '}
              <button disabled={(page + 1) * 12 >= found.length} onClick={() => setPage(page + 1)}>
                下一页
              </button>
            </nav>
          )}
        </>
      )}
    </dialog>
  );
}
