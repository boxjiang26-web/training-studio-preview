const surnames = ['林','周','许','陈','沈','苏','夏','顾','梁','季','宋','程','唐','陆','叶','余','赵','姜','方','谢'];
const groups = {
  '甲': ['知夏','清禾','云舒','安宁','雨晴','晚晴','映雪','晨曦','若兰','星语'],
  '乙': ['远航','明川','书言','嘉树','景行','云帆','向阳','凯文','一鸣','星野'],
  '外': ['青松','南山','松涛','长风','朝阳']
};
export function roleTag(scene, role) {
  return '（' + scene + '测试·' + ({甲:'晨练',乙:'晚练',外:'组外'}[role]) + '）';
}
export function allocator(existing) {
  const used = new Set(existing);
  return (scene, role) => {
    let index = 0;
    for (const given of groups[role]) {
      for (let offset = 0; offset < surnames.length; offset++) {
        const surname = surnames[(offset + index + ({甲:0,乙:1,外:2}[role])) % surnames.length];
        const name = surname + given + roleTag(scene, role);
        if (!used.has(name)) { used.add(name); return name; }
      }
      index++;
    }
    throw new Error('该场景的测试姓名已用完');
  };
}
export async function testRoster(base) {
  const trial = await fetch(base + '/api/trial', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if (!trial.ok) throw new Error('无法进入试验版');
  const {token} = await trial.json();
  const roster = await fetch(base + '/api/me', {headers:{'x-studio-session':token}});
  if (!roster.ok) throw new Error('无法读取试验名单');
  return allocator((await roster.json()).students.map(s => s.name));
}

