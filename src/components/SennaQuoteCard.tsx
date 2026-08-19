/**
 * Card da citação do Senna pra home.
 *
 * 10 frases — algumas literais, algumas paráfrases pelo tom Senna. Edite o
 * array `SENNA_QUOTES` pra adicionar, remover ou refinar.
 *
 * Comportamento:
 *   - Toda vez que a home abre, sorteia uma frase diferente da última.
 *   - Persiste o índice da última no AsyncStorage pra não repetir entre
 *     reaberturas do app.
 *   - Botão de refresh manual ao lado da assinatura — clique força nova
 *     frase (também sem repetir a atual).
 *
 * Animação de entrada:
 *   - Slide-up 6px + fade + scale 0.98 → 1
 *   - 600ms com ease-out
 *   - Refresh manual reanima a partir da nova frase
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts, spacing } from '../theme';

export const SENNA_QUOTES = [
  'Vencer faz parte da vida.',
  'Quanto mais eu venço, mais eu quero vencer.',
  'Se você ainda vai atrás da brecha, ainda é piloto.',
  'No último décimo mora a coragem.',
  'Quando dirijo no limite, eu acelero mais.',
  'Não existe limite. Existe você e a curva.',
  'O sucesso vem da força de querer.',
  'Você só perde quando desiste de tentar.',
  'Em todas as voltas o tempo é uma promessa.',
  'O coração do piloto não conhece freio.',
];

const STORAGE_KEY = '@copilot:senna_quote_idx';

function pickDifferentIndex(current: number | null): number {
  if (SENNA_QUOTES.length <= 1) return 0;
  // Garantia O(1) sem loop: sorteia em [0, N-1) e shift quando >= current.
  const max = SENNA_QUOTES.length - 1;
  let pick = Math.floor(Math.random() * max);
  if (current != null && pick >= current) pick += 1;
  return pick;
}

/**
 * Sorteia uma citação diferente da última mostrada e guarda qual foi. O card
 * e a linha solta da home dividem isto pra não sortearem separado e a mesma
 * abertura do app mostrar duas citações diferentes.
 */
export function useSennaQuote() {
  const [idx, setIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      let last: number | null = null;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw != null) last = parseInt(raw, 10);
        if (Number.isNaN(last as number)) last = null;
      } catch {
        last = null;
      }
      const next = pickDifferentIndex(last);
      setIdx(next);
      AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => {});
    })();
  }, []);

  return idx == null ? null : SENNA_QUOTES[idx];
}

/** A citação como linha de texto, sem moldura — é assim que a home usa. */
export function SennaQuoteLine({ style }: { style?: object }) {
  const quote = useSennaQuote();
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (quote) opacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [quote, opacity]);

  const aStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text style={[s.quoteLine, aStyle, style]} numberOfLines={2}>
      {quote ?? ' '}
    </Animated.Text>
  );
}

export function SennaQuoteCard() {
  const [idx, setIdx] = useState<number | null>(null);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(6);
  const scale = useSharedValue(0.98);

  const animateIn = useCallback(() => {
    opacity.value = 0;
    translateY.value = 6;
    scale.value = 0.98;
    opacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [opacity, translateY, scale]);

  // Na 1ª montagem: lê o índice anterior salvo e sorteia outro
  useEffect(() => {
    (async () => {
      let last: number | null = null;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw != null) last = parseInt(raw, 10);
        if (Number.isNaN(last as number)) last = null;
      } catch {
        last = null;
      }
      const next = pickDifferentIndex(last);
      setIdx(next);
      AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => {});
      animateIn();
    })();
  }, [animateIn]);

  const handleRefresh = () => {
    const next = pickDifferentIndex(idx);
    setIdx(next);
    AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => {});
    animateIn();
  };

  const aStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  if (idx == null) return <View style={s.placeholder} />;
  const quote = SENNA_QUOTES[idx];

  return (
    <Animated.View style={[s.card, aStyle]}>
      <Text style={s.quoteOpen}>"</Text>
      <Text style={s.quote}>{quote}</Text>
      <View style={s.footer}>
        <Text style={s.attribution}>— AYRTON SENNA</Text>
        <Pressable
          onPress={handleRefresh}
          hitSlop={12}
          style={({ pressed }) => [s.refreshBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={s.refreshIcon}>⟲</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  placeholder: { minHeight: 160 },

  quoteLine: {
    fontFamily: fonts.regular,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 21,
    color: colors.muted,
  },

  card: {
    paddingTop: spacing.m,
    paddingBottom: spacing.l,
  },

  quoteOpen: {
    fontFamily: 'PlayfairDisplay_700Bold',
    color: colors.primary,
    fontSize: 64,
    lineHeight: 56,
    marginBottom: -8,
    opacity: 0.9,
    textShadowColor: colors.primary + '66',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  quote: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: colors.textPrimary,
    fontSize: 36,
    lineHeight: 44,
    letterSpacing: -0.5,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.m,
  },
  attribution: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIcon: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '800',
    transform: [{ rotate: '-45deg' }],
  },
});
