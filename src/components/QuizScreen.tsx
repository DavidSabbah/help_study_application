import React, { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  ItemKind,
  QuizItem,
  StudyQuiz,
  addLinesToQuiz,
  addManualItem,
  askPrompt,
  createQuiz,
  deleteQuiz,
  deleteQuizItem,
  drawQuizQueue,
  gradeQuizItem,
  loadStudyData,
  renameQuiz,
  setOpenQuiz
} from '../study/quizzes';
import { QuizPlace } from '../session/appSession';
import { useI18n } from '../i18n/I18n';

type Pane = 'list' | 'detail' | 'play';

interface QuizScreenProps {
  answerLanguage: string;
  linkTitle: string;
  resumeEdit: boolean;
  initial?: QuizPlace;
  onPlace?: (place: QuizPlace) => void;
  backRef?: MutableRefObject<(() => boolean) | null>;
  onAsk: (prompt: string) => void;
}

export const QuizScreen: React.FC<QuizScreenProps> = ({
  answerLanguage,
  linkTitle,
  resumeEdit,
  initial,
  onPlace,
  backRef,
  onAsk
}) => {
  const { t } = useI18n();
  const boot = useRef(initial);
  const [pane, setPane] = useState<Pane>(boot.current?.pane || 'list');
  const [quizzes, setQuizzes] = useState<StudyQuiz[]>([]);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [title, setTitle] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(boot.current?.quizId || null);
  const [playReturn, setPlayReturn] = useState<Pane>(boot.current?.playReturn || 'list');
  const [reply, setReply] = useState('');
  const [manualKind, setManualKind] = useState<ItemKind>('question');
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [status, setStatus] = useState('');
  const [revealed, setRevealed] = useState(Boolean(boot.current?.revealed));
  const [queue, setQueue] = useState<QuizItem[]>([]);
  const [past, setPast] = useState<QuizItem[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [booting, setBooting] = useState((boot.current?.pane || 'list') !== 'list');

  const reload = useCallback(async () => {
    const data = await loadStudyData();
    setQuizzes(data.quizzes);
    setItems(data.items);
    return data;
  }, []);

  useEffect(() => {
    let cancel = false;
    reload().then((data) => {
      if (cancel) return;
      const start = boot.current;
      const quizId = start?.quizId;
      if ((start?.pane === 'detail' || start?.pane === 'play') && quizId) {
        const quiz = data.quizzes.find((item) => item.id === quizId);
        if (quiz) {
          setSelectedId(quiz.id);
          setEditTitle(quiz.title);
          if (start.pane === 'play') {
            const mine = data.items.filter((item) => item.quizId === quiz.id);
            const byId = new Map(mine.map((item) => [item.id, item]));
            const queued = start.queueIds
              .map((id) => byId.get(id))
              .filter((item): item is QuizItem => Boolean(item));
            setQueue(queued.length > 0 ? queued : drawQuizQueue(mine));
            setRevealed(start.revealed);
            setPlayReturn(start.playReturn);
            setPane('play');
          } else {
            setPane('detail');
          }
          setBooting(false);
          return;
        }
      }
      if (resumeEdit && data.openQuizId) {
        const quiz = data.quizzes.find((item) => item.id === data.openQuizId);
        if (quiz) {
          setSelectedId(quiz.id);
          setEditTitle(quiz.title);
          setPane('detail');
        }
      }
      setBooting(false);
    });
    return () => {
      cancel = true;
    };
  }, [reload, resumeEdit]);

  useEffect(() => {
    if (booting) return;
    onPlace?.({
      pane: pane === 'detail' || pane === 'play' ? pane : 'list',
      quizId: selectedId,
      queueIds: queue.map((item) => item.id),
      revealed,
      playReturn: playReturn === 'detail' ? 'detail' : 'list'
    });
  }, [booting, pane, selectedId, queue, revealed, playReturn, onPlace]);

  useEffect(() => {
    return () => {
      if (backRef) backRef.current = null;
    };
  }, [backRef]);

  const selected = quizzes.find((quiz) => quiz.id === selectedId) || null;
  const selectedItems = items.filter((item) => item.quizId === selectedId);

  if (backRef) {
    backRef.current = () => {
      if (pane === 'play') {
        setPane(playReturn === 'detail' ? 'detail' : 'list');
        return true;
      }
      if (pane === 'detail') {
        setStatus('');
        setPane('list');
        void setOpenQuiz(null);
        return true;
      }
      return false;
    };
  }

  if (booting) {
    return <View style={styles.card} />;
  }

  const openModify = (quiz: StudyQuiz) => {
    setSelectedId(quiz.id);
    setEditTitle(quiz.title);
    setStatus('');
    setReply('');
    setManualPrompt('');
    setManualAnswer('');
    setQuestionIndex(0);
    setPane('detail');
    setOpenQuiz(quiz.id);
  };

  const makeQuiz = async () => {
    const name = title.trim();
    if (!name) return;
    await createQuiz(name);
    setTitle('');
    setStatus(t('quiz.added', { name }));
    await reload();
  };

  const confirmRemove = (quiz: StudyQuiz) => {
    Alert.alert(t('quiz.deleteTitle'), t('quiz.deleteBody', { name: quiz.title }), [
      { text: t('quiz.cancel'), style: 'cancel' },
      {
        text: t('quiz.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteQuiz(quiz.id);
          if (selectedId === quiz.id) {
            setSelectedId(null);
            setPane('list');
          }
          setStatus(t('quiz.deleted', { name: quiz.title }));
          await reload();
        }
      }
    ]);
  };

  const saveName = async () => {
    if (!selectedId) return;
    const saved = await renameQuiz(selectedId, editTitle);
    if (!saved) {
      setStatus(t('quiz.needName'));
      return;
    }
    setStatus(t('quiz.nameSaved'));
    await reload();
  };

  const removeItem = async (id: string) => {
    await deleteQuizItem(id);
    setStatus(t('quiz.questionDeleted'));
    await reload();
  };

  const askMore = () => {
    if (!selected) return;
    onAsk(askPrompt(selected, selectedItems, answerLanguage));
    setStatus(t('quiz.askCopied', { link: linkTitle }));
  };

  const pasteReply = async () => {
    const value = await Clipboard.getStringAsync();
    if (!value.trim()) {
      setStatus(t('quiz.clipboardEmpty'));
      return;
    }
    setReply(value);
  };

  const saveReply = async () => {
    if (!selectedId) return;
    const result = await addLinesToQuiz(selectedId, reply);
    if (result.added === 0 && result.skipped === 0) {
      setStatus(t('quiz.nothingToAdd'));
      return;
    }
    setStatus(
      result.skipped
        ? t('quiz.addedSkipped', { added: result.added, skipped: result.skipped })
        : t('quiz.addedOnly', { added: result.added })
    );
    setReply('');
    const data = await reload();
    const count = data.items.filter((item) => item.quizId === selectedId).length;
    setQuestionIndex(Math.max(0, count - 1));
  };

  const saveManual = async () => {
    if (!selectedId) return;
    const saved = await addManualItem(
      selectedId,
      manualKind,
      manualPrompt,
      manualAnswer
    );
    if (!saved) {
      setStatus(t('quiz.needBoth'));
      return;
    }
    setManualPrompt('');
    setManualAnswer('');
    setStatus(manualKind === 'word' ? t('quiz.wordAdded') : t('quiz.questionAdded'));
    const data = await reload();
    const count = data.items.filter((item) => item.quizId === selectedId).length;
    setQuestionIndex(Math.max(0, count - 1));
  };

  const startPlay = async (quizId: string, backTo: Pane) => {
    setSelectedId(quizId);
    const data = await reload();
    const mine = data.items.filter((item) => item.quizId === quizId);
    setQueue(drawQuizQueue(mine));
    setPast([]);
    setRevealed(false);
    setPlayReturn(backTo);
    setPane('play');
  };

  const eraseCurrent = () => {
    const current = queue[0];
    if (!current) return;
    const prompt = current.prompt.length > 80 ? `${current.prompt.slice(0, 80)}…` : current.prompt;
    Alert.alert(t('quiz.eraseTitle'), t('quiz.eraseBody', { prompt }), [
      { text: t('quiz.cancel'), style: 'cancel' },
      {
        text: t('quiz.erase'),
        style: 'destructive',
        onPress: async () => {
          await deleteQuizItem(current.id);
          setQueue((prev) => prev.filter((item) => item.id !== current.id));
          setRevealed(false);
          await reload();
        }
      }
    ]);
  };

  const goBack = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((prev) => prev.slice(0, -1));
    setQueue((q) => {
      const current = q[0];
      const rest = q.slice(current ? 1 : 0).filter((item) => item.id !== previous.id);
      return current ? [previous, current, ...rest] : [previous, ...rest];
    });
    setRevealed(false);
  };

  const grade = async (correct: boolean) => {
    const current = queue[0];
    if (!current) return;
    setPast((prev) => [...prev, current]);
    await gradeQuizItem(current.id, correct ? 'known' : 'again');
    setQueue((prev) => {
      const rest = prev.slice(1);
      if (!correct && rest.length === 0) return [prev[0]];
      return rest;
    });
    setRevealed(false);
    await reload();
  };

  if (pane === 'play' && selected) {
    const current = queue[0];
    return (
      <View style={styles.card}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => setPane(playReturn)} style={styles.backLink}>
            <Text style={styles.link}>{selected.title}</Text>
          </TouchableOpacity>
          {current && (
            <TouchableOpacity
              onPress={eraseCurrent}
              style={styles.iconBtn}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t('quiz.erase')}
            >
              <Ionicons name="trash-outline" size={18} color="#fca5a5" />
            </TouchableOpacity>
          )}
        </View>
        {!current ? (
          <Text style={styles.help}>{t('quiz.playDone')}</Text>
        ) : (
          <View style={styles.quiz}>
            <Text style={styles.kind}>{current.kind === 'word' ? t('quiz.word') : t('quiz.question')}</Text>
            <Text style={styles.prompt}>{current.prompt}</Text>
            <Text style={styles.itemId} selectable>
              {current.id}
            </Text>
            {revealed && <Text style={styles.answer}>{current.answer}</Text>}
            <View style={styles.nextRow}>
              <TouchableOpacity
                onPress={goBack}
                disabled={past.length === 0}
                style={[styles.backBtn, past.length === 0 && styles.pageBtnOff]}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel={t('quiz.back')}
              >
                <Ionicons name="chevron-back" size={18} color="#e2e8f0" />
              </TouchableOpacity>
              {!revealed && (
                <TouchableOpacity onPress={() => setRevealed(true)} style={styles.primaryFlex}>
                  <Text style={styles.primaryText}>{t('quiz.show')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {revealed && (
              <View style={styles.grades}>
                <TouchableOpacity onPress={() => grade(false)} style={styles.again}>
                  <Text style={styles.gradeText}>{t('quiz.again')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => grade(true)} style={styles.easy}>
                  <Text style={styles.gradeText}>{t('quiz.known')}</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.help}>{t('quiz.waiting', { n: queue.length })}</Text>
          </View>
        )}
      </View>
    );
  }

  if (pane === 'detail' && selected) {
    return (
      <View style={styles.card}>
        <TouchableOpacity
          onPress={() => {
            setStatus('');
            setPane('list');
            setOpenQuiz(null);
          }}
        >
          <Text style={styles.link}>{t('quiz.all')}</Text>
        </TouchableOpacity>
        <Text style={styles.label}>{t('quiz.name')}</Text>
        <TextInput
          style={styles.input}
          value={editTitle}
          onChangeText={setEditTitle}
          placeholder={t('quiz.namePlaceholder')}
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity onPress={saveName} style={styles.secondary}>
          <Text style={styles.secondaryText}>{t('quiz.saveName')}</Text>
        </TouchableOpacity>
        <Text style={styles.help}>
          {t(selectedItems.length > 1 ? 'quiz.questionsMany' : 'quiz.questionsOne', {
            n: selectedItems.length
          })}
        </Text>
        <TouchableOpacity
          onPress={() => selectedId && startPlay(selectedId, 'detail')}
          style={selectedItems.length > 0 ? styles.primary : styles.secondaryMuted}
          disabled={selectedItems.length === 0}
        >
          <Text style={styles.primaryText}>
            {selectedItems.length > 0 ? t('quiz.start') : t('quiz.needQuestions')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={askMore} style={styles.secondary}>
          <Text style={styles.secondaryText}>{t('quiz.askMore')}</Text>
        </TouchableOpacity>
        <QuestionPager
          items={selectedItems}
          index={questionIndex}
          onIndex={setQuestionIndex}
          onDelete={(id) => removeItem(id)}
        />
        <Text style={styles.label}>{t('quiz.addQuestion')}</Text>
        <View style={styles.row}>
          <TouchableOpacity
            onPress={() => setManualKind('word')}
            style={[styles.secondaryCompact, manualKind === 'word' && styles.kindOn]}
          >
            <Text style={styles.secondaryText}>{t('quiz.word')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setManualKind('question')}
            style={[styles.secondaryCompact, manualKind === 'question' && styles.kindOn]}
          >
            <Text style={styles.secondaryText}>{t('quiz.question')}</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={manualPrompt}
          onChangeText={setManualPrompt}
          placeholder={manualKind === 'word' ? t('quiz.wordPlaceholder') : t('quiz.questionPlaceholder')}
          placeholderTextColor="#64748b"
        />
        <TextInput
          style={styles.input}
          value={manualAnswer}
          onChangeText={setManualAnswer}
          placeholder={manualKind === 'word' ? t('quiz.sensePlaceholder') : t('quiz.answerPlaceholder')}
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity onPress={saveManual} style={styles.secondary}>
          <Text style={styles.secondaryText}>{t('quiz.addThis')}</Text>
        </TouchableOpacity>
        <Text style={styles.label}>{t('quiz.pasteLabel')}</Text>
        <TextInput
          style={[styles.input, styles.reply]}
          multiline
          value={reply}
          onChangeText={setReply}
          placeholder={'mot | 你好 | bonjour\nquestion | Qui est Levinas ? | Un philosophe'}
          placeholderTextColor="#64748b"
          textAlignVertical="top"
        />
        <View style={styles.row}>
          <TouchableOpacity onPress={pasteReply} style={styles.secondaryCompact}>
            <Text style={styles.secondaryText}>{t('quiz.paste')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={saveReply} style={styles.primaryFlex}>
            <Text style={styles.primaryText}>{t('quiz.addToQuiz')}</Text>
          </TouchableOpacity>
        </View>
        {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.help}>{t('quiz.intro')}</Text>
      <View style={styles.card}>
        <Text style={styles.label}>{t('quiz.addLabel')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('quiz.addPlaceholder')}
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity onPress={makeQuiz} style={styles.primary}>
          <Text style={styles.primaryText}>{t('quiz.add')}</Text>
        </TouchableOpacity>
        {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      </View>
      {quizzes.length === 0 && <Text style={styles.help}>{t('quiz.none')}</Text>}
      {quizzes.map((quiz) => {
        const mine = items.filter((item) => item.quizId === quiz.id);
        return (
          <View key={quiz.id} style={styles.card}>
            <View style={styles.quizHead}>
              <View style={styles.quizBody}>
                <Text style={styles.title}>{quiz.title}</Text>
                <Text style={styles.help}>
                  {t(mine.length > 1 ? 'quiz.questionsMany' : 'quiz.questionsOne', { n: mine.length })}
                </Text>
              </View>
              <View style={styles.iconRow}>
                <TouchableOpacity
                  onPress={() => openModify(quiz)}
                  style={styles.iconBtn}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('quiz.modify')}
                >
                  <Ionicons name="pencil-outline" size={18} color="#c7d2fe" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmRemove(quiz)}
                  style={styles.iconBtn}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('quiz.delete')}
                >
                  <Ionicons name="trash-outline" size={18} color="#fca5a5" />
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => startPlay(quiz.id, 'list')}
              style={mine.length > 0 ? styles.secondary : styles.secondaryMuted}
              disabled={mine.length === 0}
            >
              <Text style={styles.secondaryText}>
                {mine.length > 0 ? t('quiz.start') : t('quiz.startEmpty')}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
};

function QuestionPager({
  items,
  index,
  onIndex,
  onDelete
}: {
  items: QuizItem[];
  index: number;
  onIndex: (next: number) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const count = items.length;
  const place = count === 0 ? 0 : Math.min(index, count - 1);
  const current = count === 0 ? null : items[place];
  const atStart = place <= 0;
  const atEnd = count === 0 || place >= count - 1;
  return (
    <View style={styles.pager}>
      <Text style={styles.label}>
        {t(count > 1 ? 'quiz.questionsMany' : 'quiz.questionsOne', { n: count })}
      </Text>
      <View style={styles.pagerRow}>
        <TouchableOpacity
          onPress={() => onIndex(place - 1)}
          disabled={atStart}
          style={[styles.pageBtn, atStart && styles.pageBtnOff]}
        >
          <Text style={styles.pageBtnText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.pageCount}>{count === 0 ? '0 / 0' : `${place + 1} / ${count}`}</Text>
        <TouchableOpacity
          onPress={() => onIndex(place + 1)}
          disabled={atEnd}
          style={[styles.pageBtn, atEnd && styles.pageBtnOff]}
        >
          <Text style={styles.pageBtnText}>{'>'}</Text>
        </TouchableOpacity>
      </View>
      {current && (
        <View style={styles.quiz}>
          <Text style={styles.kind}>{current.kind === 'word' ? t('quiz.word') : t('quiz.question')}</Text>
          <Text style={styles.prompt}>{current.prompt}</Text>
          <Text style={styles.itemId} selectable>
            {current.id}
          </Text>
          <Text style={styles.answer}>{current.answer}</Text>
          <TouchableOpacity
            onPress={() => onDelete(current.id)}
            style={styles.iconBtn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={t('quiz.erase')}
          >
            <Ionicons name="trash-outline" size={18} color="#fca5a5" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  backLink: {
    flex: 1
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a'
  },
  quizHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10
  },
  quizBody: {
    flex: 1,
    gap: 4
  },
  secondaryMuted: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  pager: {
    gap: 10
  },
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  pageBtn: {
    width: 56,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#4338ca',
    alignItems: 'center',
    justifyContent: 'center'
  },
  pageBtnOff: {
    backgroundColor: '#334155',
    opacity: 0.45
  },
  pageBtnText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700'
  },
  pageCount: {
    flex: 1,
    textAlign: 'center',
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700'
  },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1
  },
  help: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 19
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700'
  },
  link: {
    color: '#a5b4fc',
    fontSize: 13,
    fontWeight: '700'
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15
  },
  reply: {
    minHeight: 120
  },
  row: {
    flexDirection: 'row',
    gap: 8
  },
  primary: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12
  },
  primaryFlex: {
    flex: 1,
    backgroundColor: '#6366f1',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12
  },
  primaryText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15
  },
  secondary: {
    backgroundColor: '#334155',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12
  },
  secondaryCompact: {
    backgroundColor: '#334155',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  secondaryText: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  kindOn: {
    backgroundColor: '#4338ca'
  },
  status: {
    color: '#c4b5fd',
    fontSize: 13,
    lineHeight: 18
  },
  quiz: {
    gap: 10
  },
  kind: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '700'
  },
  prompt: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32
  },
  itemId: {
    color: '#64748b',
    fontSize: 11
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155'
  },
  answer: {
    color: '#e2e8f0',
    fontSize: 18,
    lineHeight: 26
  },
  grades: {
    flexDirection: 'row',
    gap: 8
  },
  again: {
    flex: 1,
    backgroundColor: '#7f1d1d',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12
  },
  known: {
    flex: 1,
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12
  },
  easy: {
    flex: 1,
    backgroundColor: '#047857',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12
  },
  gradeText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13
  }
});
