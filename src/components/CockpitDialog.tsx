/**
 * Diálogo desenhado pela própria tela, para as telas presas em paisagem.
 *
 * `Alert.alert` gira a orientação e trava o iOS com a tela presa em paisagem,
 * e o `Modal` do RN também assume retrato por padrão. Este diálogo é só uma
 * `View` absoluta por cima da tela: renderize-o como último filho da raiz.
 * O estilo é o do overlay "SEM MOVIMENTO" do cockpit.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

export type CockpitDialogVariant = 'primary' | 'secondary' | 'destructive';

export type CockpitDialogAction = {
  label: string;
  variant: CockpitDialogVariant;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  /** De 1 a 3 ações, na ordem em que aparecem. */
  actions:
    | [CockpitDialogAction]
    | [CockpitDialogAction, CockpitDialogAction]
    | [CockpitDialogAction, CockpitDialogAction, CockpitDialogAction];
};

export function CockpitDialog({ visible, title, message, actions }: Props) {
  if (!visible) return null;
  return (
    <View style={s.overlay}>
      <View style={s.card}>
        <Text style={s.title}>{title}</Text>
        {message ? <Text style={s.message}>{message}</Text> : null}
        {actions.map((a) =>
          a.variant === 'secondary' ? (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              hitSlop={12}
              style={({ pressed }) => [s.secondary, pressed && { opacity: 0.5 }]}
            >
              <Text style={s.secondaryText}>{a.label}</Text>
            </Pressable>
          ) : (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              style={({ pressed }) => [
                s.button,
                a.variant === 'destructive' ? s.destructive : s.primary,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={s.buttonText}>{a.label}</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.l,
    borderWidth: 2,
    borderColor: colors.warning,
    padding: spacing.l,
    alignItems: 'center',
  },
  title: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  message: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    paddingVertical: spacing.l,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.m,
    marginTop: spacing.l,
    alignSelf: 'stretch',
  },
  primary: { backgroundColor: colors.primary },
  destructive: { backgroundColor: colors.danger },
  buttonText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  secondary: {
    marginTop: spacing.m,
    padding: spacing.s,
  },
  secondaryText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});
