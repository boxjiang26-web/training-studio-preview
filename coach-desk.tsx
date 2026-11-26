import React, { useEffect, useRef, useState } from 'react';
import { formatPrescriptionTags } from './strength-calc';
import type { ApiClient, Student, TrainingTeam, TrainingTemplate } from './types';

function exportReport(report: any, team: string) {
  const cells = (v: unknown) => {
    let t = String(v ?? '');
    if (/^[\s]*[=+@-]/.test(t)) t = "'" + t;
    return '"' + t.replaceAll('"', '""') + '"';
  };
  const lines = [
    ['日期', '学员', '训练内容', '计划组数', '完成组数', 'RPE', '备注'],
    ...report.rows.map((r: any) => [r.day, r.name, r.exercises, r.planned, r.done, r.rpe, r.note]),
  ];
  const link = document.createElement('a');
  link.href = URL.createObjectURL(
    new Blob(['\ufeff' + lines.map((row) => row.map(cells).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    })
  );
  link.download = team + '-' + report.first + '-训练周报.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

interface CoachDeskProps {
  api: ApiClient;
  students: Student[];
  student: number;
  day: string;
  onClose: () => void;
  onPublished: (publishedIds: number[], targetDate: string) => void;
}

export function CoachDesk({ api, students, student, day, onClose, onPublished }: CoachDeskProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'team' | 'template' | 'report'>('team');
  const [data, setData] = useState<{ teams: TrainingTeam[]; templates: TrainingTemplate[] }>({
    teams: [],
    templates: [],
  });
  const [team, setTeam] = useState('');
  const [template, setTemplate] = useState('');
  const [date, setDate] = useState(day);
  const [members, setMembers] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamMembers, setEditTeamMembers] = useState<number[]>([]);
  const [editTeamOpen, setEditTeamOpen] = useState(false);
  const [editTplName, setEditTplName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [reload, setReload] = useState(0);

  const current = data.teams.find((x) => x.id === team);
  const plan = data.templates.find((x) => x.id === template);
  const who = (id: number) => students.find((s) => s.id === id)?.name || String(id);

  async function loadResources(preferTeam?: string, preferTpl?: string) {
    const result = await api('coach/resources');
    setData(result);
    setTeam((prev) => {
      const next = preferTeam ?? prev;
      return result.teams.some((t: TrainingTeam) => t.id === next) ? next : result.teams[0]?.id || '';
    });
    setTemplate((prev) => {
      const next = preferTpl ?? prev;
      return result.templates.some((t: TrainingTemplate) => t.id === next)
        ? next
        : result.templates[0]?.id || '';
    });
  }

  useEffect(() => {
    dialog.current?.showModal();
    loadResources().catch((error: Error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (current) {
      setEditTeamName(current.name);
      setEditTeamMembers(current.members);
    }
  }, [current?.id]);

  useEffect(() => {
    if (plan) {
      setEditTplName(plan.name);
    }
  }, [plan?.id]);

  useEffect(() => {
    let active = true;
    setReport(null);
    if (tab === 'report' && team && date) {
      api('coach/report?team=' + encodeURIComponent(team) + '&day=' + date)
        .then((r) => {
          if (active) setReport(r);
        })
        .catch((e: Error) => {
          if (active) setMessage(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [tab, team, date, reload]);

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

  const teamSelect = (
    <label>
      当前团队
      <select
        value={team}
        onChange={(event) => {
          setTeam(event.target.value);
          setMessage('');
        }}
      >
        {data.teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <dialog className="desk" ref={dialog} aria-label="团队工作台" onCancel={onClose}>
      <div className="deskhead">
        <h2>团队工作台</h2>
        <button className="alt" onClick={onClose}>
          关闭
        </button>
      </div>

      <nav>
        {(
          [
            ['team', '团队名单'],
            ['template', '模板与分发'],
            ['report', '训练周报'],
          ] as const
        ).map(([key, title]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setMessage('');
            }}
          >
            {title}
          </button>
        ))}
      </nav>

      {tab === 'team' && (
        <>
          <h3>建立训练团队</h3>
          <label>
            团队名称
            <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </label>
          <fieldset>
            <legend>选择学员 · {members.length} 人</legend>
            {students.map((s) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  checked={members.includes(s.id)}
                  onChange={(event) =>
                    setMembers(
                      event.target.checked ? [...members, s.id] : members.filter((id) => id !== s.id)
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </fieldset>
          <button
            disabled={busy || !name.trim() || !members.length}
            onClick={() =>
              runAction(async () => {
                const created = await api('coach/team', { name, members });
                await loadResources(created.id);
                setMembers([]);
                setName('');
                setMessage('团队已建立');
              })
            }
          >
            建立团队
          </button>

          {Boolean(current) && (
            <>
              <h3>成员名单</h3>
              {teamSelect}
              <p>{current!.members.map(who).join('、')}</p>
              <button
                type="button"
                className="alt"
                aria-expanded={editTeamOpen}
                onClick={() => {
                  setEditTeamName(current!.name);
                  setEditTeamMembers(current!.members);
                  setEditTeamOpen(!editTeamOpen);
                }}
              >
                {editTeamOpen ? '收起团队编辑' : '编辑当前团队'}
              </button>
              <button
                type="button"
                className="alt"
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    await api('coach/team/delete', { team: current!.id });
                    setEditTeamOpen(false);
                    await loadResources('');
                    setMessage('团队已删除');
                  })
                }
              >
                删除团队
              </button>

              {editTeamOpen && (
                <div className="crud-box">
                  <label>
                    新团队标题
                    <input
                      value={editTeamName}
                      maxLength={60}
                      onChange={(event) => setEditTeamName(event.target.value)}
                    />
                  </label>
                  <fieldset>
                    <legend>调整成员 · {editTeamMembers.length} 人</legend>
                    {students.map((s) => (
                      <label className="check" key={'edit-' + s.id}>
                        <input
                          type="checkbox"
                          aria-label={'调整成员 ' + s.name}
                          checked={editTeamMembers.includes(s.id)}
                          onChange={(event) =>
                            setEditTeamMembers(
                              event.target.checked
                                ? [...editTeamMembers, s.id]
                                : editTeamMembers.filter((id) => id !== s.id)
                            )
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    disabled={busy || !editTeamName.trim() || !editTeamMembers.length}
                    onClick={() =>
                      runAction(async () => {
                        await api('coach/team/update', {
                          team: current!.id,
                          name: editTeamName,
                          members: editTeamMembers,
                        });
                        await loadResources(current!.id);
                        setEditTeamOpen(false);
                        setMessage('团队已更新');
                      })
                    }
                  >
                    保存团队修改
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'template' && (
        <>
          <h3>保存训练模板</h3>
          <p>
            取自 {who(student)} 在 {day} 已保存的日计划草稿。
          </p>
          <label>
            模板名称
            <input
              value={templateName}
              maxLength={60}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </label>
          <button
            disabled={busy || !templateName.trim() || !student}
            onClick={() =>
              runAction(async () => {
                const created = await api('coach/template', { day, student, name: templateName });
                await loadResources(undefined, created.id);
                setTemplateName('');
                setMessage('模板已保存');
              })
            }
          >
            保存为模板
          </button>

          <h3>发布到团队</h3>
          {teamSelect}
          <label>
            训练模板
            <select value={template} onChange={(event) => setTemplate(event.target.value)}>
              {data.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {plan && (
            <>
              <ul>
                {plan.items.map((x, i) => {
                  const tags = formatPrescriptionTags(x);
                  return (
                    <li key={i}>
                      {x.name} · {x.sets} 组 × {x.qty} {x.unit}
                      {tags.length ? ' · ' + tags.join(' · ') : ''}
                      {x.cue ? '（' + x.cue + '）' : ''}
                    </li>
                  );
                })}
              </ul>
              <details>
                <summary>编辑或删除模板</summary>
                <div className="editor-row">
                  <label>
                    新模板标题
                    <input
                      value={editTplName}
                      maxLength={60}
                      onChange={(event) => setEditTplName(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !editTplName.trim()}
                    onClick={() =>
                      runAction(async () => {
                        await api('coach/template/update', { template: plan.id, name: editTplName });
                        await loadResources(undefined, plan.id);
                        setMessage('模板已重命名');
                      })
                    }
                  >
                    重命名模板
                  </button>
                  <button
                    type="button"
                    className="alt"
                    disabled={busy || !student}
                    onClick={() =>
                      runAction(async () => {
                        await api('coach/template/update', {
                          template: plan.id,
                          name: editTplName || plan.name,
                          student,
                          day,
                        });
                        await loadResources(undefined, plan.id);
                        setMessage('模板动作已更新为当前草稿');
                      })
                    }
                  >
                    用当前草稿覆盖
                  </button>
                  <button
                    type="button"
                    className="alt"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await api('coach/template/delete', { template: plan.id });
                        await loadResources(undefined, '');
                        setMessage('模板已删除');
                      })
                    }
                  >
                    删除模板
                  </button>
                </div>
              </details>
            </>
          )}

          <label>
            发布日期
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <p>
            {current ? `${current.name} · ${current.members.length} 名学员。` : ''}
            仅填入空白训练日，已有草稿或计划会跳过。
          </p>
          <button
            disabled={busy || !plan || !current || !date}
            onClick={() =>
              runAction(async () => {
                const res = await api('coach/distribute', { team, template, day: date });
                setMessage(
                  `已发布 ${res.published.length} 人，跳过 ${res.skipped.length} 人` +
                    (res.skipped.length ? `（${res.skipped.map(who).join('、')}）` : '')
                );
                onPublished(res.published, date);
              })
            }
          >
            确认团队发布
          </button>
        </>
      )}

      {tab === 'report' && (
        <>
          <h3>团队训练周报</h3>
          {teamSelect}
          <label>
            周内日期
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button className="alt" onClick={() => setReload((x) => x + 1)}>
            刷新周报
          </button>
          {!current && <p>先建立团队，即可查看成员的周报。</p>}
          {report && (
            <>
              <p>
                {report.first} 至 {report.last} · {current?.name}
              </p>
              <div className="metrics">
                {(
                  [
                    ['计划场次', report.planned],
                    ['已反馈场次', report.submitted],
                    ['平均 RPE', report.mean ?? '—'],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <small>{k}</small>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              {report.rows.length ? (
                <>
                  <div className="scrolltable">
                    <table>
                      <thead>
                        <tr>
                          {['日期', '学员', '动作', '完成组数', 'RPE', '备注'].map((v) => (
                            <th key={v}>{v}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((r: any) => (
                          <tr key={r.student + r.day}>
                            <td>{r.day}</td>
                            <td>{r.name}</td>
                            <td>{r.exercises}</td>
                            <td>
                              {r.done}/{r.planned}
                            </td>
                            <td>{r.rpe ?? '待反馈'}</td>
                            <td>{r.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={() => exportReport(report, current!.name)}>导出周报 CSV</button>
                </>
              ) : (
                <p>本周暂无已发布训练。</p>
              )}
            </>
          )}
        </>
      )}

      {message && <output role="status">{message}</output>}
    </dialog>
  );
}
