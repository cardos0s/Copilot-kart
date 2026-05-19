import { Component, ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

type Props = {
  children: ReactNode;
  /** Nome do contexto pra debug — ex: "SessionScreen" */
  context?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Captura erros de render no React e mostra um fallback ao invés de matar
 * a tela inteira. Útil pra contornos onde uma sessão corrupta crasharia
 * tudo — preferimos exibir o erro num UI amigável.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', this.props.context ?? '', error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>Algo deu errado</Text>
            <Text style={styles.message}>
              {this.props.context
                ? `Erro carregando ${this.props.context}.`
                : 'Não foi possível carregar essa tela.'}
            </Text>
            <Text style={styles.errorText}>
              {this.state.error?.message ?? 'Erro desconhecido'}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: spacing.s,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.l,
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontFamily: 'Courier',
    textAlign: 'center',
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
