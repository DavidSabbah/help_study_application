import React, { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { useI18n } from '../i18n/I18n';

type Pane = 'list' | 'edit' | 'recall';

interface FicheScreenProps {
  initial?: FichePlace;
  onPlace?: (place: FichePlace) => void;
  backRef?: MutableRefObject<(() => boolean) | null>;
}

function clipDraft(value: string): string {
  return value.replace(/\r\n/g, '\n').split('\n').slice(0, FICHE_LINE_LIMIT).join('\n');
}

function formatWhen(ms: number, locale: string): string {
  const date = new Date(ms);
  const day = date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${day} · ${time}`;
}

function ficheDateLabel(
  fiche: Fiche,
  locale: string,
  edited: (created: string, updated: string) => string
): string {
  const created = formatWhen(fiche.createdAt, locale);
  if (fiche.updatedAt - fiche.createdAt > 60_000) {
    return edited(created, formatWhen(fiche.updatedAt, locale));
  }
  return created;
}

type FicheOrder = 'recent' | 'ancien' | 'modifie' | 'az' | 'za';

const ORDER_OPTIONS: { id: FicheOrder; labelKey: 'fiche.recent' | 'fiche.old' | 'fiche.edited' | 'fiche.az' | 'fiche.za' }[] = [
  { id: 'recent', labelKey: 'fiche.recent' },
  { id: 'ancien', labelKey: 'fiche.old' },
  { id: 'modifie', labelKey: 'fiche.edited' },
  { id: 'az', labelKey: 'fiche.az' },
  { id: 'za', labelKey: 'fiche.za' }
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

function sortFiches(list: Fiche[], order: FicheOrder, locale: string): Fiche[] {
  const next = [...list];
  next.sort((a, b) => {
    if (order === 'recent') return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
    if (order === 'ancien') return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    if (order === 'modifie') return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    const cmp = ficheTitle(a.text).localeCompare(ficheTitle(b.text), locale, { sensitivity: 'base' });
    return order === 'az' ? cmp || a.id.localeCompare(b.id) : -cmp || a.id.localeCompare(b.id);
  });
  return next;
}

export const FicheScreen: React.FC<FicheScreenProps> = ({ initial, onPlace, backRef }) => {
  const { t, locale } = useI18n();
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
    () => sortFiches(fiches.filter((fiche) => matchesQuery(fiche, query)), order, locale),
    [fiches, query, order, locale]
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
      setStatus(t('fiche.lineLimit', { max: FICHE_LINE_LIMIT }));
    }
  };

  const save = async () => {
    const saved = await saveFiche(editingId, draft);
    if (!saved) {
      setStatus(t('fiche.needIdea'));
      return;
    }
    setStatus(editingId ? t('fiche.saved') : t('fiche.added'));
    setEditingId(saved.id);
    setDraft(saved.text);
    await reload();
  };

  const confirmRemove = (fiche: Fiche) => {
    Alert.alert(t('fiche.deleteTitle'), t('fiche.deleteBody'), [
      { text: t('fiche.cancel'), style: 'cancel' },
      {
        text: t('fiche.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteFiche(fiche.id);
          if (editingId === fiche.id) {
            setEditingId(null);
            setDraft('');
            setPane('list');
          }
          setStatus(t('fiche.deleted'));
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
          <Text style={styles.link}>{t('fiche.all')}</Text>
        </TouchableOpacity>
        {done ? (
          <View style={styles.block}>
            <Text style={styles.help}>{t('fiche.recallDone')}</Text>
            <TouchableOpacity onPress={startRecall} style={styles.primary}>
              <Text style={styles.primaryText}>{t('fiche.drawAgain')}</Text>
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
                {place + 1 >= deck.length ? t('fiche.finish') : t('fiche.next')}
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
        <View style={styles.head}>
          <TouchableOpacity onPress={() => setPane('list')} style={styles.cardMain}>
            <Text style={styles.link}>{t('fiche.all')}</Text>
          </TouchableOpacity>
          {editingId && (
            <TouchableOpacity
              onPress={() => {
                const fiche = fiches.find((item) => item.id === editingId);
                if (fiche) confirmRemove(fiche);
              }}
              style={styles.iconBtn}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t('fiche.remove')}
            >
              <Ionicons name="trash-outline" size={18} color="#fca5a5" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.label}>{t('fiche.idea')}</Text>
        <TextInput
          style={[styles.input, styles.ideaInput]}
          multiline
          value={draft}
          onChangeText={changeDraft}
          placeholder={t('fiche.ideaPlaceholder')}
          placeholderTextColor="#64748b"
          textAlignVertical="top"
        />
        <Text style={styles.help}>{t('fiche.lines', { n: lines, max: FICHE_LINE_LIMIT })}</Text>
        <TouchableOpacity onPress={save} style={styles.primary}>
          <Text style={styles.primaryText}>{t('fiche.save')}</Text>
        </TouchableOpacity>
        {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.help}>{t('fiche.intro')}</Text>
      <TouchableOpacity onPress={openNew} style={styles.primary}>
        <Text style={styles.primaryText}>{t('fiche.new')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={startRecall}
        disabled={fiches.length === 0}
        style={fiches.length === 0 ? styles.secondaryMuted : styles.secondary}
      >
        <Text style={styles.secondaryText}>
          {fiches.length === 0 ? t('fiche.drawNeed') : t('fiche.draw')}
        </Text>
      </TouchableOpacity>
      {status.length > 0 && <Text style={styles.status}>{status}</Text>}
      {fiches.length === 0 && <Text style={styles.help}>{t('fiche.empty')}</Text>}
      {fiches.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.label}>{t('fiche.filter')}</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('fiche.filterPlaceholder')}
            placeholderTextColor="#64748b"
            autoCorrect={false}
          />
          <Text style={styles.label}>{t('fiche.order')}</Text>
          <View style={styles.orderRow}>
            {ORDER_OPTIONS.map((option) => {
              const active = option.id === order;
              return (
                <TouchableOpacity
                  key={option.id}
                  onPress={() => setOrder(option.id)}
                  style={active ? styles.orderOn : styles.orderOff}
                >
                  <Text style={active ? styles.orderOnText : styles.orderOffText}>{t(option.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.help}>
            {query.trim().length > 0
              ? t('fiche.countFiltered', { shown: shown.length, total: fiches.length })
              : t(shown.length > 1 ? 'fiche.countMany' : 'fiche.countOne', { n: shown.length })}
          </Text>
        </View>
      )}
      {fiches.length > 0 && shown.length === 0 && (
        <Text style={styles.help}>{t('fiche.noMatch')}</Text>
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
            <View style={styles.head}>
              <View style={styles.cardMain}>
                <Text style={styles.title}>{ficheTitle(fiche.text) || t('fiche.emptyTitle')}</Text>
                <Text style={styles.date}>
                  {ficheDateLabel(fiche, locale, (created, updated) =>
                    t('fiche.editedOn', { created, updated })
                  )}
                </Text>
              </View>
              <View style={styles.iconRow}>
                <TouchableOpacity
                  onPress={() => openEdit(fiche)}
                  style={styles.iconBtn}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('fiche.edit')}
                >
                  <Ionicons name="pencil-outline" size={18} color="#c7d2fe" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmRemove(fiche)}
                  style={styles.iconBtn}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('fiche.remove')}
                >
                  <Ionicons name="trash-outline" size={18} color="#fca5a5" />
                </TouchableOpacity>
              </View>
            </View>
            {preview.length > 0 && (
              <Text style={styles.help} numberOfLines={2}>
                {preview}
              </Text>
            )}
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
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8
  },
  cardMain: {
    flex: 1,
    gap: 4
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
  status: {
    color: '#c4b5fd',
    fontSize: 13,
    lineHeight: 18
  }
});
