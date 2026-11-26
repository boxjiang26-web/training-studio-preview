import fs from 'node:fs';

export const DEFAULT_MOVES = [
  { name: '徒手深蹲', category: 'lower_strength', muscles: ['股四头肌', '臀大肌'], equipment: ['徒手'] },
  { name: '髋部拉伸', category: 'prep_recovery', muscles: ['髋屈肌', '臀部'], equipment: ['徒手'] },
  { name: '俯卧撑', category: 'upper_strength', muscles: ['胸大肌', '肱三头肌', '核心'], equipment: ['徒手'] },
  { name: '平板支撑', category: 'core', muscles: ['核心', '腹直肌'], equipment: ['徒手'] },
  { name: '弹力带划船', category: 'upper_strength', muscles: ['背阔肌', '菱形肌'], equipment: ['弹力带'] },
];

export const CATALOG = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));

const CATEGORY_HINTS = [
  {
    categories: ['lower_strength', 'power_conditioning'],
    keywords: ['下肢', '深蹲', '硬拉', '腿', '股四', '腘绳', '臀', '跳远', '纵跳', '爆发', '冲刺', '起跳', '弓步', '单腿', '小腿'],
  },
  {
    categories: ['upper_strength'],
    keywords: ['上肢', '卧推', '推举', '俯卧撑', '引体', '划船', '胸', '背', '肩', '二头', '三头', '臂', '推', '拉'],
  },
  {
    categories: ['core'],
    keywords: ['核心', '腹', '腰', '稳定', '抗旋', '平板', '死虫', '鸟狗', '躯干'],
  },
  {
    categories: ['prep_recovery', 'neck_specialty'],
    keywords: ['恢复', '拉伸', '热身', '激活', '灵活', '柔韧', '康复', '放松', '减量', '活动度', '颈', '肩袖'],
  },
  {
    categories: ['full_body_strength', 'power_conditioning'],
    keywords: ['全身', '体能', '综合', '代谢', '燃脂', '减脂', '力量', '循环', '耐力'],
  },
];

const NO_EQUIPMENT_KEYWORDS = ['无器械', '徒手', '居家', '在家', '自重', '零器械'];
const BODYWEIGHT_TAGS = ['徒手', '自重', '无器械', '无', 'bodyweight', 'none'];
const EQUIPMENT_HINTS = [
  ['杠铃', ['杠铃', 'barbell']],
  ['哑铃', ['哑铃', 'dumbbell']],
  ['壶铃', ['壶铃', 'kettlebell']],
  ['弹力带', ['弹力带', '阻力带', 'band']],
  ['绳索', ['绳索', '滑轮', '龙门架', 'cable']],
  ['单杠', ['单杠', '双杠', 'pull-up']],
  ['药球', ['药球', 'medicine']],
  ['跳箱', ['跳箱', '箱', 'box']],
  ['卧推凳', ['凳', 'bench']],
  ['泡沫轴', ['泡沫轴', '滚轴', 'roller']],
];

function normalizeCatalogRow(row) {
  return {
    id: row.id || row.name,
    name: row.name,
    en: row.en || '',
    category: row.category || 'custom',
    muscles: Array.isArray(row.muscles) ? row.muscles : [],
    equipment: Array.isArray(row.equipment) ? row.equipment : [],
    notes: row.notes || '',
    custom: Boolean(row.custom),
  };
}

function isBodyweightExercise(item) {
  if (!item.equipment.length) return true;
  const joined = item.equipment.join(' ').toLowerCase();
  return BODYWEIGHT_TAGS.some((tag) => joined.includes(tag));
}

function buildSearchText(item) {
  return [item.name, item.en, item.category, item.notes, ...item.muscles, ...item.equipment]
    .join(' ')
    .toLowerCase();
}

function extractTerms(text) {
  const lower = String(text || '').toLowerCase();
  const terms = new Set();
  for (const token of lower.split(/[\s,，。、；;！!？?/|()（）【】[\]:：]+/)) {
    if (token.length >= 2) terms.add(token);
  }
  const zhChunks = lower.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const chunk of zhChunks) {
    for (let i = 0; i <= chunk.length - 2; i += 1) {
      terms.add(chunk.slice(i, i + 2));
    }
  }
  return Array.from(terms);
}

export function getAllExercisePool(customExercises = []) {
  const seen = new Set();
  const pool = [];
  const pushItem = (raw) => {
    const item = normalizeCatalogRow(raw);
    if (!item.name || seen.has(item.name)) return;
    seen.add(item.name);
    pool.push(item);
  };

  for (const item of customExercises) pushItem({ ...item, custom: true });
  for (const item of DEFAULT_MOVES) pushItem(item);
  for (const item of CATALOG) pushItem(item);
  return pool;
}

export function selectCandidateExercises({
  goal = '',
  memories = [],
  recentExerciseNames = [],
  customExercises = [],
  limit = 68,
} = {}) {
  const pool = getAllExercisePool(customExercises);
  const queryText = [goal, ...(Array.isArray(memories) ? memories : [])].join(' ').toLowerCase();
  const terms = extractTerms(queryText);
  const recentSet = new Set(recentExerciseNames || []);
  const defaultSet = new Set(DEFAULT_MOVES.map((item) => item.name));

  const wantsNoEquipment = NO_EQUIPMENT_KEYWORDS.some((kw) => queryText.includes(kw));
  const boostedCategories = new Set();
  for (const hint of CATEGORY_HINTS) {
    if (hint.keywords.some((kw) => queryText.includes(kw))) {
      hint.categories.forEach((cat) => boostedCategories.add(cat));
    }
  }

  const wantedEquipment = [];
  for (const [, aliases] of EQUIPMENT_HINTS) {
    if (aliases.some((alias) => queryText.includes(alias))) {
      wantedEquipment.push(...aliases);
    }
  }

  const scored = pool.map((item, orderIndex) => {
    const text = buildSearchText(item);
    let score = 0;

    if (item.custom) score += 120;
    if (defaultSet.has(item.name)) score += 90;
    if (recentSet.has(item.name)) score += 75;

    if (boostedCategories.has(item.category)) score += 28;

    const eqText = item.equipment.join(' ').toLowerCase();
    if (wantsNoEquipment) {
      score += isBodyweightExercise(item) ? 45 : -30;
    }
    if (wantedEquipment.length) {
      if (wantedEquipment.some((alias) => eqText.includes(alias) || item.name.toLowerCase().includes(alias))) {
        score += 32;
      }
    }

    let termHits = 0;
    for (const term of terms) {
      if (text.includes(term)) {
        termHits += 1;
        if (item.name.toLowerCase().includes(term)) score += 14;
        else if (item.muscles.some((m) => m.toLowerCase().includes(term))) score += 10;
        else score += 6;
      }
      if (termHits >= 8) break;
    }

    return { item, score, orderIndex };
  });

  scored.sort((a, b) => b.score - a.score || a.orderIndex - b.orderIndex);

  const selected = [];
  const chosenNames = new Set();
  const addChoice = (item) => {
    if (chosenNames.has(item.name) || selected.length >= limit) return;
    chosenNames.add(item.name);
    selected.push(item);
  };

  // Reserve guaranteed diversity: top ranked + a small warm-up/recovery & core baseline if space allows.
  const mainCap = Math.max(10, limit - 6);
  for (const entry of scored) {
    if (selected.length >= mainCap) break;
    addChoice(entry.item);
  }

  for (const fallbackCategory of ['prep_recovery', 'core']) {
    let added = 0;
    for (const entry of scored) {
      if (entry.item.category !== fallbackCategory || chosenNames.has(entry.item.name)) continue;
      addChoice(entry.item);
      added += 1;
      if (added >= 3) break;
    }
  }

  for (const entry of scored) {
    if (selected.length >= limit) break;
    addChoice(entry.item);
  }

  return selected.map((item) => ({
    name: item.name,
    category: item.category,
    muscles: item.muscles.slice(0, 4),
    equipment: item.equipment.slice(0, 3),
    ...(item.custom ? { custom: true } : {}),
  }));
}

export function searchExercises({
  query = '',
  category = '',
  equipment = '',
  customExercises = [],
  limit = 20,
} = {}) {
  const pool = getAllExercisePool(customExercises);
  const tokens = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const eqLower = String(equipment || '').trim().toLowerCase();

  const matches = pool.filter((item) => {
    if (category && item.category !== category) return false;
    if (eqLower) {
      if (NO_EQUIPMENT_KEYWORDS.some((kw) => eqLower.includes(kw))) {
        if (!isBodyweightExercise(item)) return false;
      } else if (!item.equipment.join(' ').toLowerCase().includes(eqLower)) {
        return false;
      }
    }
    if (!tokens.length) return true;
    const text = buildSearchText(item);
    return tokens.every((token) => text.includes(token));
  });

  return matches.slice(0, limit).map((item) => ({
    name: item.name,
    category: item.category,
    muscles: item.muscles,
    equipment: item.equipment,
    notes: item.notes,
    custom: item.custom,
  }));
}
