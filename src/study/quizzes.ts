import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@studylens/quizzes_v1';
const LEGACY_KEY = '@studylens/word_cards_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_MS = 10 * 60 * 1000;

export type ItemKind = 'word' | 'question';
export type QuizGrade = 'again' | 'known' | 'easy';

export interface StudyQuiz {
  id: string;
  title: string;
  createdAt: number;
}

export interface QuizItem {
  id: string;
  quizId: string;
  kind: ItemKind;
  prompt: string;
  answer: string;
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: number;
}

interface StudyData {
  quizzes: StudyQuiz[];
  items: QuizItem[];
}

interface LegacyCard {
  front?: string;
  back?: string;
  source?: string;
}

export function quizLevel(items: QuizItem[]): number {
  if (items.length === 0) return 1;
  const score = items.reduce((sum, item) => {
    const practice = Math.min(1, item.repetitions / 5);
    const spacing = Math.min(1, item.intervalDays / 21);
    const penalty = Math.min(0.45, item.lapses * 0.08);
    return sum + Math.max(0, practice * 0.45 + spacing * 0.55 - penalty);
  }, 0);
  const ratio = score / items.length;
  return Math.max(1, Math.min(10, Math.round(1 + ratio * 9)));
}

export function dueItems(items: QuizItem[], now = Date.now()): QuizItem[] {
  return items
    .filter((item) => item.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || a.repetitions - b.repetitions);
}

const QUIZ_FORMAT_RULES = [
  'Retourne uniquement les lignes, rien avant et rien après.',
  'Une ligne égale un élément, avec exactement deux barres verticales.',
  'Pas de puce, pas de numéro, pas de markdown, pas de commentaire.',
  'N\'écris pas les titres mot, terme ou sens.'
].join('\n');

export function askPrompt(
  quiz: StudyQuiz,
  items: QuizItem[],
  answerLanguage: string
): string {
  const level = quizLevel(items);
  const known = items
    .filter((item) => item.repetitions > 0)
    .slice(0, 12)
    .map((item) => item.prompt)
    .join(', ');
  return [
    `Ajoute des éléments au quiz « ${quiz.title} ».`,
    `Niveau actuel : ${level}/10. Vise un cran au-dessus.`,
    `Les sens et les réponses sont en ${answerLanguage}.`,
    known ? `Ne répète pas : ${known}.` : 'Le quiz est encore vide.',
    'Mélange des mots nouveaux et des questions.',
    'Forme exacte :',
    'mot | terme | sens',
    'question | la question | la réponse attendue',
    QUIZ_FORMAT_RULES
  ].join('\n');
}

export function pageWordQuizInstruction(answerLanguage: string): string {
  return [
    'À partir du passage qui suit, crée un quiz de vocabulaire.',
    'Choisis les mots importants à apprendre.',
    'Sur une page de Talmud, prends les mots araméens.',
    `Le sens est en ${answerLanguage}.`,
    'Forme exacte de chaque ligne :',
    'mot | terme | sens',
    'Exemple :',
    'mot | מילתא | parole',
    QUIZ_FORMAT_RULES
  ].join('\n');
}

export function pageQuestionQuizInstruction(answerLanguage: string): string {
  return [
    'À partir du passage qui suit, crée un quiz de questions sur ce texte.',
    'Chaque question doit pouvoir se répondre avec le passage.',
    `La réponse attendue est en ${answerLanguage}.`,
    'Forme exacte de chaque ligne :',
    'question | la question | la réponse attendue',
    'Exemple :',
    'question | Que relie ce passage au pardon ? | La réparation.',
    QUIZ_FORMAT_RULES
  ].join('\n');
}

export function parseQuizLines(
  text: string
): Array<{ kind: ItemKind; prompt: string; answer: string }> {
  const found: Array<{ kind: ItemKind; prompt: string; answer: string }> = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>*•]+/, '').replace(/^\d+[.)]\s+/, '').trim();
    if (!line || /^(quiz|end|fin)$/i.test(line)) continue;
    const parsed = splitQuizLine(line);
    if (!parsed || isHeader(parsed.prompt)) continue;
    const key = `${parsed.kind}:${parsed.prompt.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(parsed);
  }
  return found;
}

function splitQuizLine(
  line: string
): { kind: ItemKind; prompt: string; answer: string } | null {
  const parts = line.split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3 && isKindToken(parts[0])) {
    return cleanItem(kindFromToken(parts[0]), parts[1], parts.slice(2).join(' | '));
  }
  if (parts.length >= 2) {
    const prompt = parts[0];
    const answer = parts.slice(1).join(' | ');
    const kind: ItemKind = prompt.includes('?') || prompt.length > 42 ? 'question' : 'word';
    return cleanItem(kind, prompt, answer);
  }
  return null;
}

function cleanItem(
  kind: ItemKind,
  prompt: string,
  answer: string
): { kind: ItemKind; prompt: string; answer: string } | null {
  const left = prompt.trim();
  const right = answer.trim();
  if (!left || !right || left.length > 400 || right.length > 800) return null;
  return { kind, prompt: left, answer: right };
}

function isKindToken(value: string): boolean {
  return /^(mot|mots|word|vocab|question|questions|q)$/i.test(value.trim());
}

function kindFromToken(value: string): ItemKind {
  return /question|^q$/i.test(value.trim()) ? 'question' : 'word';
}

function isHeader(prompt: string): boolean {
  return /^(mot|terme|sens|word|question|réponse|reponse|meaning)$/i.test(prompt.trim());
}

function schedule(item: QuizItem, grade: QuizGrade, now: number): QuizItem {
  const next = { ...item };
  if (grade === 'again') {
    next.repetitions = 0;
    next.intervalDays = 0;
    next.lapses = item.lapses + 1;
    next.ease = Math.max(1.3, item.ease - 0.2);
    next.dueAt = now + AGAIN_MS;
    return next;
  }
  const first = grade === 'easy' ? 3 : 1;
  const second = grade === 'easy' ? 7 : 3;
  if (item.repetitions <= 0) next.intervalDays = first;
  else if (item.repetitions === 1) next.intervalDays = second;
  else {
    const boost = grade === 'easy' ? 1.4 : 1;
    next.intervalDays = Math.max(1, Math.round(item.intervalDays * item.ease * boost));
  }
  if (grade === 'easy') next.ease = item.ease + 0.15;
  next.repetitions = item.repetitions + 1;
  next.dueAt = now + next.intervalDays * DAY_MS;
  return next;
}

async function readData(): Promise<StudyData> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StudyData;
      return {
        quizzes: Array.isArray(parsed.quizzes) ? parsed.quizzes : [],
        items: Array.isArray(parsed.items) ? parsed.items : []
      };
    }
  } catch {
    return { quizzes: [], items: [] };
  }
  return migrateLegacy();
}

async function migrateLegacy(): Promise<StudyData> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEY);
    if (!raw) return { quizzes: [], items: [] };
    const cards = JSON.parse(raw) as LegacyCard[];
    if (!Array.isArray(cards) || cards.length === 0) return { quizzes: [], items: [] };
    const bySource = new Map<string, LegacyCard[]>();
    cards.forEach((card) => {
      const title = (card.source || 'Quiz').trim() || 'Quiz';
      const group = bySource.get(title) || [];
      group.push(card);
      bySource.set(title, group);
    });
    const data: StudyData = { quizzes: [], items: [] };
    let index = 0;
    bySource.forEach((group, title) => {
      const quizId = `quiz-legacy-${index}`;
      data.quizzes.push({ id: quizId, title, createdAt: Date.now() });
      group.forEach((card, cardIndex) => {
        if (!card.front || !card.back) return;
        data.items.push({
          id: `item-legacy-${index}-${cardIndex}`,
          quizId,
          kind: 'word',
          prompt: card.front,
          answer: card.back,
          ease: 2.5,
          intervalDays: 0,
          repetitions: 0,
          lapses: 0,
          dueAt: Date.now()
        });
      });
      index += 1;
    });
    await saveData(data);
    return data;
  } catch {
    return { quizzes: [], items: [] };
  }
}

async function saveData(data: StudyData): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function loadStudyData(): Promise<StudyData> {
  return readData();
}

export async function createQuiz(title: string): Promise<StudyQuiz> {
  const data = await readData();
  const quiz: StudyQuiz = {
    id: `quiz-${Date.now()}`,
    title: title.trim(),
    createdAt: Date.now()
  };
  data.quizzes.unshift(quiz);
  await saveData(data);
  return quiz;
}

export async function addManualItem(
  quizId: string,
  kind: ItemKind,
  prompt: string,
  answer: string
): Promise<boolean> {
  const cleaned = cleanItem(kind, prompt, answer);
  if (!cleaned) return false;
  const data = await readData();
  const existing = data.items.find(
    (item) =>
      item.quizId === quizId &&
      item.prompt.toLocaleLowerCase() === cleaned.prompt.toLocaleLowerCase()
  );
  if (existing) {
    existing.answer = cleaned.answer;
    existing.kind = cleaned.kind;
    await saveData(data);
    return true;
  }
  data.items.push({
    id: `item-${Date.now()}`,
    quizId,
    kind: cleaned.kind,
    prompt: cleaned.prompt,
    answer: cleaned.answer,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    dueAt: Date.now()
  });
  await saveData(data);
  return true;
}

export async function addLinesToQuiz(
  quizId: string,
  text: string
): Promise<{ added: number; updated: number }> {
  const incoming = parseQuizLines(text);
  const data = await readData();
  let added = 0;
  let updated = 0;
  incoming.forEach((line, index) => {
    const existing = data.items.find(
      (item) =>
        item.quizId === quizId &&
        item.prompt.toLocaleLowerCase() === line.prompt.toLocaleLowerCase()
    );
    if (existing) {
      existing.answer = line.answer;
      existing.kind = line.kind;
      updated += 1;
      return;
    }
    data.items.push({
      id: `item-${Date.now()}-${index}`,
      quizId,
      kind: line.kind,
      prompt: line.prompt,
      answer: line.answer,
      ease: 2.5,
      intervalDays: 0,
      repetitions: 0,
      lapses: 0,
      dueAt: Date.now()
    });
    added += 1;
  });
  await saveData(data);
  return { added, updated };
}

export async function gradeQuizItem(id: string, grade: QuizGrade): Promise<void> {
  const data = await readData();
  const index = data.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  data.items[index] = schedule(data.items[index], grade, Date.now());
  await saveData(data);
}
