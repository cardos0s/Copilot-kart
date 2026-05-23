import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChatMessage,
  clearChatThread,
  continueAiChat,
  isAiEnabled,
  loadChatThread,
  refreshAiEnabled,
  requestAiAnalysis,
} from '../src/lib/aiAnalysis';
import { CoachContext, loadCoachContext } from '../src/lib/coachContext';
import { ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

function fmtLap(ms: number) {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = totalS - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; context: CoachContext }
  | { kind: 'missing' }
  | { kind: 'too-short' }
  | { kind: 'error'; message: string };

export default function CoachScreen() {
  const router = useRouter();
  const { sessionId, lapId } = useLocalSearchParams<{
    sessionId?: string;
    lapId?: string;
  }>();
  const cacheKey = sessionId && lapId ? `${sessionId}:${lapId}` : null;

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpInput, setFollowUpInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(isAiEnabled());
  const scrollRef = useRef<ScrollView | null>(null);

  // Carrega context + thread persistida em paralelo. Thread vem instantânea
  // (DB local rápido), context demora um pouco mais (processa GPS).
  useEffect(() => {
    if (!sessionId || !lapId || !cacheKey) {
      setLoadState({
        kind: 'error',
        message: 'Faltando sessionId ou lapId na URL.',
      });
      return;
    }
    refreshAiEnabled().then(setAiOn);
    loadChatThread(cacheKey).then(setMessages);
    (async () => {
      const result = await loadCoachContext(sessionId, lapId);
      if (result.kind === 'ok') {
        setLoadState({ kind: 'ok', context: result.context });
      } else if (result.kind === 'no-session' || result.kind === 'no-lap') {
        setLoadState({ kind: 'missing' });
      } else if (result.kind === 'too-short') {
        setLoadState({ kind: 'too-short' });
      } else {
        setLoadState({ kind: 'error', message: result.error.message });
      }
    })();
  }, [sessionId, lapId, cacheKey]);

  // Auto-scroll pro fim quando aparecem mensagens novas.
  useEffect(() => {
    if (messages.length > 1) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length, followUpLoading]);

  const errMessageFor = (code: string | undefined, fallback: string) =>
    code === 'no_key'
      ? 'Coach IA não configurado. Cola sua API key em Ajustes / Coach IA.'
      : code === 'unauthorized'
        ? 'API key inválida. Confere no console do provider ou cola uma nova em Ajustes.'
        : code === 'rate_limited'
          ? 'Limite de uso atingido. Tenta de novo em alguns minutos.'
          : code === 'network'
            ? 'Sem internet. Conecta no Wi-Fi/4G e tenta de novo.'
            : code === 'no_thread'
              ? 'A conversa expirou. Pede a análise de novo.'
              : fallback;

  const handleAnalyze = async () => {
    if (loadState.kind !== 'ok' || !cacheKey) return;
    setAnalyzing(true);
    setError(null);
    try {
      await requestAiAnalysis(
        {
          analysis: loadState.context.analysis,
          lapDurationMs: loadState.context.lap.durationMs,
          referenceDurationMs: loadState.context.refDurationMs,
          trackName: loadState.context.trackName,
          pilot: loadState.context.pilot,
          history: loadState.context.history,
        },
        { cacheKey, sessionId: sessionId!, lapId: lapId! }
      );
      const next = await loadChatThread(cacheKey);
      setMessages(next);
      setAiOn(true);
    } catch (err: any) {
      const code = err?.code;
      setError(errMessageFor(code, err?.message ?? 'Erro desconhecido.'));
      if (code === 'no_key') setAiOn(false);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSendFollowUp = async () => {
    if (!cacheKey) return;
    const text = followUpInput.trim();
    if (!text || followUpLoading) return;
    setFollowUpInput('');
    setError(null);
    setFollowUpLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    try {
      await continueAiChat({
        cacheKey,
        userMessage: text,
        sessionId: sessionId!,
        lapId: lapId!,
      });
      const next = await loadChatThread(cacheKey);
      setMessages(next);
    } catch (err: any) {
      const code = err?.code;
      setError(errMessageFor(code, err?.message ?? 'Erro desconhecido.'));
      const next = await loadChatThread(cacheKey);
      setMessages(next);
      setFollowUpInput(text);
    } finally {
      setFollowUpLoading(false);
    }
  };

  const handleResetChat = () => {
    if (!cacheKey) return;
    Alert.alert(
      'Apagar conversa?',
      'A análise e todas as perguntas dessa volta serão removidas. Você pode pedir nova análise depois.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            await clearChatThread(cacheKey);
            setMessages([]);
            setError(null);
            setFollowUpInput('');
          },
        },
      ]
    );
  };

  // Skipa o 1º item (prompt estruturado interno).
  const visibleMessages = messages.slice(1);
  const hasConversation = visibleMessages.length > 0;

  if (loadState.kind === 'loading') {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (loadState.kind !== 'ok') {
    const title =
      loadState.kind === 'missing'
        ? 'Volta não encontrada'
        : loadState.kind === 'too-short'
          ? 'Dados insuficientes'
          : 'Erro ao carregar';
    const body =
      loadState.kind === 'missing'
        ? 'A sessão ou volta referenciada não existe mais.'
        : loadState.kind === 'too-short'
          ? 'A volta tem poucos pontos GPS pra análise.'
          : (loadState as any).message;
    return (
      <View style={s.root}>
        <ScreenHeader title="COACH IA" onBack={() => router.back()} />
        <View style={[s.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={s.errorTitle}>{title}</Text>
          <Text style={s.errorBody}>{body}</Text>
        </View>
      </View>
    );
  }

  const ctx = loadState.context;
  const headerSubtitle = `${ctx.trackName} · ${fmtLap(ctx.lap.durationMs)}`;

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <ScreenHeader
        title="COACH IA"
        subtitle={headerSubtitle}
        onBack={() => router.back()}
        rightAction={
          hasConversation ? (
            <Pressable onPress={handleResetChat} hitSlop={8}>
              <Text style={s.headerAction}>Apagar</Text>
            </Pressable>
          ) : null
        }
      />

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {(ctx.pilot || ctx.history) && (
          <View style={s.chips}>
            {ctx.pilot && (
              <View style={s.chip}>
                <Text style={s.chipText}>
                  Personalizado pra {ctx.pilot.nickname?.trim() || ctx.pilot.name.split(' ')[0]}
                </Text>
              </View>
            )}
            {ctx.history && (
              <View style={s.chip}>
                <Text style={s.chipText}>
                  {ctx.history.sessionsCount} sessão{ctx.history.sessionsCount > 1 ? 'ões' : ''} anterior{ctx.history.sessionsCount > 1 ? 'es' : ''} considerada{ctx.history.sessionsCount > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {!hasConversation && !analyzing && (
          <View style={s.intro}>
            <Text style={s.introTitle}>Nova análise</Text>
            <Text style={s.introBody}>
              Vou comparar essa volta com a referência da pista e te apontar onde dá pra
              ganhar tempo. Depois você pode me perguntar mais sobre qualquer setor.
            </Text>
            <Pressable
              onPress={handleAnalyze}
              disabled={!aiOn}
              style={({ pressed }) => [
                s.analyzeBtn,
                !aiOn && { opacity: 0.5 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={s.analyzeBtnText}>Pedir análise da IA</Text>
            </Pressable>
            {!aiOn && (
              <Text style={s.warnText}>
                IA não configurada. Vai em Ajustes / Coach IA pra escolher provider e colar a key.
              </Text>
            )}
          </View>
        )}

        {analyzing && (
          <View style={s.center}>
            <ActivityIndicator color={colors.accentPurple} />
            <Text style={s.thinkingText}>Analisando volta…</Text>
          </View>
        )}

        {hasConversation && (
          <View style={s.thread}>
            {visibleMessages.map((m, idx) => (
              <View
                key={idx}
                style={[
                  s.bubble,
                  m.role === 'assistant' ? s.bubbleAssistant : s.bubbleUser,
                ]}
              >
                <Text
                  style={[s.bubbleText, m.role === 'user' && s.bubbleTextUser]}
                >
                  {m.content}
                </Text>
              </View>
            ))}
            {followUpLoading && (
              <View style={[s.bubble, s.bubbleAssistant, s.bubbleLoading]}>
                <ActivityIndicator color={colors.accentPurple} size="small" />
                <Text style={s.thinkingText}>Pensando…</Text>
              </View>
            )}
          </View>
        )}

        {error && (
          <View style={s.error}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {hasConversation && (
        <View style={s.inputBar}>
          <TextInput
            value={followUpInput}
            onChangeText={setFollowUpInput}
            placeholder="Pergunta algo sobre a volta…"
            placeholderTextColor={colors.textMuted}
            style={s.input}
            editable={!followUpLoading && aiOn}
            multiline
            onSubmitEditing={handleSendFollowUp}
            returnKeyType="send"
            blurOnSubmit
          />
          <Pressable
            onPress={handleSendFollowUp}
            disabled={!followUpInput.trim() || followUpLoading || !aiOn}
            style={({ pressed }) => [
              s.sendBtn,
              (!followUpInput.trim() || followUpLoading || !aiOn) && { opacity: 0.4 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={s.sendBtnText}>Enviar</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.l, paddingBottom: spacing.xl, gap: spacing.m },

  headerAction: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: spacing.s,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: colors.primaryGlow,
    borderWidth: 1,
    borderColor: colors.primary + '66',
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chipText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  intro: {
    padding: spacing.l,
    borderRadius: radius.l,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  introTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: spacing.s,
  },
  introBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.l,
  },
  analyzeBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.accentPurple,
    alignItems: 'center',
  },
  analyzeBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  warnText: {
    color: colors.warning,
    fontSize: 12,
    marginTop: spacing.m,
    lineHeight: 17,
  },

  thread: { gap: spacing.s },
  bubble: {
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.m,
    borderRadius: 12,
    maxWidth: '88%',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentPurple + '55',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
  },
  bubbleText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  bubbleTextUser: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
  bubbleLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
  },
  thinkingText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 8,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s,
    padding: spacing.l,
    paddingTop: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  sendBtn: {
    paddingHorizontal: spacing.m,
    height: 44,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.accentPurple,
  },
  sendBtnText: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },

  error: {
    padding: spacing.m,
    borderRadius: 12,
    backgroundColor: 'rgba(255,71,87,0.1)',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },

  errorTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.m,
    lineHeight: 20,
  },
});
