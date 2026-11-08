import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Share
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LlmLink } from '../types';

interface LlmPopupModalProps {
  visible: boolean;
  onClose: () => void;
  links: LlmLink[];
  promptText: string;
  onOpenSettings: () => void;
}

export const LlmPopupModal: React.FC<LlmPopupModalProps> = ({
  visible,
  onClose,
  links,
  promptText,
  onOpenSettings
}) => {
  const [copiedBanner, setCopiedBanner] = useState<string>(
    '✅ Copied to clipboard! Tap any link below and Paste.'
  );

  const handleCopy = async () => {
    await Clipboard.setStringAsync(promptText);
    setCopiedBanner('✅ Freshly copied to clipboard!');
  };

  const handleOpenLink = async (url: string) => {
    await Clipboard.setStringAsync(promptText);
    try {
      await Linking.openURL(url);
    } catch {
      // Ignore if URL cannot be opened
    }
  };

  const handleNativeShare = async () => {
    await Clipboard.setStringAsync(promptText);
    try {
      await Share.share({
        message: promptText
      });
    } catch {
      // Ignore user cancel
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Choose LLM to Help You Study</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.copyBadge}>
            <Text style={styles.copyBadgeText}>{copiedBanner}</Text>
            <TouchableOpacity onPress={handleCopy} style={styles.reCopyBtn}>
              <Text style={styles.reCopyBtnText}>📋 Copy</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 8 }}>
              {links.map((item) => {
                const isNotebook =
                  item.url.includes('notebooklm') ||
                  item.icon === '📓' ||
                  item.icon === '📘';

                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => handleOpenLink(item.url)}
                    style={[
                      styles.linkCard,
                      isNotebook && styles.notebookHighlight
                    ]}
                  >
                    <View style={styles.linkIconBox}>
                      <Text style={{ fontSize: 20 }}>{item.icon || '🤖'}</Text>
                    </View>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.linkTitle}>{item.title}</Text>
                      <Text style={styles.linkDesc} numberOfLines={1}>
                        {item.desc || item.url}
                      </Text>
                    </View>
                    <Text style={styles.openArrow}>Open ↗</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footerRow}>
            <TouchableOpacity
              onPress={handleNativeShare}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>📲 Share Sheet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onOpenSettings}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>⚙️ Edit Links</Text>
            </TouchableOpacity>
          </View>
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
    fontSize: 17,
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
  copyBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  copyBadgeText: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    marginRight: 8
  },
  reCopyBtn: {
    backgroundColor: '#065f46',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  reCopyBtnText: {
    color: '#ecfdf5',
    fontSize: 12,
    fontWeight: '700'
  },
  linkCard: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center'
  },
  notebookHighlight: {
    borderColor: 'rgba(56, 189, 248, 0.5)',
    backgroundColor: 'rgba(56, 189, 248, 0.08)'
  },
  linkIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  linkTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14
  },
  linkDesc: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2
  },
  openArrow: {
    color: '#38bdf8',
    fontWeight: '700',
    fontSize: 13
  },
  footerRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center'
  },
  secondaryBtnText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600'
  }
});

