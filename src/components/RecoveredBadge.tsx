/**
 * Selo de sessão recuperada de uma gravação interrompida. Avisa o piloto por
 * que talvez falte o fim da sessão. Mesmo formato do selo "RECORDE".
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, radius } from '../theme';

export function RecoveredBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.badge, style]}>
      <Text style={s.text}>Recuperada</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.9, color: colors.warning },
});
