import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const STORAGE_KEY = '@studylens/quizzes_v1';
const LEGACY_KEY = '@studylens/word_cards_v1';
const OPEN_QUIZ_KEY = '@studylens/open_quiz_v1';
const STUDY_DIR = 'studylens';
const STUDY_FILE = 'quizzes.json';
const STUDY_TMP = 'quizzes.json.tmp';

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
  openQuizId: string | null;
}

interface LegacyCard {
  front?: string;
  back?: string;
  source?: string;
}

/** pas connu → connu à peu près → connu. One step at a time. */
type RecallBand = 'unknown' | 'shaky' | 'known';

function recallStep(item: QuizItem): 0 | 1 | 2 {
  if (item.repetitions <= 0) return 0;
  if (item.repetitions === 1) return 1;
  return 2;
}

function recallBand(item: QuizItem): RecallBand {
  const step = recallStep(item);
  if (step === 0) return 'unknown';
  if (step === 1) return 'shaky';
  return 'known';
}

function shuffle<T>(list: T[]): T[] {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  return next;
}

function take(list: QuizItem[], count: number): QuizItem[] {
  if (count <= 0 || list.length === 0) return [];
  return shuffle(list).slice(0, count);
}

/** Questions the person still misses or does not know solidly. */
export function needsPractice(items: QuizItem[]): number {
  return items.filter((item) => recallBand(item) !== 'known').length;
}

/**
 * A session keeps the questions they miss, and still slips in ones they
 * know so those stay revisions instead of disappearing.
 * Roughly half the cards are unknown, a quarter are shaky, a quarter are known,
 * when the quiz actually has questions in each of those groups.
 */
export function drawQuizQueue(items: QuizItem[]): QuizItem[] {
  const unknown = items.filter((item) => recallBand(item) === 'unknown');
  const shaky = items.filter((item) => recallBand(item) === 'shaky');
  const known = items.filter((item) => recallBand(item) === 'known');

  if (unknown.length > 0) {
    const review = unknown.length;
    let shakyTarget = Math.floor(review / 2);
    let knownTarget = review - shakyTarget;
    if (review % 2 === 1 && shaky.length > 0) {
      shakyTarget += 1;
      knownTarget -= 1;
    }
    const pickedShaky = take(shaky, shakyTarget);
    const shakyLeft = shaky.filter((item) => !pickedShaky.includes(item));
    const pickedKnown = take(known, knownTarget);
    const knownShort = knownTarget - pickedKnown.length;
    const extraShaky = knownShort > 0 ? take(shakyLeft, knownShort) : [];
    const shakyShort = shakyTarget - pickedShaky.length;
    const extraKnown = shakyShort > 0 ? take(
      known.filter((item) => !pickedKnown.includes(item)),
      shakyShort
    ) : [];
    return interleave(
      shuffle(unknown),
      pickedShaky.concat(extraShaky),
      pickedKnown.concat(extraKnown)
    );
  }

  if (shaky.length > 0) {
    const pickedKnown = take(known, Math.max(1, Math.round(shaky.length / 2)));
    return interleave([], shuffle(shaky), known.length === 0 ? [] : pickedKnown);
  }

  const revision = Math.max(1, Math.ceil(known.length / 4));
  return take(known, revision);
}

function interleave(
  unknown: QuizItem[],
  shaky: QuizItem[],
  known: QuizItem[]
): QuizItem[] {
  const fresh = [...unknown];
  const unsure = [...shaky];
  const familiar = [...known];
  const out: QuizItem[] = [];
  while (fresh.length > 0 || unsure.length > 0 || familiar.length > 0) {
    if (fresh.length > 0) out.push(fresh.shift() as QuizItem);
    if (fresh.length > 0) out.push(fresh.shift() as QuizItem);
    if (unsure.length > 0) out.push(unsure.shift() as QuizItem);
    else if (fresh.length > 0) out.push(fresh.shift() as QuizItem);
    if (familiar.length > 0) out.push(familiar.shift() as QuizItem);
    else if (fresh.length > 0) out.push(fresh.shift() as QuizItem);
  }
  return out;
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
  const known = items
    .filter((item) => item.repetitions > 0)
    .slice(0, 12)
    .map((item) => item.prompt)
    .join(', ');
  return [
    `Ajoute des éléments au quiz « ${quiz.title} ».`,
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
  const next = { ...item, dueAt: now };
  const step = recallStep(item);
  if (grade === 'again') {
    next.repetitions = Math.max(0, step - 1);
    next.lapses = item.lapses + 1;
    return next;
  }
  next.repetitions = Math.min(2, step + 1);
  return next;
}

function emptyData(): StudyData {
  return { quizzes: [], items: [], openQuizId: null };
}

function snapshot(data: StudyData): string {
  return JSON.stringify({
    schema: 1,
    quizzes: data.quizzes,
    items: data.items,
    openQuizId: data.openQuizId
  });
}

function isQuiz(value: unknown): value is StudyQuiz {
  if (!value || typeof value !== 'object') return false;
  const quiz = value as StudyQuiz;
  return typeof quiz.id === 'string' && typeof quiz.title === 'string';
}

function isItem(value: unknown): value is QuizItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as QuizItem;
  return (
    typeof item.id === 'string' &&
    typeof item.quizId === 'string' &&
    (item.kind === 'word' || item.kind === 'question') &&
    typeof item.prompt === 'string' &&
    typeof item.answer === 'string'
  );
}

function normalize(parsed: unknown, fallbackOpenId: string | null): StudyData | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as {
    quizzes?: unknown;
    items?: unknown;
    openQuizId?: unknown;
  };
  if (!Array.isArray(value.quizzes) && !Array.isArray(value.items)) return null;
  const openQuizId =
    typeof value.openQuizId === 'string' ? value.openQuizId : fallbackOpenId;
  return {
    quizzes: Array.isArray(value.quizzes) ? value.quizzes.filter(isQuiz) : [],
    items: Array.isArray(value.items) ? value.items.filter(isItem) : [],
    openQuizId
  };
}

function richer(fileData: StudyData | null, stored: StudyData | null): StudyData {
  if (!fileData) return stored || emptyData();
  if (!stored) return fileData;
  const fileScore = fileData.items.length * 1000 + fileData.quizzes.length;
  const storedScore = stored.items.length * 1000 + stored.quizzes.length;
  const chosen = storedScore > fileScore ? stored : fileData;
  const other = chosen === fileData ? stored : fileData;
  return { ...chosen, openQuizId: chosen.openQuizId || other.openQuizId };
}

function studyDir(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}${STUDY_DIR}/`;
}

async function readJsonFile(path: string, fallbackOpenId: string | null): Promise<StudyData | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return normalize(JSON.parse(await FileSystem.readAsStringAsync(path)), fallbackOpenId);
  } catch {
    return null;
  }
}

async function readDurableFile(fallbackOpenId: string | null): Promise<StudyData | null> {
  const dir = studyDir();
  if (!dir) return null;
  const main = await readJsonFile(`${dir}${STUDY_FILE}`, fallbackOpenId);
  if (main) return main;
  return readJsonFile(`${dir}${STUDY_TMP}`, fallbackOpenId);
}

async function writeDurableFile(payload: string): Promise<void> {
  const root = studyDir();
  if (!root) return;
  const info = await FileSystem.getInfoAsync(root);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  }
  const tmp = `${root}${STUDY_TMP}`;
  const dest = `${root}${STUDY_FILE}`;
  await FileSystem.writeAsStringAsync(tmp, payload);
  JSON.parse(await FileSystem.readAsStringAsync(tmp));
  await FileSystem.writeAsStringAsync(dest, payload);
  await FileSystem.deleteAsync(tmp, { idempotent: true });
}

async function readAsyncStore(): Promise<StudyData | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const openId = await AsyncStorage.getItem(OPEN_QUIZ_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw), openId);
  } catch {
    return null;
  }
}

async function readData(): Promise<StudyData> {
  const stored = await readAsyncStore();
  const fromFile = await readDurableFile(stored?.openQuizId || null);
  let data = richer(fromFile, stored);
  if (data.quizzes.length === 0 && data.items.length === 0) {
    data = await migrateLegacy();
  }
  if (snapshot(fromFile || emptyData()) !== snapshot(data) || snapshot(stored || emptyData()) !== snapshot(data)) {
    if (data.quizzes.length > 0 || data.items.length > 0 || data.openQuizId) {
      await saveData(data);
    }
  }
  return data;
}

async function migrateLegacy(): Promise<StudyData> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEY);
    if (!raw) return emptyData();
    const cards = JSON.parse(raw) as LegacyCard[];
    if (!Array.isArray(cards) || cards.length === 0) return emptyData();
    const bySource = new Map<string, LegacyCard[]>();
    cards.forEach((card) => {
      const title = (card.source || 'Quiz').trim() || 'Quiz';
      const group = bySource.get(title) || [];
      group.push(card);
      bySource.set(title, group);
    });
    const data: StudyData = { quizzes: [], items: [], openQuizId: null };
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
    return emptyData();
  }
}

async function saveData(data: StudyData): Promise<void> {
  const payload = snapshot(data);
  try {
    await writeDurableFile(payload);
  } catch {
    // The store below still keeps this save if the file cannot be written.
  }
  await AsyncStorage.setItem(STORAGE_KEY, payload);
  if (data.openQuizId) await AsyncStorage.setItem(OPEN_QUIZ_KEY, data.openQuizId);
  else await AsyncStorage.removeItem(OPEN_QUIZ_KEY);
}

export async function setOpenQuiz(id: string | null): Promise<void> {
  const data = await readData();
  data.openQuizId = id;
  await saveData(data);
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

export async function renameQuiz(id: string, title: string): Promise<boolean> {
  const name = title.trim();
  if (!name) return false;
  const data = await readData();
  const quiz = data.quizzes.find((item) => item.id === id);
  if (!quiz) return false;
  quiz.title = name;
  await saveData(data);
  return true;
}

export async function deleteQuiz(id: string): Promise<void> {
  const data = await readData();
  data.quizzes = data.quizzes.filter((quiz) => quiz.id !== id);
  data.items = data.items.filter((item) => item.quizId !== id);
  if (data.openQuizId === id) data.openQuizId = null;
  await saveData(data);
}

export async function deleteQuizItem(id: string): Promise<void> {
  const data = await readData();
  data.items = data.items.filter((item) => item.id !== id);
  await saveData(data);
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
