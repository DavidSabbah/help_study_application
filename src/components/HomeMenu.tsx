import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useI18n } from '../i18n/I18n';

export interface HomeMenuItem {
  key: string;
  title: string;
  detail: string;
  meta?: string;
  onPress: () => void;
}

export const HomeMenu: React.FC<{ items: HomeMenuItem[] }> = ({ items }) => {
  const { t } = useI18n();
  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>{t('home.lead')}</Text>
      {items.map((item) => (
        <TouchableOpacity key={item.key} onPress={item.onPress} style={styles.card}>
          <View style={styles.copy}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.detail}>{item.detail}</Text>
          </View>
          {item.meta ? <Text style={styles.meta}>{item.meta}</Text> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 12
  },
  lead: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  copy: {
    flex: 1,
    gap: 4
  },
  title: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700'
  },
  detail: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18
  },
  meta: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '700'
  }
});
