/**
 * Pilot DNA — a identidade técnica do piloto.
 *
 * Não é relatório de sessão: é o perfil de estilo agregado de TODAS as
 * sessões, que evolui a cada bateria. Primeiro passo do Cockpit
 * Intelligence: Pilotar → Detectar → Prescrever → Comprovar.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { getLapsForSession, listSessions } from '../src/storage/db';
import { getProfile } from '../src/storage/profile';
import { DnaSessionInput, PilotDna, buildPilotDna } from '../src/lib/pilotDna';
import { Card, ScreenHeader } from '../src/components/ui';
import { colors, radius, spacing, typography } from '../src/theme';

function toneColor(tone: 'good' | 'neutral' | 'attention'): string {
  if (tone === 'good') return colors.success;
  if (tone === 'attention') return colors.warning;
  return colors.textPrimary;
}

function PilotDnaScreenInner() {
  const [dna, setDna] = useState<PilotDna | null>(null);
  const [pilotName, setPilotName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [sessions, profile] = await Promise.all([listSessions(), getProfile()]);
        const inputs: DnaSessionInput[] = [];
        for (const s of sessions) {
          const laps = await getLapsForSession(s.id);
          if (laps.length > 0) {
            inputs.push({ trackName: s.trackName, startedAt: s.startedAt, laps });
          }
        }
        if (cancelled) return;
        setPilotName(profile?.nickname?.trim() || profile?.name?.trim() || 'Piloto');
        setDna(buildPilotDna(inputs));
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (loading || !dna) {
    return (
      <View style={[p.root, p.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={p.loadingText}>Lendo suas sessões…</Text>
      </View>
    );
  }

  if (dna.sessionsUsed === 0) {
    return (
      <View style={p.root}>
        <ScreenHeader title="PILOT DNA" />
        <View style={[p.center, { flex: 1, padding: spacing.huge }]}>
          <Text style={p.emptyTitle}>Seu DNA nasce na pista</Text>
          <Text style={p.emptyText}>
            Grave sua primeira sessão e o Cockpit começa a mapear seu estilo de
            pilotagem: como você entra nas curvas, onde brilha e onde perde tempo.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={p.root}>
      <ScreenHeader title="PILOT DNA" subtitle={`${pilotName} · identidade técnica`} />
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.huge }}>
        {/* Volume de dados por trás do perfil */}
        <View style={p.summaryRow}>
          <SummaryStat value={`${dna.sessionsUsed}`} label="sessões" />
          <SummaryStat value={`${dna.lapsUsed}`} label="voltas" />
          <SummaryStat value={`${dna.cornersAnalyzed}`} label="curvas lidas" />
        </View>

        {!dna.mature && (
          <View style={p.calibratingBanner}>
            <Text style={p.calibratingText}>
              Perfil inicial — com 3+ sessões o DNA ganha confiança estatística e
              novos traços destravam.
            </Text>
          </View>
        )}

        {/* Traços */}
        <Card variant="default" padding="l" style={{ marginBottom: spacing.m }}>
          {dna.traits.map((t, i) => (
            <View
              key={t.label}
              style={[p.traitRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <Text style={p.traitLabel}>{t.label}</Text>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={[p.traitValue, { color: toneColor(t.tone) }]}>{t.value}</Text>
                {t.detail && <Text style={p.traitDetail}>{t.detail}</Text>}
              </View>
            </View>
          ))}
          {dna.traits.length === 0 && (
            <Text style={p.emptyText}>
              Ainda calibrando — grave mais voltas pra destravar os traços do seu estilo.
            </Text>
          )}
        </Card>

        {/* Exercício prescrito — o "Prescrever" do ciclo */}
        {dna.exercise && (
          <Card variant="default" padding="l" style={p.exerciseCard}>
            <Text style={p.exerciseKicker}>OBJETIVO DA PRÓXIMA BATERIA</Text>
            <Text style={p.exerciseTitle}>
              {dna.exercise.cornerName} · {dna.exercise.trackName}
            </Text>
            <Text style={p.exerciseProblem}>{dna.exercise.problem}</Text>

            <Text style={p.exerciseSection}>Exercício</Text>
            {dna.exercise.steps.map((s) => (
              <Text key={s} style={p.exerciseStep}>
                —  {s}
              </Text>
            ))}

            <Text style={p.exerciseSection}>Critério de sucesso</Text>
            {dna.exercise.successCriteria.map((s) => (
              <Text key={s} style={p.exerciseStep}>
                ✓  {s}
              </Text>
            ))}
          </Card>
        )}

        <Text style={p.footNote}>
          Atualizado a cada sessão. Seu DNA evolui com você — compare-se com quem
          você era, não com os outros.
        </Text>
      </ScrollView>
    </View>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={p.summaryStat}>
      <Text style={[p.summaryValue, typography.mono]}>{value}</Text>
      <Text style={p.summaryLabel}>{label}</Text>
    </View>
  );
}

export default function PilotDnaScreen() {
  return (
    <ErrorBoundary context="Pilot DNA">
      <PilotDnaScreenInner />
    </ErrorBoundary>
  );
}

const p = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: {
    ...typography.bodyS,
    color: colors.textSecondary,
    marginTop: spacing.m,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.s,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.s,
    marginBottom: spacing.m,
  },
  summaryStat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.m,
    alignItems: 'center',
  },
  summaryValue: { ...typography.h3, color: colors.textPrimary },
  summaryLabel: { ...typography.label, color: colors.textMuted, marginTop: 2 },
  calibratingBanner: {
    backgroundColor: colors.primaryGlow,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.borderActive,
    padding: spacing.m,
    marginBottom: spacing.m,
  },
  calibratingText: { ...typography.bodyS, color: colors.textSecondary, lineHeight: 18 },
  traitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: spacing.m,
  },
  traitLabel: { ...typography.bodyS, color: colors.textSecondary },
  traitValue: { ...typography.bodyL, fontWeight: '800' },
  traitDetail: { ...typography.bodyS, color: colors.textMuted, marginTop: 1 },
  exerciseCard: {
    borderWidth: 1,
    borderColor: colors.borderActive,
    marginBottom: spacing.m,
  },
  exerciseKicker: { ...typography.label, color: colors.primary },
  exerciseTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.xs },
  exerciseProblem: {
    ...typography.bodyS,
    color: colors.warning,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  exerciseSection: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.m,
    marginBottom: spacing.xs,
  },
  exerciseStep: {
    ...typography.bodyS,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  footNote: {
    ...typography.bodyS,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacing.l,
  },
});
