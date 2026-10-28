import React, { useEffect, useState } from 'react';
import { ImageBackground } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { Screen, Spinner } from '../components/ui';
import { openChatsFromNotifications } from '../services/push.service';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
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
const Tabs = createBottomTabNavigator();

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

// the app's navigation: chats, profile and about, always at the bottom of the screen
function HomeTabs() {
  const { theme } = useTheme();
  const header = useHeaderOptions();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        ...header,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.tabBarBackground, borderTopColor: c.border, height: TAB_BAR_HEIGHT + insets.bottom, paddingTop: 4, paddingBottom: 4 + insets.bottom },
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
        tabBarIcon: ({ focused, color, size }) => <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />,
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
  const { status } = useAuth();
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
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: false }} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
