import * as FileSystem from 'expo-file-system';
import { CapturedPhoto, RoiBox } from '../types';
import { debugError, debugLog } from '../debug/debugLog';
import { PagePaste } from '../clipboardPage';

export type SessionPhase = 'home' | 'capture' | 'prompt' | 'browser' | 'quiz' | 'fiches';

export type QuizPlace = {
  pane: 'list' | 'detail' | 'play';
  quizId: string | null;
  queueIds: string[];
  revealed: boolean;
  playReturn: 'list' | 'detail';
};

export type FichePlace = {
  pane: 'list' | 'edit' | 'recall';
  editingId: string | null;
  draft: string;
  deckIds: string[];
  place: number;
};

export type SessionBrowser = {
  url: string;
  title: string;
  returnTo: 'prompt' | 'settings';
  copied: boolean;
  paste: PagePaste | 'text';
};

export type AppSession = {
  phase: SessionPhase;
  photo: CapturedPhoto | null;
  originalPhoto: CapturedPhoto | null;
  isPhotoCleaned: boolean;
  rois: RoiBox[];
  ocrText: string;
  pageSource: 'ocr' | 'image';
  selectedTask: string;
  taskText: string;
  taskCustom: boolean;
  selectedLinkId: string;
  browser: SessionBrowser | null;
  screenUnderBrowser: 'capture' | 'prompt' | 'quiz';
  resumeQuizEdit: boolean;
  settingsVisible: boolean;
  quiz: QuizPlace;
  fiche: FichePlace;
};

const FILE_NAME = 'session.json';

function sessionDir(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}studylens/session/`;
}

async function ensureDir(): Promise<string | null> {
  const dir = sessionDir();
  if (!dir) return null;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

const retained = new Map<string, string>();

async function retain(uri: string | undefined, name: string): Promise<string | undefined> {
  if (!uri || uri.startsWith('data:')) return undefined;
  const dir = await ensureDir();
  if (!dir) return undefined;
  const dest = `${dir}${name}`;
  if (uri === dest) return dest;
  const known = retained.get(`${name}:${uri}`);
  if (known) {
    const info = await FileSystem.getInfoAsync(known);
    if (info.exists) return known;
  }
  try {
    await FileSystem.copyAsync({ from: uri, to: dest });
    retained.set(`${name}:${uri}`, dest);
    return dest;
  } catch (err) {
    await debugError('session', err, `could not keep ${name}`);
    return uri.startsWith('file://') ? uri : undefined;
  }
}

function asPhase(value: unknown): SessionPhase {
  if (
    value === 'home' ||
    value === 'capture' ||
    value === 'prompt' ||
    value === 'browser' ||
    value === 'quiz' ||
    value === 'fiches'
  ) {
    return value;
  }
  return 'home';
}

function asPhoto(value: unknown): CapturedPhoto | null {
  if (!value || typeof value !== 'object') return null;
  const photo = value as CapturedPhoto;
  if (typeof photo.uri !== 'string' || !photo.uri) return null;
  return {
    uri: photo.uri,
    width: typeof photo.width === 'number' ? photo.width : 1000,
    height: typeof photo.height === 'number' ? photo.height : 1300
  };
}

async function fileStillThere(uri: string | undefined): Promise<boolean> {
  if (!uri) return false;
  if (!uri.startsWith('file://')) return true;
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists;
}

let chain: Promise<void> = Promise.resolve();

export function saveAppSession(session: AppSession): Promise<void> {
  chain = chain.then(() => writeSession(session)).catch((err) => {
    void debugError('session', err, 'save failed');
  });
  return chain;
}

async function writeSession(session: AppSession): Promise<void> {
  const dir = await ensureDir();
  if (!dir) return;
  const photo = session.photo
    ? {
        uri: (await retain(session.photo.uri, 'photo.jpg')) || session.photo.uri,
        width: session.photo.width,
        height: session.photo.height
      }
    : null;
  const originalPhoto = session.originalPhoto
    ? {
        uri: (await retain(session.originalPhoto.uri, 'original.jpg')) || session.originalPhoto.uri,
        width: session.originalPhoto.width,
        height: session.originalPhoto.height
      }
    : null;
  const rois: RoiBox[] = [];
  for (let index = 0; index < session.rois.length; index += 1) {
    const roi = session.rois[index];
    const croppedUri = await retain(roi.croppedUri, `roi-${index}.jpg`);
    rois.push({
      id: roi.id,
      normX: roi.normX,
      normY: roi.normY,
      normW: roi.normW,
      normH: roi.normH,
      rotation: roi.rotation,
      croppedUri
    });
  }
  const payload = JSON.stringify({
    schema: 1,
    ...session,
    photo,
    originalPhoto,
    rois
  });
  await FileSystem.writeAsStringAsync(`${dir}${FILE_NAME}`, payload);
}

export async function loadAppSession(): Promise<AppSession | null> {
  const dir = sessionDir();
  if (!dir) return null;
  try {
    const path = `${dir}${FILE_NAME}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = JSON.parse(await FileSystem.readAsStringAsync(path)) as Partial<AppSession>;
    let photo = asPhoto(raw.photo);
    let originalPhoto = asPhoto(raw.originalPhoto);
    if (photo && !(await fileStillThere(photo.uri))) photo = null;
    if (originalPhoto && !(await fileStillThere(originalPhoto.uri))) originalPhoto = null;
    const rawRois = Array.isArray(raw.rois) ? raw.rois : [];
    const rois: RoiBox[] = [];
    for (const roi of rawRois) {
      if (!roi || typeof roi.id !== 'string') continue;
      if (typeof roi.normX !== 'number' || typeof roi.normW !== 'number') continue;
      const croppedUri =
        typeof roi.croppedUri === 'string' && (await fileStillThere(roi.croppedUri))
          ? roi.croppedUri
          : undefined;
      rois.push({
        id: roi.id,
        normX: roi.normX,
        normY: typeof roi.normY === 'number' ? roi.normY : 0,
        normW: roi.normW,
        normH: typeof roi.normH === 'number' ? roi.normH : 0.1,
        rotation: typeof roi.rotation === 'number' ? roi.rotation : 0,
        croppedUri
      });
    }
    const quiz = raw.quiz;
    const fiche = raw.fiche;
    const browser = raw.browser;
    const session: AppSession = {
      phase: asPhase(raw.phase),
      photo,
      originalPhoto,
      isPhotoCleaned: Boolean(raw.isPhotoCleaned),
      rois,
      ocrText: typeof raw.ocrText === 'string' ? raw.ocrText : '',
      pageSource: raw.pageSource === 'image' ? 'image' : 'ocr',
      selectedTask: typeof raw.selectedTask === 'string' ? raw.selectedTask : 'explain_lines',
      taskText: typeof raw.taskText === 'string' ? raw.taskText : '',
      taskCustom: Boolean(raw.taskCustom),
      selectedLinkId: typeof raw.selectedLinkId === 'string' ? raw.selectedLinkId : '',
      browser:
        browser && typeof browser.url === 'string'
          ? {
              url: browser.url,
              title: browser.title || '',
              returnTo: browser.returnTo === 'settings' ? 'settings' : 'prompt',
              copied: Boolean(browser.copied),
              paste:
                browser.paste === 'together' || browser.paste === 'image-first'
                  ? browser.paste
                  : 'text'
            }
          : null,
      screenUnderBrowser:
        raw.screenUnderBrowser === 'capture' || raw.screenUnderBrowser === 'quiz'
          ? raw.screenUnderBrowser
          : 'prompt',
      resumeQuizEdit: Boolean(raw.resumeQuizEdit),
      settingsVisible: Boolean(raw.settingsVisible),
      quiz: {
        pane: quiz?.pane === 'detail' || quiz?.pane === 'play' ? quiz.pane : 'list',
        quizId: typeof quiz?.quizId === 'string' ? quiz.quizId : null,
        queueIds: Array.isArray(quiz?.queueIds)
          ? quiz.queueIds.filter((id) => typeof id === 'string')
          : [],
        revealed: Boolean(quiz?.revealed),
        playReturn: quiz?.playReturn === 'detail' ? 'detail' : 'list'
      },
      fiche: {
        pane: fiche?.pane === 'edit' || fiche?.pane === 'recall' ? fiche.pane : 'list',
        editingId: typeof fiche?.editingId === 'string' ? fiche.editingId : null,
        draft: typeof fiche?.draft === 'string' ? fiche.draft : '',
        deckIds: Array.isArray(fiche?.deckIds)
          ? fiche.deckIds.filter((id) => typeof id === 'string')
          : [],
        place: typeof fiche?.place === 'number' ? fiche.place : 0
      }
    };
    if (session.phase === 'browser' && !session.browser) session.phase = session.screenUnderBrowser;
    if ((session.phase === 'capture' || session.phase === 'prompt') && !session.photo) {
      session.phase = 'capture';
    }
    await debugLog('info', 'nav', `restore ${session.phase}`);
    return session;
  } catch (err) {
    await debugError('session', err, 'load failed');
    return null;
  }
}
