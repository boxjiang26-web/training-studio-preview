import React from 'react';
import type { Student } from './types';

interface RosterIdentity {
  key: string;
  name: string;
  context: string;
}

interface RosterStudent extends Student, RosterIdentity {}

function parseIdentity(student: Student): RosterIdentity {
  const match = /^(.+)（([^（）]+测试·(?:晨练|晚练|组外))）$/.exec(student.name);
  if (match) {
    return { key: 'fixture:' + match[1], name: match[1], context: match[2] };
  }
  return { key: 'student:' + student.id, name: student.name, context: '' };
}

interface RosterProps {
  students: Student[];
  sid: number;
  choose: (studentId: number) => void;
  counts: Record<number, number>;
}

export function Roster({ students, sid, choose, counts }: RosterProps) {
  const groups = new Map<string, RosterStudent[]>();

  for (const student of students) {
    const id = parseIdentity(student);
    const list = groups.get(id.key) || [];
    list.push({ ...student, ...id });
    groups.set(id.key, list);
  }

  const selected = students.find((student) => student.id === sid);
  const currentGroup = selected ? groups.get(parseIdentity(selected).key) || [] : [];

  return (
    <div className="roster">
      <label>
        当前学员
        <select aria-label="当前学员" value={sid} onChange={(event) => choose(+event.target.value)}>
          {Array.from(groups.values())
            .sort((a, b) => a[0].name.localeCompare(b[0].name, 'zh-CN'))
            .map((group) => {
              const representative = group.find((item) => item.id === sid) || group[0];
              const unread = group.reduce((sum, item) => sum + (counts[item.id] || 0), 0);
              const hasDuplicateName =
                !representative.context &&
                students.filter((item) => item.name === representative.name).length > 1;

              return (
                <option key={representative.key} value={representative.id}>
                  {representative.name}
                  {hasDuplicateName ? ' · #' + representative.id : ''}
                  {unread ? ' · 未读 ' + unread : ''}
                </option>
              );
            })}
        </select>
      </label>

      {Boolean(currentGroup[0]?.context) && (
        <label>
          训练档案
          <select aria-label="训练档案" value={sid} onChange={(event) => choose(+event.target.value)}>
            {currentGroup.map((item) => (
              <option key={item.id} value={item.id}>
                {item.context}
                {counts[item.id] ? ' · 未读 ' + counts[item.id] : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
