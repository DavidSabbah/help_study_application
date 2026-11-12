import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LlmLink } from '../types';
import { DEFAULT_LLM_LINKS } from '../storage/settingsStorage';
import { readDebugLog } from '../debug/debugLog';
import { useI18n } from '../i18n/I18n';
import { APP_LANGUAGES, languageOption } from '../i18n/languages';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  links: LlmLink[];
  onChangeLinks: (links: LlmLink[]) => void;
  preprocessEnabled: boolean;
  onChangePreprocess: (enabled: boolean) => void;
  onOpenLink: (link: LlmLink) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  links,
  onChangeLinks,
  preprocessEnabled,
  onChangePreprocess,
  onOpenLink
}) => {
  const { t, lang, followsPhone, phoneSupported, setAppLanguage, direction } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [url, setUrl] = useState<string>('');
  const [logNote, setLogNote] = useState<string>('');

  const copyLog = async () => {
    try {
      const text = await readDebugLog();
      await Clipboard.setStringAsync(text || t('settings.logEmpty'));
      setLogNote(text ? t('settings.logCopied') : t('settings.logEmpty'));
    } catch (err) {
      setLogNote(err instanceof Error ? err.message : t('settings.logCopyFailed'));
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setUrl('');
  };

  const getAutoIcon = (linkUrl: string, linkTitle: string): string => {
    const lowerUrl = linkUrl.toLowerCase();
    const lowerTitle = linkTitle.toLowerCase();
    if (lowerUrl.includes('chatgpt.com') || lowerTitle.includes('chatgpt')) {
      return '💬';
    }
    if (lowerUrl.includes('notebook') || lowerTitle.includes('notebook')) {
      return '📓';
    }
    if (lowerUrl.includes('gemini.google.com') || lowerTitle.includes('gemini')) {
      return '✨';
    }
    return '🔗';
  };

  const handleSaveLink = () => {
    const cleanTitle = title.trim();
    const cleanUrl = url.trim();
    if (!cleanTitle || !cleanUrl) return;

    const autoIcon = getAutoIcon(cleanUrl, cleanTitle);

    if (editingId) {
      const updated = links.map((item) =>
        item.id === editingId
          ? { ...item, icon: autoIcon, title: cleanTitle, url: cleanUrl, desc: '' }
          : item
      );
      onChangeLinks(updated);
    } else {
      const newLink: LlmLink = {
        id: `link-${Date.now()}`,
        icon: autoIcon,
        title: cleanTitle,
        url: cleanUrl,
        desc: ''
      };
      onChangeLinks([...links, newLink]);
    }
    resetForm();
  };

  const handleEdit = (item: LlmLink) => {
    setEditingId(item.id);
    setTitle(item.title);
    setUrl(item.url);
  };

  const handleDelete = (id: string) => {
    onChangeLinks(links.filter((l) => l.id !== id));
    if (editingId === id) resetForm();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { direction }]}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>⚙️ {t('settings.title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.sectionBox}>
              <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
              <View style={styles.langRow}>
                {APP_LANGUAGES.map((item) => {
                  const active = item.code === lang;
                  return (
                    <TouchableOpacity
                      key={item.code}
                      onPress={() => {
                        if (followsPhone && item.code === lang) return;
                        setAppLanguage(item.code);
                      }}
                      style={[styles.langChip, active && styles.langChipOn]}
                    >
                      <Text style={[styles.langChipText, active && styles.langChipTextOn]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {followsPhone && (
                <Text style={styles.optionHint}>
                  {phoneSupported
                    ? t('settings.usingPhone', { language: languageOption(lang).label })
                    : t('settings.phoneUnsupported', { language: languageOption(lang).label })}
                </Text>
              )}
              {!followsPhone && (
                <TouchableOpacity onPress={() => setAppLanguage('system')} style={styles.resetBtn}>
                  <Text style={styles.resetBtnText}>{t('settings.usePhone')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.sectionBox, styles.sectionGap]}>
              <Text style={styles.sectionTitle}>{t('settings.journal')}</Text>
              <Text style={styles.optionHint}>{t('settings.journalHint')}</Text>
              <TouchableOpacity onPress={copyLog} style={styles.resetBtn}>
                <Text style={styles.resetBtnText}>{t('settings.copyLog')}</Text>
              </TouchableOpacity>
              {logNote.length > 0 && <Text style={styles.optionHint}>{logNote}</Text>}
            </View>

            <View style={[styles.sectionBox, styles.sectionGap]}>
              <View style={styles.optionRow}>
                <View style={styles.optionCopy}>
                  <Text style={styles.sectionTitle}>{t('settings.preprocess')}</Text>
                  <Text style={styles.optionHint}>{t('settings.preprocessHint')}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => onChangePreprocess(!preprocessEnabled)}
                  style={[styles.toggle, preprocessEnabled && styles.toggleOn]}
                >
                  <Text style={styles.toggleText}>
                    {preprocessEnabled ? t('settings.on') : t('settings.off')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.sectionBox, styles.sectionGap]}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>{t('settings.links')}</Text>
                <TouchableOpacity
                  onPress={() => {
                    onChangeLinks([...DEFAULT_LLM_LINKS]);
                    resetForm();
                  }}
                  style={styles.resetBtn}
                >
                  <Text style={styles.resetBtnText}>{t('settings.reset')}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>{t('settings.titleField')}</Text>
              <TextInput
                style={styles.input}
                placeholder="Gemini Rozensweig Notebook"
                placeholderTextColor="#64748b"
                value={title}
                onChangeText={setTitle}
              />

              <Text style={styles.fieldLabel}>{t('settings.address')}</Text>
              <TextInput
                style={styles.input}
                placeholder="https://notebook.google.com/notebook/4cc82aec-e02c-48ef-b2e9-c37f95e05fd1"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                keyboardType="url"
                value={url}
                onChangeText={setUrl}
              />

              <View style={styles.formButtonsRow}>
                <TouchableOpacity
                  onPress={handleSaveLink}
                  style={styles.saveLinkBtn}
                >
                  <Text style={styles.saveLinkBtnText}>
                    {editingId ? t('settings.updateLink') : t('settings.addLink')}
                  </Text>
                </TouchableOpacity>

                {editingId && (
                  <TouchableOpacity
                    onPress={resetForm}
                    style={styles.cancelEditBtn}
                  >
                    <Text style={styles.cancelEditBtnText}>{t('settings.cancel')}</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={{ marginTop: 16, gap: 8 }}>
                {links.map((item) => (
                  <View key={item.id} style={styles.linkRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.linkRowTitle} numberOfLines={1}>
                        {item.icon} {item.title}
                      </Text>
                      <Text style={styles.linkRowUrl} numberOfLines={1}>
                        {item.url}
                      </Text>
                    </View>
                    <View style={styles.linkRowActions}>
                      <TouchableOpacity
                        onPress={() => onOpenLink(item)}
                        style={styles.smallBtn}
                      >
                        <Text style={styles.smallBtnText}>{t('settings.open')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleEdit(item)}
                        style={styles.smallBtn}
                      >
                        <Text style={styles.smallBtnText}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(item.id)}
                        style={[styles.smallBtn, styles.dangerBtn]}
                      >
                        <Text style={styles.dangerBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    justifyContent: 'flex-end'
  },
  sheet: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#334155'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700'
  },
  closeBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8
  },
  closeBtnText: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  sectionBox: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  langChip: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  langChipOn: {
    backgroundColor: '#4338ca',
    borderColor: '#4338ca'
  },
  langChipText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700'
  },
  langChipTextOn: {
    color: '#ffffff'
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  sectionGap: {
    marginTop: 10
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700'
  },
  optionHint: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
    marginBottom: 8
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  optionCopy: {
    flex: 1
  },
  toggle: {
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 52,
    alignItems: 'center'
  },
  toggleOn: {
    backgroundColor: '#10b981'
  },
  toggleText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800'
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4
  },
  resetBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155'
  },
  resetBtnText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600'
  },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 10
  },
  formButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2
  },
  saveLinkBtn: {
    flex: 1,
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center'
  },
  saveLinkBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13
  },
  cancelEditBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center'
  },
  cancelEditBtnText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600'
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  linkRowTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 13
  },
  linkRowUrl: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2
  },
  linkRowActions: {
    flexDirection: 'row',
    gap: 4
  },
  smallBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6
  },
  smallBtnText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700'
  },
  dangerBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)'
  },
  dangerBtnText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '700'
  }
});


