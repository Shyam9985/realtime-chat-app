import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { ToastProvider } from './src/contexts/MessageContext';
import { AuthProvider } from './src/contexts/AuthContext';
import { ChatProvider } from './src/contexts/ChatContext';
import RootNavigator from './src/navigation/RootNavigator';
import UpdateGate from './src/components/UpdateGate';

function Root() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <RootNavigator />
      {/* "a new version is available": over every screen, the login screen included */}
      <UpdateGate />
    </>
  );
}

// the same provider order as the web client's main.jsx: theme, toasts, auth, then the app
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <ChatProvider>
              <Root />
            </ChatProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
