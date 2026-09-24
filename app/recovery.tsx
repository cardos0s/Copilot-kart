/**
 * Recuperação de uma gravação interrompida (REC-02 a REC-04), antes da home.
 *
 * Chega aqui pela abertura do app (o `AuthGate` do layout raiz) ou ao tentar
 * gravar com uma gravação ainda não resolvida. Três estados:
 *   - recuperável: pista, horário de início e voltas, com "Recuperar" e "Descartar";
 *   - sem volta completa: só "Descartar";
 *   - ilegível: o diário já foi apagado, só avisa.
 * O voltar do Android fica bloqueado até o piloto escolher.
 */
import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card } from '../src/components/ui';
import { runBootCheck } from '../src/recording/bootCheck';
import { runPostSaveEffects } from '../src/recording/postSave';
import { discard, recover, type RecoverySummary } from '../src/recording/recovery';
import { bootCheckDeps, postSaveDeps, recoveryDeps } from '../src/recording/runtime';
import { getLayout } from '../src/storage/db';
import { colors, fonts, spacing, typography } from '../src/theme';

const NO_LAPS = 'Nenhuma volta completa para recuperar';
const UNREADABLE = 'Não consegui ler a gravação interrompida';
const SAVE_ERROR =
  'Não consegui salvar a sessão. Ela fica guardada e o app oferece recuperar na próxima abertura.';

type Screen =
  | { kind: 'loading' }
  | { kind: 'recoverable'; summary: RecoverySummary }
  | { kind: 'no-laps'; summary: RecoverySummary }
  | { kind: 'unreadable' };

function fmtStart(ts: number) {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Recovery() {
  const params = useLocalSearchParams<{ unreadable?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Ilegível na abertura: a checagem já apagou o diário.
      if (params.unreadable === '1') {
        setScreen({ kind: 'unreadable' });
        return;
      }
      // Aqui nenhuma tela de gravação está montada, então vale a mesma
      // checagem da abertura: sessão já salva é limpa em silêncio.
      const r = await runBootCheck(bootCheckDeps).catch(() => ({ kind: 'none' }) as const);
      if (r.kind === 'unreadable') setScreen({ kind: 'unreadable' });
      else if (r.kind === 'interrupted') {
        setScreen({
          kind: r.summary.laps === 0 ? 'no-laps' : 'recoverable',
          summary: r.summary,
        });
      } else router.replace('/');
    })();
  }, [params.unreadable, router]);

  // Sem escolha, o voltar do Android não tira o piloto daqui.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const handleRecover = async (summary: RecoverySummary) => {
    setBusy(true);
    setError(null);
    try {
      const r = await recover(summary.recordingId, recoveryDeps);
      if ('sessionId' in r) {
        // XP, PB, conquistas e desafios; sem IA nem leaderboard.
        await runPostSaveEffects(r.saved.session, r.saved.laps, { fromRecovery: true }, postSaveDeps);
        router.replace(`/session/${r.sessionId}`);
      } else {
        const layout = await getLayout(r.layoutId);
        router.replace({
          pathname: '/track-layouts-picker' as any,
          params: { trackId: layout?.trackId ?? '', trackName: summary.trackName },
        });
      }
    } catch (e) {
      console.warn('[recovery] falha ao recuperar:', e);
      setError(SAVE_ERROR);
      setBusy(false);
    }
  };

  const handleDiscard = async (summary: RecoverySummary) => {
    setBusy(true);
    try {
      await discard(summary.recordingId, recoveryDeps);
    } catch (e) {
      console.warn('[recovery] falha ao descartar:', e);
    }
    router.replace('/');
  };

  return (
    <View style={[s.root, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
      <Text style={s.kicker}>GRAVAÇÃO INTERROMPIDA</Text>

      {screen.kind === 'loading' && <Text style={s.body}>Procurando a gravação…</Text>}

      {screen.kind === 'unreadable' && (
        <>
          <Text style={s.title}>{UNREADABLE}</Text>
          <Text style={s.body}>Os dados guardados foram descartados.</Text>
          <View style={s.actions}>
            <Button label="OK" onPress={() => router.replace('/')} size="l" fullWidth />
          </View>
        </>
      )}

      {(screen.kind === 'recoverable' || screen.kind === 'no-laps') && (
        <>
          <Text style={s.title}>
            {screen.summary.mode === 'reference'
              ? 'O reconhecimento do traçado parou no meio'
              : 'A sessão parou no meio'}
          </Text>

          <Card padding="l" style={s.card}>
            <Row label="PISTA" value={screen.summary.trackName} />
            <Row label="INÍCIO" value={fmtStart(screen.summary.startedAt)} />
            <Row label="VOLTAS COMPLETAS" value={String(screen.summary.laps)} />
          </Card>

          {screen.kind === 'no-laps' && <Text style={s.notice}>{NO_LAPS}</Text>}
          {error && <Text style={s.error}>{error}</Text>}

          <View style={s.actions}>
            {screen.kind === 'recoverable' && (
              <Button
                label="Recuperar"
                onPress={() => handleRecover(screen.summary)}
                size="l"
                fullWidth
                loading={busy}
                disabled={busy}
              />
            )}
            <Button
              label="Descartar"
              onPress={() => handleDiscard(screen.summary)}
              variant={screen.kind === 'recoverable' ? 'ghost' : 'danger'}
              size="l"
              fullWidth
              disabled={busy}
            />
          </View>
        </>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.gutter,
    justifyContent: 'center',
  },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.4, color: colors.warning },
  title: { ...typography.h1, color: colors.textPrimary, marginTop: spacing.s },
  body: { ...typography.body, color: colors.textSecondary, marginTop: spacing.m },
  card: { marginTop: spacing.xl, gap: spacing.m },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.l },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 1.2, color: colors.textSecondary },
  rowValue: { ...typography.item, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  notice: { ...typography.bodyL, color: colors.warning, marginTop: spacing.l },
  error: { ...typography.body, color: colors.danger, marginTop: spacing.l },
  actions: { marginTop: spacing.xxl, gap: spacing.m },
});
