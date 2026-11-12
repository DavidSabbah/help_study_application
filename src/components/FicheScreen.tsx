import React, { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet
} from 'react-native';
import {
  FICHE_LINE_LIMIT,
  Fiche,
  deleteFiche,
  drawFiches,
  ficheLineCount,
  fichePreview,
  ficheTitle,
  loadFiches,
  saveFiche
} from '../study/fiches';
import { FichePlace } from '../session/appSession';

type Pane = 'list' | 'edit' | 'recall';

interface FicheScreenProps {
  initial?: FichePlace;
  onPlace?: (place: FichePlace) => void;
  backRef?: MutableRefObject<(() => boolean) | null>;
}

function clipDraft(value: string): string {
  return value.replace(/\r\n/g, '\n').split('\n').slice(0, FICHE_LINE_LIMIT).join('\n');
}

function formatWhen(ms: number): string {
  const date = new Date(ms);
  const day = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const time = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${day} · ${time}`;
}

function ficheDateLabel(fiche: Fiche): string {
  const created = formatWhen(fiche.createdAt);
  if (fiche.updatedAt - fiche.createdAt > 60_000) {
    return `${created} · modifiée le ${formatWhen(fiche.updatedAt)}`;
  }
  return created;
}

type FicheOrder = 'recent' | 'ancien' | 'modifie' | 'az' | 'za';

const ORDER_OPTIONS: { id: FicheOrder; label: string }[] = [
  { id: 'recent', label: 'Récentes' },
  { id: 'ancien', label: 'Anciennes' },
  { id: 'modifie', label: 'Modifiées' },
  { id: 'az', label: 'A → Z' },
  { id: 'za', label: 'Z → A' }
];

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesQuery(fiche: Fiche, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return fold(fiche.text).includes(needle);
}

function sortFiches(list: Fiche[], order: FicheOrder): Fiche[] {
  const next = [...list];
  next.sort((a, b) => {
    if (order === 'recent') return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
    if (order === 'ancien') return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    if (order === 'modifie') return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    const cmp = ficheTitle(a.text).localeCompare(ficheTitle(b.text), 'fr', { sensitivity: 'base' });
    return order === 'az' ? cmp || a.id.localeCompare(b.id) : -cmp || a.id.localeCompare(b.id);
  });
  return next;
}

export const FicheScreen: React.FC<FicheScreenProps> = ({ initial, onPlace, backRef }) => {
  const boot = useRef(initial);
  const [pane, setPane] = useState<Pane>(boot.current?.pane || 'list');
  const [fiches, setFiches] = useState<Fiche[]>([]);
  const [editingId, setEditingId] = useState<string | null>(boot.current?.editingId || null);
  const [draft, setDraft] = useState(boot.current?.draft || '');
  const [status, setStatus] = useState('');
  const [deck, setDeck] = useState<Fiche[]>([]);
  const [place, setPlace] = useState(boot.current?.place || 0);
  const [booting, setBooting] = useState((boot.current?.pane || 'list') !== 'list');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<FicheOrder>('recent');

  const shown = useMemo(
    () => sortFiches(fiches.filter((fiche) => matchesQuery(fiche, query)), order),
    [fiches, query, order]
  );

  const reload = useCallback(async () => {
    const next = await loadFiches();
    setFiches(next);
    return next;
  }, []);

  useEffect(() => {
    let cancel = false;
    reload().then((list) => {
      if (cancel) return;
      const start = boot.current;
      if (start?.pane === 'recall') {
        const restored = start.deckIds
          .map((id) => list.find((fiche) => fiche.id === id))
          .filter((fiche): fiche is Fiche => Boolean(fiche));
        setDeck(restored);
        setPlace(Math.min(start.place, restored.length));
      }
      if (start?.pane === 'edit' && start.editingId) {
        const fiche = list.find((item) => item.id === start.editingId);
        if (fiche && !start.draft) setDraft(fiche.text);
      }
      setBooting(false);
    });
    return () => {
      cancel = true;
    };
  }, [reload]);

  useEffect(() => {
    if (booting) return;
    onPlace?.({
      pane,
      editingId,
      draft,
      deckIds: deck.map((fiche) => fiche.id),
      place
    });
  }, [booting, pane, editingId, draft, deck, place, onPlace]);

  useEffect(() => {
    return () => {
      if (backRef) backRef.current = null;
    };
  }, [backRef]);

  const openNew = () => {
    setEditingId(null);
    setDraft('');
    setStatus('');
    setPane('edit');
  };

  const openEdit = (fiche: Fiche) => {
    setEditingId(fiche.id);
    setDraft(fiche.text);
    setStatus('');
    setPane('edit');
  };

  const changeDraft = (value: string) => {
    const next = clipDraft(value);
    setDraft(next);
    if (next !== value.replace(/\r\n/g, '\n')) {
      setStatus(`Une fiche tient en ${FICHE_LINE_LIMIT} lignes.`);
    }
  };

  const save = async () => {
    const saved = await saveFiche(editingId, draft);
    if (!saved) {
      setStatus("Écris l'idée.");
      return;
    }
    setStatus(editingId ? 'Fiche enregistrée.' : 'Fiche ajoutée.');
    setEditingId(saved.id);
    setDraft(saved.text);
    await reload();
  };

  const confirmRemove = (fiche: Fiche) => {
    Alert.alert('Supprimer cette fiche', 'Elle sera effacée de ce téléphone.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await deleteFiche(fiche.id);
          if (editingId === fiche.id) {
            setEditingId(null);
            setDraft('');
            setPane('list');
          }
          setStatus('Fiche supprimée.');
          await reload();
        }
      }
    ]);
  };

  const startRecall = () => {
    if (fiches.length === 0) return;
    setDeck(drawFiches(fiches));
    setPlace(0);
    setPane('recall');
  };

  if (backRef) {
    backRef.current = () => {
      if (pane === 'list') return false;
      setPane('list');
      return true;
    };
  }

  if (booting) {
    return <View style={styles.card} />;
  }

  if (pane === 'recall') {
    const current = deck[place];
    const done = !current;
    return (
      <View style={styles.card}>
        <TouchableOpacity onPress={() => setPane('list')}>
          <Text style={styles.link}>Toutes les fiches</Text>
        </TouchableOpacity>
        {done ? (
          <View style={styles.block}>
            <Text style={styles.help}>
              C'est le tour. Les mêmes idées peuvent revenir dans un autre ordre.
            </Text>
            <TouchableOpacity onPress={startRecall} style={styles.primary}>
              <Text style={styles.primaryText}>Tirer à nouveau</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.block}>
            <Text style={styles.count}>
              {place + 1} / {deck.length}
            </Text>
            <Text style={styles.idea}>{current.text}</Text>
            <TouchableOpacity
              onPress={() => setPlace((prev) => prev + 1)}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>
                {place + 1 >= deck.length ? 'Terminer' : 'Suivante'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  if (pane === 'edit') {
    const lines = ficheLineCount(draft);
    return (
      <View style={styles.card}>
        <TouchableOpacity onPress={() => setPane('list')}>
          <Text style={styles.link}>Toutes les fiches</Text>
        </TouchableOpacity>
        <Text style={styles.label}>L'idée</Text>
        <TextInput
          style={[styles.input, styles.ideaInput]}
          multiline
          value={draft}
          onChangeText={changeDraft}
          placeholder={'Une idée, en quelques lignes.\nCe qui se passe dans la tête.'}
          placeholderTextColor="#64748b"
          textAlignVertical="top"
        />
        <Text style={styles.help}>
          {lines} / {FICHE_LINE_LIMIT} lignes
        </Text>
        <TouchableOpacity onPress={save} style={styles.primary}>
          <Text style={styles.primaryText}>Enregistrer</Text>
        </TouchableOpacity>
        {editingId && (
          <TouchableOpacity
            onPress={() => {
              const fiche = fiches.find((item) => item.id === editingId);
              if (fiche) confirmRemove(fiche);
            }}
            style={styles.remove}
          >
            <Text style={styles.primaryText}>Supprimer</Text>
          </TouchableOpacity>
        )}
        {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.help}>
        Une fiche est une idée, en dix lignes au plus. Le tirage au sort les rappelle, une après l'autre.
      </Text>
      <TouchableOpacity onPress={openNew} style={styles.primary}>
        <Text style={styles.primaryText}>Nouvelle fiche</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={startRecall}
        disabled={fiches.length === 0}
        style={fiches.length === 0 ? styles.secondaryMuted : styles.secondary}
      >
        <Text style={styles.secondaryText}>
          {fiches.length === 0 ? 'Ajoute une fiche pour la tirer' : 'Tirer au sort'}
        </Text>
      </TouchableOpacity>
      {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      {fiches.length === 0 && <Text style={styles.help}>Aucune fiche pour l'instant.</Text>}
      {fiches.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.label}>Filtrer</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Un mot du titre ou du texte"
            placeholderTextColor="#64748b"
            autoCorrect={false}
          />
          <Text style={styles.label}>Ordre</Text>
          <View style={styles.orderRow}>
            {ORDER_OPTIONS.map((option) => {
              const active = option.id === order;
              return (
                <TouchableOpacity
                  key={option.id}
                  onPress={() => setOrder(option.id)}
                  style={active ? styles.orderOn : styles.orderOff}
                >
                  <Text style={active ? styles.orderOnText : styles.orderOffText}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.help}>
            {query.trim().length > 0
              ? `${shown.length} sur ${fiches.length}`
              : `${shown.length} fiche${shown.length > 1 ? 's' : ''}`}
          </Text>
        </View>
      )}
      {fiches.length > 0 && shown.length === 0 && (
        <Text style={styles.help}>Aucune fiche ne correspond à ce filtre.</Text>
      )}
      {shown.map((fiche) => {
        const preview = fichePreview(fiche.text);
        return (
          <TouchableOpacity
            key={fiche.id}
            style={styles.card}
            onPress={() => openEdit(fiche)}
            activeOpacity={0.85}
          >
            <Text style={styles.title}>{ficheTitle(fiche.text)}</Text>
            <Text style={styles.date}>{ficheDateLabel(fiche)}</Text>
            {preview.length > 0 && (
              <Text style={styles.help} numberOfLines={2}>
                {preview}
              </Text>
            )}
            <View style={styles.row}>
              <TouchableOpacity onPress={() => openEdit(fiche)} style={styles.modifyBtn}>
                <Text style={styles.smallText}>Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmRemove(fiche)} style={styles.removeBtn}>
                <Text style={styles.smallText}>Supprimer</Text>
              </TouchableOpacity>
            </View>
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
  block: {
    gap: 14
  },
  title: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700'
  },
  date: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '600'
  },
  idea: {
    color: '#f8fafc',
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600'
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
  count: {
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
    fontSize: 16
  },
  ideaInput: {
    minHeight: 180,
    textAlignVertical: 'top'
  },
  row: {
    flexDirection: 'row',
    gap: 8
  },
  orderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  orderOn: {
    backgroundColor: '#4338ca',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  orderOff: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  orderOnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700'
  },
  orderOffText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700'
  },
  primary: {
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
  secondaryMuted: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  secondaryText: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  remove: {
    backgroundColor: '#7f1d1d',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12
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
  smallText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700'
  },
  status: {
    color: '#c4b5fd',
    fontSize: 13,
    lineHeight: 18
  }
});
