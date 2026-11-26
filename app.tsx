import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Roster } from './roster';
import { CoachReports, StudentReports } from './cycle-reports';
import { MessageEntry, useUnread } from './messages';
import { CycleDesk, StudentWeeks } from './cycles';
import { TrainingMemory } from './training-memory';
import { WeekAssistant } from './ai-week';
import { PersonalReport } from './personal-report';
import { AssessmentPanel } from './assessment-panel';
import { CoachDesk } from './coach-desk';
import { CoachOverview } from './coach-overview';
import { RestTimer } from './rest-timer';
import { CoachReadiness, StudentReadiness } from './readiness-panel';
import { CoachCopilot } from './coach-copilot';
import { Library, lookup } from './library';
import { Calendar } from './calendar';
import {
  computeSessionMetrics,
  createInitialSetLogs,
  formatPrescriptionTags,
} from './strength-calc';
import type {
  ApiClient,
  DayState,
  ExerciseItem,
  LoadUnit,
  MeResponse,
  SetLogEntry,
  SetLogUnit,
} from './types';

let trialToken = '';

const api: ApiClient = async (path, data) => {
  const headers: Record<string, string> = {};
  if (trialToken) headers['x-studio-session'] = trialToken;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(
    '/api/' + path,
    data === undefined
      ? { headers }
      : {
          method: 'POST',
          headers,
          body: JSON.stringify(data),
        }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error);
  }
  return payload;
};

function formatLocalDate(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function App() {
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<'trial' | 'password'>('trial');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{ student: number; url: string; expires: number } | null>(null);
  const [inviteMsg, setInviteMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [renameText, setRenameText] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState(0);
  const [day, setDay] = useState(formatLocalDate());
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [dayKey, setDayKey] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(new URLSearchParams(location.search).has('library'));

  const unreadCounts = useUnread(api, me);

  async function refreshProfile(preferStudentId?: number) {
    const profile: MeResponse = await api('me');
    setMe(profile);
    if (profile.coach) {
      const targetId = preferStudentId ?? selectedStudentId;
      if (targetId && profile.students.some((s) => s.id === targetId)) {
        setSelectedStudentId(targetId);
      } else {
        setSelectedStudentId(profile.students[0]?.id || 0);
      }
    }
  }

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      const inviteParam = params.get('invite');
      const modeInfo = await api('auth/mode');
      setAuthMode(modeInfo.mode);

      if (inviteParam) {
        await api('auth/redeem', { invite: inviteParam });
        history.replaceState({}, '', '/');
        await refreshProfile();
        return;
      }

      if (modeInfo.mode === 'password') {
        if (modeInfo.authenticated) {
          await refreshProfile();
        } else {
          setMe(null);
        }
        return;
      }

      const studentParam = params.get('student');
      const auth = await api('trial', {
        student: studentParam === null ? 0 : Number(studentParam),
      });
      trialToken = auth.token;
      await refreshProfile();
    })().catch((error: Error) => {
      setMe(null);
      setErrorMsg(error.message);
    });
  }, []);

  async function runAction(fn: () => Promise<void>) {
    try {
      setErrorMsg('');
      await fn();
    } catch (error) {
      setErrorMsg((error as Error).message);
    }
  }

  const selectedStudentName = me?.students.find((s) => s.id === selectedStudentId)?.name;
  const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <header>
        <strong>练记</strong>
        <span>{me?.name || '训练工作台'}</span>
        {me?.coach && <button onClick={() => setDeskOpen(true)}>团队工作台</button>}
        {me?.coach && (
          <button className="openlib" onClick={() => setLibraryOpen(true)}>
            动作库
          </button>
        )}
        {me && !me.coach && authMode === 'trial' && <a href="/">返回教练工作台</a>}
        {me && authMode === 'password' && (
          <button
            type="button"
            className="alt"
            onClick={() =>
              runAction(async () => {
                await api('auth/logout', {});
                trialToken = '';
                setMe(null);
              })
            }
          >
            退出登录
          </button>
        )}
      </header>

      <main className={me?.coach ? 'coach-container' : 'student-container'}>
        {me?.coach && cycleOpen && (
          <CycleDesk
            api={api}
            student={selectedStudentId}
            name={selectedStudentName}
            day={day}
            customExercises={me.customExercises}
            close={() => setCycleOpen(false)}
            onPublish={(weekStart) => {
              setDay(weekStart);
              setCalendarVersion((v) => v + 1);
              setDayKey((v) => v + 1);
            }}
          />
        )}

        {me?.coach && aiOpen && (
          <WeekAssistant
            api={api}
            students={me.students}
            sid={selectedStudentId}
            day={day}
            close={() => setAiOpen(false)}
            published={(studentId, weekStart) => {
              setCalendarVersion((v) => v + 1);
              if (studentId === selectedStudentId) {
                setDay(weekStart);
                setDayKey((v) => v + 1);
              }
            }}
          />
        )}

        {me?.coach && deskOpen && (
          <CoachDesk
            api={api}
            students={me.students}
            student={selectedStudentId}
            day={day}
            onClose={() => setDeskOpen(false)}
            onPublished={(publishedIds, targetDate) => {
              setCalendarVersion((v) => v + 1);
              if (publishedIds.includes(selectedStudentId) && targetDate === day) {
                setDayKey((v) => v + 1);
              }
            }}
          />
        )}

        {errorMsg && <aside role="alert">{errorMsg}</aside>}

        {me === undefined ? (
          '加载中…'
        ) : !me ? (
          authMode === 'password' ? (
            <section className="login" aria-label="教练登录">
              <h1>练记 · 教练登录</h1>
              <p>请输入教练口令登录工作台；学员请直接打开教练发送的专属邀请链接。</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setLoginBusy(true);
                  setErrorMsg('');
                  api('auth/login', { password: loginPassword })
                    .then(async () => {
                      setLoginPassword('');
                      await refreshProfile();
                    })
                    .catch((error: Error) => setErrorMsg(error.message))
                    .finally(() => setLoginBusy(false));
                }}
              >
                <label style={{ display: 'grid' }}>
                  教练密码
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                  />
                </label>
                <button disabled={loginBusy || !loginPassword}>登录工作台</button>
              </form>
            </section>
          ) : (
            <a href="/">打开教练工作台</a>
          )
        ) : (
          <>
            <h1>{me.coach ? '训练编排' : '我的训练'}</h1>

            {me.coach ? (
              <div className="coach-shell">
                <section className="coach-sidebar">
                  <h2>学员档案</h2>
                  {totalUnread > 0 && <small>学员未读消息合计 {totalUnread} 条</small>}

                  <Roster
                    students={me.students}
                    sid={selectedStudentId}
                    choose={setSelectedStudentId}
                    counts={unreadCounts}
                  />

                  <details>
                    <summary>新建学员档案</summary>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        runAction(async () => {
                          const created = await api('students', { name: newStudentName });
                          await refreshProfile(created.id);
                          setNewStudentName('');
                        });
                      }}
                    >
                      <label>
                        新学员姓名
                        <input
                          required
                          maxLength={60}
                          value={newStudentName}
                          onChange={(event) => setNewStudentName(event.target.value)}
                        />
                      </label>
                      <button>建立档案</button>
                    </form>
                  </details>

                  <details>
                    <summary>管理学员档案</summary>
                    {selectedStudentId > 0 && (
                      <div className="editor-row">
                        <label>
                          修改学员姓名
                          <input
                            maxLength={60}
                            placeholder={selectedStudentName || ''}
                            value={renameText}
                            onChange={(event) => setRenameText(event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={!renameText.trim()}
                          onClick={() =>
                            runAction(async () => {
                              await api('coach/student/update', {
                                student: selectedStudentId,
                                name: renameText,
                              });
                              setRenameText('');
                              await refreshProfile(selectedStudentId);
                            })
                          }
                        >
                          保存改名
                        </button>
                        <button
                          type="button"
                          className="alt"
                          onClick={() =>
                            runAction(async () => {
                              await api('coach/student/archive', {
                                student: selectedStudentId,
                                archived: true,
                              });
                              setRenameText('');
                              await refreshProfile(0);
                            })
                          }
                        >
                          归档当前学员
                        </button>
                      </div>
                    )}
                    {(me.archivedStudents || []).length > 0 && (
                      <div className="archived-list">
                        <small>已归档学员（历史记录保留）</small>
                        {(me.archivedStudents || []).map((archived) => (
                          <div key={archived.id} className="editor-row">
                            <span>
                              {archived.name} · #{archived.id}
                            </span>
                            <button
                              type="button"
                              className="alt"
                              onClick={() =>
                                runAction(async () => {
                                  await api('coach/student/archive', {
                                    student: archived.id,
                                    archived: false,
                                  });
                                  await refreshProfile(archived.id);
                                })
                              }
                            >
                              恢复档案
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  <div className="profiletools">
                    <h3>沟通与查看</h3>
                    <MessageEntry
                      key={'messages-' + selectedStudentId}
                      api={api}
                      coach
                      student={selectedStudentId}
                      name={selectedStudentName}
                      count={unreadCounts[selectedStudentId]}
                    />
                    {selectedStudentId > 0 && authMode === 'trial' && (
                      <a href={`/?student=${selectedStudentId}`}>打开学员视图</a>
                    )}
                    {selectedStudentId > 0 && (
                      <details className="invite-box">
                        <summary>学员邀请与设备管理</summary>
                        <div className="editor-row">
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                setInviteMsg('');
                                const res = await api('coach/student/invite', { student: selectedStudentId });
                                setInviteInfo({
                                  student: selectedStudentId,
                                  url: location.origin + res.path,
                                  expires: res.expires,
                                });
                                setInviteMsg('已生成 7 天专属邀请链接（旧链接已自动作废）');
                              })
                            }
                          >
                            生成 7 天邀请链接
                          </button>
                          <button
                            type="button"
                            className="alt"
                            onClick={() =>
                              runAction(async () => {
                                await api('coach/student/revoke', { student: selectedStudentId });
                                setInviteInfo(null);
                                setInviteMsg('已撤销该学员邀请链接并下线全部已登录设备');
                              })
                            }
                          >
                            撤销邀请并下线设备
                          </button>
                        </div>
                        {inviteInfo && inviteInfo.student === selectedStudentId && (
                          <div className="invite-url-box">
                            <small>有效期至 {new Date(inviteInfo.expires).toLocaleString('zh-CN')}</small>
                            <input
                              aria-label="学员专属邀请链接"
                              readOnly
                              value={inviteInfo.url}
                              onFocus={(event) => event.currentTarget.select()}
                            />
                          </div>
                        )}
                        {inviteMsg && <small role="status">{inviteMsg}</small>}
                      </details>
                    )}
                  </div>

                  <div className="profiletools">
                    <h3>训练编排</h3>
                    <button disabled={!selectedStudentId} onClick={() => setAiOpen(true)}>
                      AI 辅助编排
                    </button>
                    <CoachCopilot
                      api={api}
                      student={selectedStudentId}
                      name={selectedStudentName}
                      day={day}
                      onDraftUpdated={(studentId, targetDay) => {
                        setCalendarVersion((v) => v + 1);
                        if (studentId === selectedStudentId) {
                          setDay(targetDay);
                          setDayKey((v) => v + 1);
                        }
                      }}
                    />
                    <button disabled={!selectedStudentId} onClick={() => setCycleOpen(true)}>
                      多周训练周期
                    </button>
                  </div>

                  <div className="profiletools">
                    <h3>测评与报告</h3>
                    <CoachReports key={'report-' + selectedStudentId} api={api} student={selectedStudentId} />
                    <PersonalReport api={api} students={me.students} sid={selectedStudentId} day={day} />
                    <CoachReadiness key={'readiness-' + selectedStudentId} api={api} student={selectedStudentId} day={day} />
                    <TrainingMemory
                      key={selectedStudentId}
                      api={api}
                      student={selectedStudentId}
                      name={selectedStudentName}
                    />
                    <AssessmentPanel api={api} sid={selectedStudentId} students={me.students} />
                  </div>
                </section>

                <div className="coach-workspace">
                  <CoachOverview
                    api={api}
                    today={formatLocalDate()}
                    version={calendarVersion + me.students.length}
                    selectedStudentId={selectedStudentId}
                    onSelectStudent={(id, targetDay) => {
                      setSelectedStudentId(id);
                      if (targetDay) setDay(targetDay);
                    }}
                  />

                  {!selectedStudentId && libraryOpen && (
                    <Library
                      onClose={() => setLibraryOpen(false)}
                      customExercises={me.customExercises}
                      api={api}
                      coach
                      onCustomChanged={refreshProfile}
                    />
                  )}

                  {selectedStudentId > 0 && (
                    <>
                      <Calendar
                        key={selectedStudentId}
                        api={api}
                        sid={selectedStudentId}
                        day={day}
                        version={calendarVersion}
                        coach
                        choose={setDay}
                        today={formatLocalDate()}
                      />
                      <Day
                        library={libraryOpen}
                        toggleLibrary={setLibraryOpen}
                        key={`${selectedStudentId}${day}-${dayKey}`}
                        me={me}
                        sid={selectedStudentId}
                        day={day}
                        changed={() => setCalendarVersion((v) => v + 1)}
                        refreshProfile={refreshProfile}
                      />
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                <StudentReadiness api={api} day={formatLocalDate()} />
                <StudentReports api={api} />
                <StudentWeeks api={api} choose={setDay} />
                <MessageEntry
                  api={api}
                  coach={false}
                  student={me.studentId}
                  name={me.name}
                  count={unreadCounts[me.studentId]}
                />
                <Calendar
                  key={selectedStudentId}
                  api={api}
                  sid={selectedStudentId}
                  day={day}
                  version={calendarVersion}
                  coach={false}
                  choose={setDay}
                  today={formatLocalDate()}
                />
                <Day
                  library={libraryOpen}
                  toggleLibrary={setLibraryOpen}
                  key={`${selectedStudentId}${day}-${dayKey}`}
                  me={me}
                  sid={selectedStudentId}
                  day={day}
                  changed={() => setCalendarVersion((v) => v + 1)}
                  refreshProfile={refreshProfile}
                />
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}

interface DayProps {
  me: MeResponse;
  sid: number;
  day: string;
  changed: () => void;
  library: boolean;
  toggleLibrary: (open: boolean) => void;
  refreshProfile: () => Promise<void>;
}

function Day({ me, sid, day, changed, library, toggleLibrary, refreshProfile }: DayProps) {
  const [state, setState] = useState<DayState | null>(null);
  const [items, setItems] = useState<ExerciseItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [setLogs, setSetLogs] = useState<SetLogEntry[][]>([]);
  const [note, setNote] = useState('');
  const [rpe, setRpe] = useState(5);
  const [previewName, setPreviewName] = useState('');
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [restTimer, setRestTimer] = useState<{ exerciseName: string; initialSec: number; triggerKey: number } | null>(null);

  const customExercises = me.customExercises || [];
  const customByName = useMemo(
    () => new Map(customExercises.map((item) => [item.name, item])),
    [customExercises]
  );

  const quickMoves = useMemo(
    () => Array.from(new Set([...me.moves, ...customExercises.map((item) => item.name)])),
    [me.moves, customExercises]
  );

  function draftStorageKey(planId: number) {
    return `studio-workout-draft:v1:${me.studentId}:${day}:${planId}`;
  }

  function persistLocalDraft(planId: number, nextSetLogs: SetLogEntry[][], nextRpe: number, nextNote: string) {
    if (me.coach) return;
    try {
      localStorage.setItem(
        draftStorageKey(planId),
        JSON.stringify({ setLogs: nextSetLogs, rpe: nextRpe, note: nextNote, savedAt: Date.now() })
      );
    } catch {
      // Ignore storage quota or private-mode failures.
    }
  }

  function clearLocalDraft(planId?: number) {
    if (!planId || me.coach) return;
    try {
      localStorage.removeItem(draftStorageKey(planId));
    } catch {
      // Ignore storage failures.
    }
    setRestoredDraft(false);
  }

  async function loadDay() {
    const data: DayState = await api('day?day=' + day + (me.coach ? '&student=' + sid : ''));
    setState(data);
    setItems(data.draft?.items || []);
    setDirty(false);
    setRestoredDraft(false);

    if (data.plan) {
      let initialLogs = createInitialSetLogs(data.plan.items, data.feedback?.setLogs, data.feedback?.sets);
      if (!me.coach && !data.feedback) {
        try {
          const raw = localStorage.getItem(draftStorageKey(data.plan.id));
          if (raw) {
            const saved = JSON.parse(raw);
            if (
              Array.isArray(saved.setLogs) &&
              saved.setLogs.length === data.plan.items.length &&
              saved.setLogs.every((row: unknown, idx: number) => Array.isArray(row) && row.length === data.plan!.items[idx].sets)
            ) {
              initialLogs = createInitialSetLogs(data.plan.items, saved.setLogs);
              if (Number.isInteger(saved.rpe) && saved.rpe >= 1 && saved.rpe <= 10) setRpe(saved.rpe);
              if (typeof saved.note === 'string') setNote(saved.note);
              setRestoredDraft(true);
            }
          }
        } catch {
          // Ignore corrupted local cache.
        }
      }
      setSetLogs(initialLogs);
    } else {
      setSetLogs([]);
    }
  }

  useEffect(() => {
    loadDay().catch((error: Error) => setStatusMsg(error.message));
  }, []);

  async function submitAction(route: 'draft' | 'publish' | 'feedback', payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await api(route, {
        day,
        student: me.coach ? sid : undefined,
        ...payload,
      });
      if (route === 'feedback' && state?.plan) {
        clearLocalDraft(state.plan.id);
        setRestTimer(null);
      }
      await loadDay();
      changed();
      setStatusMsg(
        route === 'feedback' ? '已提交 ' + response.id : route === 'draft' ? '已保存草稿' : '计划已发布'
      );
    } catch (error) {
      setStatusMsg((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function editItems(nextItems: ExerciseItem[]) {
    setItems(nextItems);
    setDirty(true);
    setStatusMsg('');
  }

  function updateSetLog(itemIndex: number, setIndex: number, patch: Partial<SetLogEntry>) {
    setSetLogs((prev) => {
      const next = prev.map((row, rowIndex) =>
        rowIndex === itemIndex
          ? row.map((entry, colIndex) => (colIndex === setIndex ? { ...entry, ...patch } : entry))
          : row
      );
      if (state?.plan && !state.feedback) {
        persistLocalDraft(state.plan.id, next, rpe, note);
      }
      return next;
    });
  }

  const liveMetrics = useMemo(() => {
    if (!state?.plan) return null;
    if (state.feedback?.metrics) return state.feedback.metrics;
    return computeSessionMetrics(state.plan.items, setLogs);
  }, [state, setLogs]);

  return (
    <section>
      {me.coach && library && (
        <Library
          onClose={() => toggleLibrary(false)}
          customExercises={customExercises}
          api={api}
          coach
          onCustomChanged={refreshProfile}
          onAdd={
            state
              ? (exercise) => {
                  editItems([...items, { name: exercise.name, sets: 3, qty: 10, unit: '次', loadUnit: '自重' }]);
                  toggleLibrary(false);
                }
              : undefined
          }
        />
      )}

      {previewName && (
        <Library
          initial={previewName}
          customExercises={customExercises}
          onClose={() => setPreviewName('')}
        />
      )}

      <small>{day}</small>
      {statusMsg && <p role="status">{statusMsg}</p>}

      {!state ? (
        '正在读取…'
      ) : (
        <>
          {me.coach && (
            <>
              <h2>
                日计划 ·{' '}
                {state.draft?.rev === state.plan?.rev && state.plan
                  ? '已发布'
                  : state.draft
                    ? '草稿'
                    : '待编排'}
              </h2>

              {items.map((item, index) => {
                const updateField = <K extends keyof ExerciseItem>(key: K, value: ExerciseItem[K]) => {
                  editItems(
                    items.map((entry, entryIndex) => (entryIndex === index ? { ...entry, [key]: value } : entry))
                  );
                };
                const moveOptions = quickMoves.includes(item.name) ? quickMoves : [item.name, ...quickMoves];
                const loadUnit: LoadUnit = item.loadUnit || (item.load != null ? 'kg' : '自重');

                return (
                  <article key={index} className="plan-editor-item">
                    <div className="editor-row">
                      <label>
                        动作
                        <select
                          aria-label="动作"
                          value={item.name}
                          onChange={(event) => updateField('name', event.target.value)}
                        >
                          {moveOptions.map((move) => (
                            <option key={move}>{move}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        组数
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={item.sets}
                          onChange={(event) => updateField('sets', +event.target.value)}
                        />
                      </label>
                      <label>
                        每组
                        <input
                          type="number"
                          min={1}
                          max={3600}
                          value={item.qty}
                          onChange={(event) => updateField('qty', +event.target.value)}
                        />
                      </label>
                      <label>
                        单位
                        <select
                          aria-label="单位"
                          value={item.unit}
                          onChange={(event) => updateField('unit', event.target.value as ExerciseItem['unit'])}
                        >
                          <option>次</option>
                          <option>秒</option>
                        </select>
                      </label>
                      <button className="alt" onClick={() => editItems(items.filter((_, j) => j !== index))}>
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
                            editItems(
                              items.map((entry, entryIndex) =>
                                entryIndex === index
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
                            updateField('targetRpe', event.target.value === '' ? null : Number(event.target.value))
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
                  </article>
                );
              })}

              <button
                className="alt"
                onClick={() =>
                  editItems([...items, { name: me.moves[0], sets: 3, qty: 10, unit: '次', loadUnit: '自重' }])
                }
              >
                添加动作
              </button>
              <button onClick={() => toggleLibrary(true)}>从动作库选择</button>
              <button
                disabled={busy || !dirty}
                onClick={() => submitAction('draft', { rev: state.draft?.rev || 0, items })}
              >
                保存草稿
              </button>
              <button
                disabled={busy || dirty || !state.draft || state.plan?.rev === state.draft.rev}
                onClick={() => submitAction('publish', { rev: state.draft!.rev })}
              >
                发布计划
              </button>
              <hr />
            </>
          )}

          <h2>{me.coach ? '学员执行记录' : '当日计划'}</h2>

          {!state.plan ? (
            <p>这一天还没有已发布的训练。</p>
          ) : (
            <>
              {restoredDraft && !state.feedback && !me.coach && (
                <div className="draft-restored-banner" role="status">
                  <span>已自动恢复本地暂存进度</span>
                  <button
                    type="button"
                    className="alt"
                    onClick={() => {
                      clearLocalDraft(state.plan!.id);
                      setSetLogs(createInitialSetLogs(state.plan!.items));
                      setRpe(5);
                      setNote('');
                    }}
                  >
                    清空暂存
                  </button>
                </div>
              )}

              {liveMetrics && liveMetrics.totalVolumeKg > 0 && (
                <div className="session-metrics">
                  <span>本场总容量（吨位）</span>
                  <strong>{liveMetrics.totalVolumeKg} kg</strong>
                </div>
              )}

              {state.plan.items.map((item, itemIndex) => {
                const rxTags = formatPrescriptionTags(item);
                const exMetric = liveMetrics?.exercises[itemIndex];
                const hasPreview = lookup.has(item.name) || customByName.has(item.name);

                return (
                  <article key={item.id}>
                    <div className="plan-item-head">
                      <strong>{item.name}</strong> · {item.sets} 组 × {item.qty} {item.unit}
                      {rxTags.length > 0 && <span className="rx-tags"> · {rxTags.join(' · ')}</span>}
                      {hasPreview && (
                        <button className="alt" onClick={() => setPreviewName(item.name)}>
                          查看动作示范
                        </button>
                      )}
                      {!me.coach && !state.feedback && (
                        <button
                          type="button"
                          className="alt"
                          onClick={() =>
                            setRestTimer({
                              exerciseName: item.name,
                              initialSec: item.restSec && item.restSec > 0 ? item.restSec : 90,
                              triggerKey: Date.now(),
                            })
                          }
                        >
                          组间计时 {item.restSec && item.restSec > 0 ? `${item.restSec}s` : '90s'}
                        </button>
                      )}
                    </div>
                    {item.cue && <small className="rx-cue">教练提示：{item.cue}</small>}

                    <div className="set-log-list">
                      {setLogs[itemIndex]?.map((entry, setIndex) => (
                        <div key={setIndex} className={`set-log-row ${entry.done ? 'is-done' : ''}`}>
                          <label className="check">
                            <input
                              aria-label={'第' + (setIndex + 1) + '组'}
                              type="checkbox"
                              checked={entry.done}
                              disabled={me.coach || Boolean(state.feedback)}
                              onChange={() => {
                                const nextDone = !entry.done;
                                updateSetLog(itemIndex, setIndex, { done: nextDone });
                                if (nextDone && !me.coach && item.restSec && item.restSec > 0) {
                                  setRestTimer({
                                    exerciseName: item.name,
                                    initialSec: item.restSec,
                                    triggerKey: Date.now(),
                                  });
                                }
                              }}
                            />
                            第{setIndex + 1}组
                          </label>

                          {item.unit === '次' && (
                            <div className="set-actuals">
                              {!me.coach && !state.feedback && (
                                <button
                                  type="button"
                                  className="alt step-btn"
                                  aria-label={`第${setIndex + 1}组减重`}
                                  onClick={() =>
                                    updateSetLog(itemIndex, setIndex, {
                                      weight: Math.max(0, Math.round(((entry.weight || 0) - 2.5) * 10) / 10),
                                    })
                                  }
                                >
                                  -2.5
                                </button>
                              )}
                              <input
                                aria-label={`第${setIndex + 1}组重量`}
                                className="actual-weight"
                                type="number"
                                step="0.5"
                                min={0}
                                max={2000}
                                placeholder="重量"
                                disabled={me.coach || Boolean(state.feedback)}
                                value={entry.weight ?? ''}
                                onChange={(event) =>
                                  updateSetLog(itemIndex, setIndex, {
                                    weight: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                              {!me.coach && !state.feedback && (
                                <button
                                  type="button"
                                  className="alt step-btn"
                                  aria-label={`第${setIndex + 1}组加重`}
                                  onClick={() =>
                                    updateSetLog(itemIndex, setIndex, {
                                      weight: Math.min(2000, Math.round(((entry.weight || 0) + 2.5) * 10) / 10),
                                    })
                                  }
                                >
                                  +2.5
                                </button>
                              )}
                              <select
                                aria-label={`第${setIndex + 1}组重量制式`}
                                className="actual-unit"
                                disabled={me.coach || Boolean(state.feedback)}
                                value={entry.unit}
                                onChange={(event) =>
                                  updateSetLog(itemIndex, setIndex, {
                                    unit: event.target.value as SetLogUnit,
                                  })
                                }
                              >
                                <option value="kg">kg</option>
                                <option value="lb">lb</option>
                              </select>
                              <span className="times-sep">×</span>
                              <input
                                aria-label={`第${setIndex + 1}组次数`}
                                className="actual-reps"
                                type="number"
                                min={0}
                                max={3600}
                                placeholder="次数"
                                disabled={me.coach || Boolean(state.feedback)}
                                value={entry.reps ?? ''}
                                onChange={(event) =>
                                  updateSetLog(itemIndex, setIndex, {
                                    reps: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                              <span className="reps-label">次</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {exMetric && (exMetric.volumeKg > 0 || exMetric.bestE1rmKg != null) && (
                      <small className="ex-metric">
                        本动作容量 {exMetric.volumeKg} kg
                        {exMetric.bestE1rmKg != null ? ` · 预估 1RM ${exMetric.bestE1rmKg} kg` : ''}
                      </small>
                    )}
                  </article>
                );
              })}

              {state.feedback ? (
                <output>
                  已提交 · RPE {state.feedback.rpe}
                  {state.feedback.metrics && state.feedback.metrics.totalVolumeKg > 0
                    ? ` · 总容量 ${state.feedback.metrics.totalVolumeKg} kg`
                    : ''}
                  <p>{state.feedback.note}</p>
                  <small>反馈编号 {state.feedback.id}</small>
                </output>
              ) : me.coach ? (
                <p>等待学员反馈</p>
              ) : (
                <>
                  <label>
                    整体用力程度 RPE
                    <select
                      value={rpe}
                      onChange={(event) => {
                        const nextRpe = +event.target.value;
                        setRpe(nextRpe);
                        if (state?.plan) persistLocalDraft(state.plan.id, setLogs, nextRpe, note);
                      }}
                    >
                      {Array.from({ length: 10 }, (_, index) => (
                        <option key={index}>{index + 1}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid' }}>
                    训练备注
                    <textarea
                      maxLength={1000}
                      value={note}
                      onChange={(event) => {
                        const nextNote = event.target.value;
                        setNote(nextNote);
                        if (state?.plan) persistLocalDraft(state.plan.id, setLogs, rpe, nextNote);
                      }}
                    />
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      submitAction('feedback', {
                        plan: state.plan!.id,
                        sets: setLogs.map((row) => row.map((entry) => entry.done)),
                        setLogs,
                        rpe,
                        note,
                      })
                    }
                  >
                    提交反馈
                  </button>
                </>
              )}
            </>
          )}

          {restTimer && !me.coach && !state.feedback && (
            <RestTimer
              exerciseName={restTimer.exerciseName}
              initialSec={restTimer.initialSec}
              triggerKey={restTimer.triggerKey}
              onDismiss={() => setRestTimer(null)}
            />
          )}

          {me.coach && (
            <button
              className="alt"
              onClick={() =>
                loadDay()
                  .then(() => {
                    changed();
                    setStatusMsg('记录已刷新');
                  })
                  .catch((error: Error) => setStatusMsg(error.message))
              }
              disabled={dirty}
            >
              刷新记录
            </button>
          )}
        </>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
