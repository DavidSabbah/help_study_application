import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { debugLog } from './debugLog';

interface State {
  message: string;
}

export class AppCrashBoundary extends React.Component<
  React.PropsWithChildren,
  State
> {
  state: State = { message: '' };

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void debugLog('error', 'render', error.message, info.componentStack || error.stack);
    this.setState({ message: error.message || 'The screen crashed.' });
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <View style={styles.box}>
        <Text style={styles.title}>L'écran a planté</Text>
        <Text style={styles.body}>{this.state.message}</Text>
        <Text style={styles.hint}>
          Le journal est dans les réglages. Copie-le pour qu'on voie ce qui s'est passé.
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    justifyContent: 'center',
    gap: 12
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700'
  },
  body: {
    color: '#fecaca',
    fontSize: 15,
    lineHeight: 22
  },
  hint: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20
  }
});
