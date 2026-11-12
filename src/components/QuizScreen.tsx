import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet
} from 'react-native';
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

type Pane = 'list' | 'detail' | 'play';

interface QuizScreenProps {
  answerLanguage: string;
  linkTitle: string;
  resumeEdit: boolean;
  onAsk: (prompt: string) => void;
}

export const QuizScreen: React.FC<QuizScreenProps> = ({
  answerLanguage,
  linkTitle,
  resumeEdit,
  onAsk
}) => {
  const [pane, setPane] = useState<Pane>('list');
  const [quizzes, setQuizzes] = useState<StudyQuiz[]>([]);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [title, setTitle] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playReturn, setPlayReturn] = useState<Pane>('list');
  const [reply, setReply] = useState('');
  const [manualKind, setManualKind] = useState<ItemKind>('question');
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [status, setStatus] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [queue, setQueue] = useState<QuizItem[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);

  const reload = useCallback(async () => {
    const data = await loadStudyData();
    setQuizzes(data.quizzes);
    setItems(data.items);
    return data;
  }, []);

  useEffect(() => {
    reload().then((data) => {
      if (!resumeEdit || !data.openQuizId) return;
      const quiz = data.quizzes.find((item) => item.id === data.openQuizId);
      if (!quiz) return;
      setSelectedId(quiz.id);
      setEditTitle(quiz.title);
      setPane('detail');
    });
  }, [reload, resumeEdit]);

  const selected = quizzes.find((quiz) => quiz.id === selectedId) || null;
  const selectedItems = items.filter((item) => item.quizId === selectedId);

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
    setStatus(`« ${name} » est ajouté. Tu peux en créer d'autres.`);
    await reload();
  };

  const confirmRemove = (quiz: StudyQuiz) => {
    Alert.alert(
      'Supprimer ce quiz',
      `« ${quiz.title} » et ses questions seront effacés de ce téléphone.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await deleteQuiz(quiz.id);
            if (selectedId === quiz.id) {
              setSelectedId(null);
              setPane('list');
            }
            setStatus(`« ${quiz.title} » est supprimé.`);
            await reload();
          }
        }
      ]
    );
  };

  const saveName = async () => {
    if (!selectedId) return;
    const saved = await renameQuiz(selectedId, editTitle);
    if (!saved) {
      setStatus('Écris un nom.');
      return;
    }
    setStatus('Nom enregistré.');
    await reload();
  };

  const removeItem = async (id: string) => {
    await deleteQuizItem(id);
    setStatus('Question effacée.');
    await reload();
  };

  const askMore = () => {
    if (!selected) return;
    onAsk(askPrompt(selected, selectedItems, answerLanguage));
    setStatus(`Demande copiée pour ${linkTitle}. Copie la réponse, puis ajoute-la ici.`);
  };

  const pasteReply = async () => {
    const value = await Clipboard.getStringAsync();
    if (!value.trim()) {
      setStatus('Le presse-papiers est vide.');
      return;
    }
    setReply(value);
  };

  const saveReply = async () => {
    if (!selectedId) return;
    const result = await addLinesToQuiz(selectedId, reply);
    if (result.added === 0 && result.updated === 0) {
      setStatus('Rien à ajouter. Une ligne doit ressembler à : mot | terme | sens');
      return;
    }
    setStatus(
      `${result.added} ajouté${result.added > 1 ? 's' : ''}` +
        (result.updated ? `, ${result.updated} mis à jour.` : '.')
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
      setStatus('Écris la question et la réponse.');
      return;
    }
    setManualPrompt('');
    setManualAnswer('');
    setStatus(manualKind === 'word' ? 'Mot ajouté.' : 'Question ajoutée.');
    const data = await reload();
    const count = data.items.filter((item) => item.quizId === selectedId).length;
    setQuestionIndex(Math.max(0, count - 1));
  };

  const startPlay = async (quizId: string, backTo: Pane) => {
    setSelectedId(quizId);
    const data = await reload();
    const mine = data.items.filter((item) => item.quizId === quizId);
    setQueue(drawQuizQueue(mine));
    setRevealed(false);
    setPlayReturn(backTo);
    setPane('play');
  };

  const grade = async (correct: boolean) => {
    const current = queue[0];
    if (!current) return;
    await gradeQuizItem(current.id, correct ? 'known' : 'again');
    setQueue((prev) => {
      const rest = prev.slice(1);
      if (correct) return rest;
      if (rest.length === 0) return [prev[0]];
      const soon = Math.min(2, rest.length);
      return [...rest.slice(0, soon), prev[0], ...rest.slice(soon)];
    });
    setRevealed(false);
    await reload();
  };

  if (pane === 'play' && selected) {
    const current = queue[0];
    return (
      <View style={styles.card}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => setPane(playReturn)}>
            <Text style={styles.link}>{selected.title}</Text>
          </TouchableOpacity>
        </View>
        {!current ? (
          <Text style={styles.help}>
            C'est fini pour cette fois. Une bonne réponse fait monter d'un cran. Une erreur fait reculer d'un cran.
          </Text>
        ) : (
          <View style={styles.quiz}>
            <Text style={styles.kind}>{current.kind === 'word' ? 'Mot' : 'Question'}</Text>
            <Text style={styles.prompt}>{current.prompt}</Text>
            {revealed ? (
              <Text style={styles.answer}>{current.answer}</Text>
            ) : (
              <TouchableOpacity onPress={() => setRevealed(true)} style={styles.primary}>
                <Text style={styles.primaryText}>Suivant</Text>
              </TouchableOpacity>
            )}
            {revealed && (
              <View style={styles.grades}>
                <TouchableOpacity onPress={() => grade(false)} style={styles.again}>
                  <Text style={styles.gradeText}>Pas bien</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => grade(true)} style={styles.easy}>
                  <Text style={styles.gradeText}>Bien répondu</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.help}>
              {queue.length} en attente. Pas bien recule d'un cran. Bien répondu avance d'un cran : pas connu, à peu près, puis connu.
            </Text>
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
          <Text style={styles.link}>Tous les quiz</Text>
        </TouchableOpacity>
        <Text style={styles.label}>Nom du quiz</Text>
        <TextInput
          style={styles.input}
          value={editTitle}
          onChangeText={setEditTitle}
          placeholder="Nom du quiz"
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity onPress={saveName} style={styles.secondary}>
          <Text style={styles.secondaryText}>Enregistrer le nom</Text>
        </TouchableOpacity>
        <Text style={styles.help}>
          {selectedItems.length} question{selectedItems.length > 1 ? 's' : ''}
        </Text>
        <TouchableOpacity
          onPress={() => selectedId && startPlay(selectedId, 'detail')}
          style={selectedItems.length > 0 ? styles.primary : styles.secondaryMuted}
          disabled={selectedItems.length === 0}
        >
          <Text style={styles.primaryText}>
            {selectedItems.length > 0 ? 'Commencer' : 'Ajoute des questions'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={askMore} style={styles.secondary}>
          <Text style={styles.secondaryText}>Demander de nouveaux éléments</Text>
        </TouchableOpacity>
        <QuestionPager
          items={selectedItems}
          index={questionIndex}
          onIndex={setQuestionIndex}
          onDelete={(id) => removeItem(id)}
        />
        <Text style={styles.label}>Ajouter une question</Text>
        <View style={styles.row}>
          <TouchableOpacity
            onPress={() => setManualKind('word')}
            style={[styles.secondaryCompact, manualKind === 'word' && styles.kindOn]}
          >
            <Text style={styles.secondaryText}>Mot</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setManualKind('question')}
            style={[styles.secondaryCompact, manualKind === 'question' && styles.kindOn]}
          >
            <Text style={styles.secondaryText}>Question</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={manualPrompt}
          onChangeText={setManualPrompt}
          placeholder={manualKind === 'word' ? 'Le mot' : 'La question'}
          placeholderTextColor="#64748b"
        />
        <TextInput
          style={styles.input}
          value={manualAnswer}
          onChangeText={setManualAnswer}
          placeholder={manualKind === 'word' ? 'Le sens' : 'La réponse'}
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity onPress={saveManual} style={styles.secondary}>
          <Text style={styles.secondaryText}>Ajouter cette question</Text>
        </TouchableOpacity>
        <Text style={styles.label}>Coller la réponse du modèle</Text>
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
            <Text style={styles.secondaryText}>Coller</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={saveReply} style={styles.primaryFlex}>
            <Text style={styles.primaryText}>Ajouter au quiz</Text>
          </TouchableOpacity>
        </View>
        {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.help}>
        Tu peux en garder autant que tu veux. Modifier un quiz sert à y ajouter des questions, une par une, ou à coller la réponse d'un modèle.
      </Text>
      <View style={styles.card}>
        <Text style={styles.label}>Ajouter un quiz</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Araméen, Chinois, Levinas..."
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity onPress={makeQuiz} style={styles.primary}>
          <Text style={styles.primaryText}>Ajouter</Text>
        </TouchableOpacity>
        {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      </View>
      {quizzes.length === 0 && (
        <Text style={styles.help}>Aucun quiz pour l'instant.</Text>
      )}
      {quizzes.map((quiz) => {
        const mine = items.filter((item) => item.quizId === quiz.id);
        return (
          <View key={quiz.id} style={styles.card}>
            <View style={styles.quizHead}>
              <View style={styles.frontActions}>
                <TouchableOpacity onPress={() => openModify(quiz)} style={styles.modifyBtn}>
                  <Text style={styles.frontText}>Modifier</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmRemove(quiz)} style={styles.removeBtn}>
                  <Text style={styles.frontText}>Supprimer</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.quizBody}>
                <Text style={styles.title}>{quiz.title}</Text>
                <Text style={styles.help}>
                  {mine.length} question{mine.length > 1 ? 's' : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => startPlay(quiz.id, 'list')}
              style={mine.length > 0 ? styles.secondary : styles.secondaryMuted}
              disabled={mine.length === 0}
            >
              <Text style={styles.secondaryText}>
                {mine.length > 0 ? 'Commencer' : 'Ajoute des questions avec Modifier'}
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
  const count = items.length;
  const place = count === 0 ? 0 : Math.min(index, count - 1);
  const current = count === 0 ? null : items[place];
  const atStart = place <= 0;
  const atEnd = count === 0 || place >= count - 1;
  return (
    <View style={styles.pager}>
      <Text style={styles.label}>
        {count} question{count > 1 ? 's' : ''}
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
          <Text style={styles.kind}>{current.kind === 'word' ? 'Mot' : 'Question'}</Text>
          <Text style={styles.prompt}>{current.prompt}</Text>
          <Text style={styles.answer}>{current.answer}</Text>
          <TouchableOpacity onPress={() => onDelete(current.id)} style={styles.removeBtn}>
            <Text style={styles.frontText}>Effacer</Text>
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
  quizHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10
  },
  frontActions: {
    gap: 6
  },
  quizBody: {
    flex: 1,
    gap: 4
  },
  modifyBtn: {
    backgroundColor: '#4338ca',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  removeBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  frontText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700'
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
