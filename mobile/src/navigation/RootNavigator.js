import React, { useEffect, useState } from 'react';
import { ImageBackground, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Header } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { Screen, Spinner } from '../components/ui';
import { openChatsFromNotifications } from '../services/push.service';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import UnlockScreen from '../screens/UnlockScreen';
import RecoveryCodeDialog from '../components/RecoveryCodeDialog';
import ConversationsScreen from '../screens/ConversationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AboutScreen from '../screens/AboutScreen';
import NewChatScreen from '../screens/NewChatScreen';
import ChatScreen from '../screens/ChatScreen';
import ContactInfoScreen from '../screens/ContactInfoScreen';
import ArchivedScreen from '../screens/ArchivedScreen';
import ForwardScreen from '../screens/ForwardScreen';
import NewGroupScreen from '../screens/NewGroupScreen';
import NewGroupDetailsScreen from '../screens/NewGroupDetailsScreen';
import GroupInfoScreen from '../screens/GroupInfoScreen';
import AddMembersScreen from '../screens/AddMembersScreen';

const Stack = createNativeStackNavigator();
const Tabs = createMaterialTopTabNavigator();

const TAB_ICONS = {
  Chats: ['chatbubbles', 'chatbubbles-outline'],
  Profile: ['person', 'person-outline'],
  About: ['information-circle', 'information-circle-outline'],
};

const useHeaderOptions = () => {
  const { theme } = useTheme();
  const c = theme.colors;
  return {
    headerStyle: { backgroundColor: c.headerBackground },
    headerTintColor: c.headerText,
    headerTitleStyle: { fontWeight: '700', color: c.headerText },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: c.background },
  };
};

/*
 * Each tab stacks a 28px icon box and a 16px label inside 5px of padding (54px), so the bar is that
 * plus 4px above and below. The phone's own bottom inset (gesture bar or navigation buttons) is added
 * on top, so the tabs always sit above it instead of underneath.
 */
const TAB_BAR_HEIGHT = 64;

// a tab's icon; the Chats tab carries the unread badge on its top-right corner
function TabIcon({ name, focused, color, badge }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={TAB_ICONS[name][focused ? 0 : 1]} size={24} color={color} />
      {badge ? (
        <View style={{ position: 'absolute', top: -4, left: 16, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: theme.colors.accentBright, alignItems: 'center', justifyContent: 'center' }}
          accessibilityLabel={`${badge} chats with unread messages`}>
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

// the app's navigation: chats, profile and about, at the bottom of the screen. a swipe left or right
// moves between them (the pager), a tap on a tab too. each tab keeps its page header (title and the
// buttons a screen sets with navigation.setOptions)
function HomeTabs() {
  const { theme } = useTheme();
  const header = useHeaderOptions();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  // the Chats tab's badge: how many chats have unread messages (archived ones stay out, like the list)
  const { conversations } = useChat();
  const unreadChats = conversations.filter((x) => x.unread_count > 0 && !x.is_archived).length;
  const badge = unreadChats ? (unreadChats > 99 ? '99+' : String(unreadChats)) : null;
  return (
    <Tabs.Navigator
      tabBarPosition="bottom"
      screenLayout={({ options, children }) => (
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <Header title={options.title} headerRight={options.headerRight} headerStyle={header.headerStyle} headerTintColor={header.headerTintColor}
            headerTitleStyle={header.headerTitleStyle} headerShadowVisible={false} headerTitleAlign="left" />
          {children}
        </View>
      )}
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarShowIcon: true,
        tabBarPressColor: 'transparent',
        tabBarStyle: { backgroundColor: c.tabBarBackground, borderTopWidth: 1, borderTopColor: c.border, height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom, elevation: 0, shadowOpacity: 0 },
        tabBarItemStyle: { height: TAB_BAR_HEIGHT, paddingVertical: 4 },
        tabBarIndicatorStyle: { height: 0 },
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '600', textTransform: 'none', margin: 0 },
        tabBarIcon: ({ focused, color }) => <TabIcon name={route.name} focused={focused} color={color} badge={route.name === 'Chats' ? badge : null} />,
      })}
    >
      <Tabs.Screen name="Chats" component={ConversationsScreen} options={{ title: 'Chats' }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Tabs.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
    </Tabs.Navigator>
  );
}

// a handle on the navigator for code outside the screens (a tapped notification opening its chat)
const navigationRef = createNavigationContainerRef();

export default function RootNavigator() {
  const { theme, isDark } = useTheme();
  const { status, recoveryCode, clearRecoveryCode } = useAuth();
  const header = useHeaderOptions();
  const c = theme.colors;
  const [navReady, setNavReady] = useState(false);

  // a tapped notification opens its chat, once someone is signed in and the screens exist. this also
  // catches the tap that started the app from closed, which arrived before any of this was mounted
  useEffect(() => {
    if (status !== 'signedIn' || !navReady) return undefined;
    return openChatsFromNotifications((conversationId, title) => navigationRef.navigate('Chat', { conversationId, title }));
  }, [status, navReady]);

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: { ...(isDark ? DarkTheme : DefaultTheme).colors, primary: c.accent, background: c.background, card: c.headerBackground, text: c.headerText, border: c.border, notification: c.accentBright },
  };

  // while the stored sign-in is read: the YaapZone startup screen (it carries its own loading ring)
  if (status === 'loading') return <ImageBackground source={require('../../assets/startup-screen.png')} resizeMode="cover" style={{ flex: 1, backgroundColor: '#FFFFFF' }} accessibilityLabel="YaapZone is starting" />;

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef} onReady={() => setNavReady(true)}>
      <Stack.Navigator screenOptions={header}>
        {status === 'signedIn' ? (
          <>
            <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />
            <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'Select contact' }} />
            <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params?.title || 'Chat' })} />
            <Stack.Screen name="ContactInfo" component={ContactInfoScreen} options={{ title: 'Contact info' }} />
            <Stack.Screen name="Archived" component={ArchivedScreen} options={{ title: 'Archived' }} />
            <Stack.Screen name="Forward" component={ForwardScreen} options={{ title: 'Forward to…' }} />
            <Stack.Screen name="NewGroup" component={NewGroupScreen} options={{ title: 'New group' }} />
            <Stack.Screen name="NewGroupDetails" component={NewGroupDetailsScreen} options={{ title: 'Name the group' }} />
            <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{ title: 'Group info' }} />
            <Stack.Screen name="AddMembers" component={AddMembersScreen} options={{ title: 'Add members' }} />
          </>
        ) : status === 'locked' ? (
          // signed in, but this phone does not have the key that opens the chats yet
          <Stack.Screen name="Unlock" component={UnlockScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: false }} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
      {/* new keys were just made for this account (first sign-in after encryption, or "start fresh") */}
      <RecoveryCodeDialog code={status === 'signedIn' ? recoveryCode : null} onDone={clearRecoveryCode} />
    </NavigationContainer>
  );
}
