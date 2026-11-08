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
import { LlmLink } from '../types';
import { DEFAULT_LLM_LINKS } from '../storage/settingsStorage';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  links: LlmLink[];
  onChangeLinks: (links: LlmLink[]) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  links,
  onChangeLinks
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [url, setUrl] = useState<string>('');

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
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>⚙️ LLM & Notebook Links</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.sectionBox}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>Add / Edit Link</Text>
                <TouchableOpacity
                  onPress={() => {
                    onChangeLinks([...DEFAULT_LLM_LINKS]);
                    resetForm();
                  }}
                  style={styles.resetBtn}
                >
                  <Text style={styles.resetBtnText}>↺ Reset Defaults</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Gemini Rozensweig Notebook"
                placeholderTextColor="#64748b"
                value={title}
                onChangeText={setTitle}
              />

              <Text style={styles.fieldLabel}>Address</Text>
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
                    {editingId ? '💾 Update Link' : '➕ Add Link'}
                  </Text>
                </TouchableOpacity>

                {editingId && (
                  <TouchableOpacity
                    onPress={resetForm}
                    style={styles.cancelEditBtn}
                  >
                    <Text style={styles.cancelEditBtnText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Configured Links List */}
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
    borderColor: '#334155'
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700'
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


