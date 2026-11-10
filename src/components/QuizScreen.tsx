import React, { useCallback, useEffect, useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import {
  ItemKind,
  QuizItem,
  StudyQuiz,
  addLinesToQuiz,
  addManualItem,
  askPrompt,
  createQuiz,
  dueItems,
  gradeQuizItem,
  loadStudyData,
  quizLevel
} from '../study/quizzes';

const OPEN_QUIZ_KEY = '@studylens/open_quiz_v1';

type Pane = 'list' | 'detail' | 'play';

interface QuizScreenProps {
  answerLanguage: string;
  linkTitle: string;
  onAsk: (prompt: string) => void;
}

export const QuizScreen: React.FC<QuizScreenProps> = ({
  answerLanguage,
  linkTitle,
  onAsk
}) => {
  const [pane, setPane] = useState<Pane>('list');
  const [quizzes, setQuizzes] = useState<StudyQuiz[]>([]);
  const [items, setItems] = useState<QuizItem[]>([]);
  const [title, setTitle] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [manualKind, setManualKind] = useState<ItemKind>('question');
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [status, setStatus] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [queue, setQueue] = useState<QuizItem[]>([]);

  const reload = useCallback(async () => {
    const data = await loadStudyData();
    setQuizzes(data.quizzes);
    setItems(data.items);
    return data;
  }, []);

  useEffect(() => {
    reload().then(async (data) => {
      const openId = await AsyncStorage.getItem(OPEN_QUIZ_KEY);
      if (openId && data.quizzes.some((quiz) => quiz.id === openId)) {
        setSelectedId(openId);
        setPane('detail');
      }
    });
  }, [reload]);

  const selected = quizzes.find((quiz) => quiz.id === selectedId) || null;
  const selectedItems = items.filter((item) => item.quizId === selectedId);
  const level = quizLevel(selectedItems);

  const openQuiz = (quiz: StudyQuiz) => {
    setSelectedId(quiz.id);
    setStatus('');
    setReply('');
    setPane('detail');
    AsyncStorage.setItem(OPEN_QUIZ_KEY, quiz.id);
  };

  const makeQuiz = async () => {
    const name = title.trim();
    if (!name) return;
    const quiz = await createQuiz(name);
    setTitle('');
    await reload();
    openQuiz(quiz);
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
    await reload();
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
    await reload();
  };

  const startPlay = async () => {
    const data = await reload();
    const mine = data.items.filter((item) => item.quizId === selectedId);
    setQueue(dueItems(mine));
    setRevealed(false);
    setPane('play');
  };

  const grade = async (correct: boolean) => {
    const current = queue[0];
    if (!current) return;
    await gradeQuizItem(current.id, correct ? 'known' : 'again');
    setQueue((prev) =>
      correct ? prev.slice(1) : [...prev.slice(1), prev[0]]
    );
    setRevealed(false);
    await reload();
  };

  if (pane === 'play' && selected) {
    const current = queue[0];
    return (
      <View style={styles.card}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => setPane('detail')}>
            <Text style={styles.link}>{selected.title}</Text>
          </TouchableOpacity>
          <Text style={styles.level}>Niveau {quizLevel(selectedItems)}/10</Text>
        </View>
        {!current ? (
          <Text style={styles.help}>
            Rien à demander pour l'instant. Les éléments réussis reviendront plus tard. Tu peux en ajouter de plus difficiles.
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
              {queue.length} en attente. Suivant montre la réponse ici. Pas bien la rapproche. Bien répondu l'éloigne.
            </Text>
          </View>
        )}
      </View>
    );
  }

  if (pane === 'detail' && selected) {
    const waiting = dueItems(selectedItems).length;
    return (
      <View style={styles.card}>
        <TouchableOpacity
          onPress={() => {
            setPane('list');
            AsyncStorage.removeItem(OPEN_QUIZ_KEY);
          }}
        >
          <Text style={styles.link}>Tous les quiz</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{selected.title}</Text>
        <Text style={styles.level}>
          Niveau {level}/10 · {selectedItems.length} élément{selectedItems.length > 1 ? 's' : ''} · {waiting} maintenant
        </Text>
        <Text style={styles.help}>
          Le niveau monte quand les réponses tiennent dans le temps. La prochaine demande au modèle vise un cran au-dessus.
        </Text>
        <TouchableOpacity onPress={startPlay} style={styles.primary}>
          <Text style={styles.primaryText}>
            {waiting > 0 ? 'Commencer' : 'Rien à revoir'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={askMore} style={styles.secondary}>
          <Text style={styles.secondaryText}>Demander de nouveaux éléments</Text>
        </TouchableOpacity>
        <Text style={styles.label}>Ajouter à la main</Text>
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
        Un quiz par sujet : araméen, chinois, Levinas, ou autre. Tu le crées, tu y ajoutes des mots ou des questions, puis il te les redemande selon ton niveau.
      </Text>
      <View style={styles.card}>
        <Text style={styles.label}>Nouveau quiz</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Araméen, Chinois, Levinas..."
          placeholderTextColor="#64748b"
        />
        <TouchableOpacity onPress={makeQuiz} style={styles.primary}>
          <Text style={styles.primaryText}>Créer</Text>
        </TouchableOpacity>
      </View>
      {quizzes.map((quiz) => {
        const mine = items.filter((item) => item.quizId === quiz.id);
        const waiting = dueItems(mine).length;
        return (
          <TouchableOpacity key={quiz.id} onPress={() => openQuiz(quiz)} style={styles.card}>
            <View style={styles.topRow}>
              <Text style={styles.title}>{quiz.title}</Text>
              <Text style={styles.level}>Niveau {quizLevel(mine)}/10</Text>
            </View>
            <Text style={styles.help}>
              {mine.length} élément{mine.length > 1 ? 's' : ''}
              {waiting > 0 ? ` · ${waiting} à revoir` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

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
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1
  },
  level: {
    color: '#a5b4fc',
    fontSize: 13,
    fontWeight: '700'
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
