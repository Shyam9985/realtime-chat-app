import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

/*
 * Ported from the web client's contexts/MessageContext.jsx, MessageContainer.jsx and utils/AlertMessage.jsx.
 * useToast() gives success / error / warning / info. As in AlertMessage, each type has its own display
 * time (a duration passed by the caller is ignored), a bar shows the time left, and a tap closes it.
 */
const DISPLAY_TIME = { success: 3000, info: 4000, warning: 5000, error: 6000 };
const ICONS = { success: 'checkmark-circle', error: 'close-circle', warning: 'warning', info: 'information-circle' };
const nativeDriver = Platform.OS !== 'web';

const ToastContext = createContext(null);

function Toast({ toast, onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const opacity = useRef(new Animated.Value(0)).current;
  const remaining = useRef(new Animated.Value(1)).current;
  const duration = DISPLAY_TIME[toast.type] || DISPLAY_TIME.info;
  const tone = { success: c.success, error: c.danger, warning: c.warning, info: c.accent }[toast.type] || c.accent;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: nativeDriver }).start();
    Animated.timing(remaining, { toValue: 0, duration, useNativeDriver: false }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: nativeDriver }).start(() => onClose(toast.id));
    }, duration);
    return () => clearTimeout(timer);
  }, [opacity, remaining, duration, onClose, toast.id]);

  return (
    <Animated.View style={{ opacity, marginBottom: theme.space.sm }}>
      <Pressable onPress={() => onClose(toast.id)} accessibilityRole="alert" accessibilityLabel={toast.message} testID={`toast-${toast.type}`}
        style={{ overflow: 'hidden', backgroundColor: tone, borderRadius: theme.radius.md, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingHorizontal: theme.space.md, paddingVertical: 12 }}>
          <Ionicons name={ICONS[toast.type] || ICONS.info} size={20} color="#FFFFFF" />
          <Text style={{ flex: 1, color: '#FFFFFF', fontWeight: '600', fontSize: theme.font.sm }}>{toast.message}</Text>
          <Ionicons name="close" size={18} color="#FFFFFF" />
        </View>
        <Animated.View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.55)', width: remaining.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const insets = useSafeAreaInsets();
  const nextId = useRef(1);

  const close = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((type, message) => {
    if (!message) return;
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, type, message: String(message) }]);
  }, []);

  const api = useMemo(() => ({
    success: (message) => show('success', message),
    error: (message) => show('error', message),
    warning: (message) => show('warning', message),
    info: (message) => show('info', message),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, zIndex: 1000, pointerEvents: 'box-none' }}>
        {toasts.map((t) => <Toast key={t.id} toast={t} onClose={close} />)}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
