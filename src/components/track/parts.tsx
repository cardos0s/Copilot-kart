/**
 * Peças da escolha de kartódromo (handoff Cockpit 219).
 *
 * Ficam juntas porque as quatro telas do fluxo — cadastro, confirmação,
 * detecção e começar a correr — compartilham quase tudo: campo de busca,
 * selo, linha de pista, colunas de dado. O que muda entre elas é o contexto,
 * não o vocabulário.
 */

import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, fonts, radius, spacing } from '../../theme';
import { TrackKind } from '../../data/tracks';

const GUT = spacing.gutter;

// ── ícones ────────────────────────────────────────────────────────

export function ChevronLeft({ size = 17, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M10 3.5 L5.5 8 L10 12.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PlusIcon({ size = 15, color = colors.blueSoft }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M8 3 v10 M3 8 h10" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function SearchIcon({ focused }: { focused: boolean }) {
  const c = focused ? colors.blueSoft : colors.dim;
  return (
    <Svg width={17} height={17} viewBox="0 0 20 20" fill="none">
      <Circle cx={8.5} cy={8.5} r={6} stroke={c} strokeWidth={1.8} />
      <Path d="M13 13 L17.5 17.5" stroke={c} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg width={11} height={11} viewBox="0 0 12 12" fill="none">
      <Path
        d="M2.5 6.2 L4.8 8.5 L9.5 3.8"
        stroke="#fff"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ── cabeçalho do cadastro ─────────────────────────────────────────

export function StepHeader({
  step = 3,
  total = 3,
  onBack,
}: {
  step?: number;
  total?: number;
  onBack?: () => void;
}) {
  return (
    <View style={s.stepHeader}>
      <Pressable onPress={onBack} hitSlop={12} disabled={!onBack}>
        <ChevronLeft />
      </Pressable>
      <View style={s.stepBar}>
        {Array.from({ length: total }, (_, n) => (
          <View
            key={n}
            style={[s.stepSegment, { backgroundColor: n < step ? colors.blue : colors.surfaceRail }]}
          />
        ))}
      </View>
      <Text style={s.stepCount}>
        {step}/{total}
      </Text>
    </View>
  );
}

// ── campo de busca ────────────────────────────────────────────────

export function SearchField({
  value,
  onChangeText,
  focused,
  onFocus,
  onBlur,
  placeholder = 'Buscar por nome ou cidade',
}: {
  value: string;
  onChangeText: (v: string) => void;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  placeholder?: string;
}) {
  return (
    <View style={[s.search, focused && { borderColor: colors.blue }]}>
      <SearchIcon focused={focused} />
      <TextInput
        style={[s.searchInput, value ? { fontFamily: fonts.medium } : null]}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
    </View>
  );
}

// ── selo indoor/outdoor ───────────────────────────────────────────

export function TypeBadge({ kind }: { kind?: TrackKind }) {
  // Sem dado não há selo: um "Outdoor" chutado é pior que nenhum selo.
  if (!kind) return null;
  const indoor = kind === 'indoor';
  return (
    <View style={[s.badge, { backgroundColor: indoor ? colors.blueDim : colors.surface }]}>
      <Text style={[s.badgeText, { color: indoor ? colors.blueSoft : colors.muted }]}>
        {indoor ? 'Indoor' : 'Outdoor'}
      </Text>
    </View>
  );
}

// ── seleção ───────────────────────────────────────────────────────

export function SelectDot({ selected }: { selected: boolean }) {
  return (
    <View
      style={[
        s.selectDot,
        selected
          ? { backgroundColor: colors.blue }
          : { borderWidth: 1.5, borderColor: colors.line2 },
      ]}
    >
      {selected && <CheckIcon />}
    </View>
  );
}

// ── rótulo de seção com régua ─────────────────────────────────────

export function SectionLabel({
  children,
  style,
}: {
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={[s.sectionLabel, style]}>
      <Text style={s.sectionLabelText}>{children}</Text>
      <View style={s.sectionRule} />
    </View>
  );
}

// ── colunas de dado ───────────────────────────────────────────────

export type StatColumn = {
  label: string;
  value: string;
  /** Destaque azul — usado no dado do próprio piloto. */
  highlight?: boolean;
};

export function StatColumns({ items, valueSize = 17 }: { items: StatColumn[]; valueSize?: number }) {
  return (
    <View style={s.statRow}>
      {items.map((it, n) => (
        <View
          key={it.label}
          style={[
            s.statCol,
            n > 0 && { borderLeftWidth: 1, borderLeftColor: colors.line, paddingLeft: 14 },
          ]}
        >
          <Text style={s.statLabel}>{it.label}</Text>
          <Text
            style={[
              s.statValue,
              { fontSize: valueSize, color: it.highlight ? colors.blueSoft : colors.text },
            ]}
          >
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── botões ────────────────────────────────────────────────────────

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: colors.blue },
        disabled && s.buttonDisabled,
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      <Text style={[s.buttonText, { color: colors.textOnPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { borderWidth: 1, borderColor: colors.line2 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[s.buttonText, { color: colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

/** "Escolher depois" — a saída de quem não quer decidir agora. */
export function TextLink({
  label,
  onPress,
  align = 'center',
}: {
  label: string;
  onPress?: () => void;
  align?: 'center' | 'left';
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={{ alignSelf: align === 'center' ? 'center' : 'flex-start' }}>
      {({ pressed }) => (
        <Text style={[s.textLink, pressed && { opacity: 0.6 }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * "Não achei minha pista". Sem ela e sem "Escolher depois", quem não
 * encontra a própria pista trava no cadastro.
 */
export function AddTrackRow({ onPress, subtitle }: { onPress?: () => void; subtitle?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.addRow, pressed && { opacity: 0.7 }]}
    >
      <View style={s.addIcon}>
        <PlusIcon />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.addLabel}>Não achei minha pista</Text>
        {subtitle ? <Text style={s.addSubtitle}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

export function SheetHandle() {
  return (
    <View style={s.handleWrap}>
      <View style={s.handle} />
    </View>
  );
}

const s = StyleSheet.create({
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: GUT,
    paddingBottom: 18,
  },
  stepBar: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
  },
  stepSegment: {
    flex: 1,
    height: 2.5,
    borderRadius: radius.pill,
  },
  stepCount: {
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    color: colors.dim,
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    fontFamily: fonts.regular,
    fontSize: 15.5,
    color: colors.text,
  },

  badge: {
    borderRadius: radius.xs,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 0.4,
  },

  selectDot: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionLabelText: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 0.86,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },

  statRow: {
    flexDirection: 'row',
  },
  statCol: {
    flex: 1,
  },
  statLabel: {
    fontFamily: fonts.semibold,
    fontSize: 9.5,
    letterSpacing: 0.86,
    textTransform: 'uppercase',
    color: colors.dim,
  },
  statValue: {
    fontFamily: fonts.monoMedium,
    marginTop: 5,
  },

  button: {
    height: 52,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: -0.16,
  },
  textLink: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.dim,
  },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14.5,
    letterSpacing: -0.15,
    color: colors.blueSoft,
  },
  addSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.dim,
    marginTop: 2,
  },

  handleWrap: {
    alignItems: 'center',
    paddingTop: 9,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRail,
  },
});
