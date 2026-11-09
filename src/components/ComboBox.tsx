import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet
} from 'react-native';

export interface ComboOption {
  id: string;
  label: string;
}

interface ComboBoxProps {
  value: string;
  options: ComboOption[];
  onChange: (id: string) => void;
  placeholder?: string;
}

export const ComboBox: React.FC<ComboBoxProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Choose'
}) => {
  const [open, setOpen] = useState<boolean>(false);
  const selected = options.find((option) => option.id === value);

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen((prev) => !prev)}
        style={styles.field}
      >
        <Text style={styles.value} numberOfLines={1}>
          {selected?.label || placeholder}
        </Text>
        <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.menu}>
          {options.map((option, index) => {
            const active = option.id === value;
            return (
              <TouchableOpacity
                key={option.id}
                onPress={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                style={[styles.option, index > 0 && styles.optionDivider, active && styles.optionOn]}
              >
                <Text style={[styles.optionText, active && styles.optionTextOn]} numberOfLines={1}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  value: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600'
  },
  chevron: {
    color: '#94a3b8',
    fontSize: 12,
    marginLeft: 8
  },
  menu: {
    marginTop: 4,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    overflow: 'hidden'
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  optionDivider: {
    borderTopWidth: 1,
    borderTopColor: '#1e293b'
  },
  optionOn: {
    backgroundColor: 'rgba(99, 102, 241, 0.22)'
  },
  optionText: {
    color: '#e2e8f0',
    fontSize: 14
  },
  optionTextOn: {
    color: '#e0e7ff',
    fontWeight: '700'
  }
});
