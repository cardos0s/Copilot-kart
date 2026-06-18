import { Tabs } from 'expo-router';
import { Icon, TabBar, TabItem } from '../../src/components/ui';
import { usePilotType } from '../../src/storage/pilotType';
import { colors } from '../../src/theme';

type TabKey = 'index' | 'sessions' | 'insights' | 'profile';

const TABS: TabItem<TabKey>[] = [
  {
    key: 'index',
    label: 'Início',
    icon: (active) => (
      <Icon name="home" color={active ? colors.primary : colors.textMuted} size={22} />
    ),
  },
  {
    key: 'sessions',
    label: 'Sessões',
    icon: (active) => (
      <Icon name="list" color={active ? colors.primary : colors.textMuted} size={22} />
    ),
  },
  {
    key: 'insights',
    label: 'Insights',
    icon: (active) => (
      <Icon name="bolt" color={active ? colors.primary : colors.textMuted} size={22} />
    ),
  },
  {
    key: 'profile',
    label: 'Perfil',
    icon: (active) => (
      <Icon name="person" color={active ? colors.primary : colors.textMuted} size={22} />
    ),
  },
];

export default function TabsLayout() {
  const [pilotType] = usePilotType();
  // Indoor é focado em ranking/competição — a aba "Sessões" (histórico de
  // gravações pessoais) não faz sentido pra ele, então é escondida.
  const tabs = pilotType === 'indoor' ? TABS.filter((t) => t.key !== 'sessions') : TABS;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
      tabBar={(props) => {
        const activeKey = props.state.routes[props.state.index]?.name as TabKey;
        return (
          <TabBar
            tabs={tabs}
            activeKey={activeKey}
            onChange={(key) => {
              props.navigation.navigate(key);
            }}
          />
        );
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="sessions" />
      <Tabs.Screen name="insights" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
