import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Keyboard, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { initials } from '../utils/chatFormat';
import { getUserPhoto } from '../services/files.service';

// ---- layout
export function Screen({ children, style, edges = ['bottom'], background }) {
  const { theme } = useTheme();
  return <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: background || theme.colors.background }, style]}>{children}</SafeAreaView>;
}

/*
 * Keeps its content above the on-screen keyboard. Android draws the app edge-to-edge, so the system
 * no longer shrinks the screen when the keyboard opens. When the keyboard appears, this view measures
 * where it sits on screen and pads its bottom by the part the keyboard covers, so it works below a
 * header and above the tab bar alike. The web has no on-screen keyboard, so there it does nothing.
 */
export function KeyboardAvoider({ children, style }) {
  const ref = useRef(null);
  const [covered, setCovered] = useState(0);

  // keyboard: its on-screen frame; animation: the iOS keyboard event, whose motion the padding follows
  const measure = useCallback((keyboard, animation) => {
    const keyboardTop = keyboard?.screenY;
    if (!ref.current || !Number.isFinite(keyboardTop)) return;
    ref.current.measureInWindow((x, y, width, height) => {
      if (!Number.isFinite(y) || !Number.isFinite(height)) return;
      if (animation?.duration) {
        LayoutAnimation.configureNext({ duration: animation.duration, update: { duration: animation.duration, type: LayoutAnimation.Types[animation.easing] || 'keyboard' } });
      }
      setCovered(Math.max(0, Math.round(y + height - keyboardTop)));
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const ios = Platform.OS === 'ios';
    const subscriptions = [
      Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (event) => measure(event?.endCoordinates, ios ? event : null)),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setCovered(0)),
    ];
    return () => subscriptions.forEach((s) => s.remove());
  }, [measure]);

  // a screen that opens while the keyboard is already up (a chat opened from search) gets no keyboard event
  const onLayout = () => {
    if (Platform.OS !== 'web' && Keyboard.isVisible()) measure(Keyboard.metrics());
  };

  return <View ref={ref} onLayout={onLayout} style={[{ flex: 1 }, style, covered ? { paddingBottom: covered } : null]}>{children}</View>;
}

/*
 * A scrolling form whose focused field stays visible above the keyboard. On Android it sits in a
 * KeyboardAvoider and the scroll view, as it shrinks, scrolls the focused field back into view by
 * itself. On iOS the scroll view makes room and scrolls to the field on its own. Taps on buttons
 * work while the keyboard is open.
 */
export const FormScroll = forwardRef(function FormScroll({ children, ...props }, ref) {
  const scroll = (
    <ScrollView ref={ref} keyboardShouldPersistTaps="handled" {...(Platform.OS === 'ios' ? { automaticallyAdjustKeyboardInsets: true } : null)} {...props}>
      {children}
    </ScrollView>
  );
  return Platform.OS === 'android' ? <KeyboardAvoider>{scroll}</KeyboardAvoider> : scroll;
});

export function Spinner({ size = 'large', style }) {
  const { theme } = useTheme();
  return <ActivityIndicator size={size} color={theme.colors.accent} style={style} />;
}

// ---- skeleton loading
/*
 * Placeholders shaped like the content that is loading. Every skeleton on screen shares one pulse,
 * so they breathe together; the loop runs only while at least one is mounted. Colours come from the
 * theme. Screen readers hear "Loading" once for the whole group, not each grey bar.
 */
const pulse = new Animated.Value(0.45);
let pulseUsers = 0;
let pulseLoop = null;
const usePulse = () => {
  useEffect(() => {
    pulseUsers += 1;
    if (pulseUsers === 1) {
      pulseLoop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      ]));
      pulseLoop.start();
    }
    return () => {
      pulseUsers -= 1;
      if (pulseUsers === 0 && pulseLoop) { pulseLoop.stop(); pulseLoop = null; }
    };
  }, []);
  return pulse;
};

// one grey shape: a bar by default, a circle with `circle`
export function Skeleton({ width = '100%', height = 14, radius = 7, circle, style }) {
  const { theme } = useTheme();
  const opacity = usePulse();
  const size = circle ? { width: height, height, borderRadius: height / 2 } : { width, height, borderRadius: radius };
  return <Animated.View style={[{ backgroundColor: theme.colors.border, opacity }, size, style]} />;
}

// wraps a skeleton layout so assistive technology announces it once as loading
function SkeletonGroup({ children, style, testID }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading" testID={testID} style={style}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{children}</View>
    </View>
  );
}

// the chat list: avatar, name and preview, time on the right
export function ConversationListSkeleton({ rows = 8 }) {
  const { theme } = useTheme();
  const widths = ['62%', '48%', '70%', '55%', '66%', '44%', '58%', '50%'];
  return (
    <SkeletonGroup testID="skeleton-conversations" style={{ backgroundColor: theme.colors.surface }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 12 }}>
          <Skeleton circle height={52} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Skeleton width={widths[i % widths.length]} height={14} />
              <Skeleton width={34} height={10} />
            </View>
            <Skeleton width={widths[(i + 3) % widths.length]} height={11} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

// a conversation: bubbles on both sides at different widths
export function ChatSkeleton({ bubbles = 9 }) {
  const { theme } = useTheme();
  const pattern = [[false, '58%'], [false, '40%'], [true, '52%'], [false, '66%'], [true, '36%'], [true, '60%'], [false, '46%'], [true, '42%'], [false, '54%']];
  return (
    <SkeletonGroup testID="skeleton-chat" style={{ flex: 1, justifyContent: 'flex-end', paddingVertical: theme.space.md, gap: 8 }}>
      {pattern.slice(0, bubbles).map(([mine, width], i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', paddingHorizontal: theme.space.md, marginBottom: 8 }}>
          <Skeleton width={width} height={i % 3 === 0 ? 52 : 36} radius={10} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

// a profile page (own profile and contact info): photo, name, email, then a few detail rows
export function ProfileSkeleton({ rows = 4 }) {
  const { theme } = useTheme();
  return (
    <SkeletonGroup testID="skeleton-profile" style={{ paddingTop: theme.space.xl }}>
      <View style={{ alignItems: 'center', gap: 10, marginBottom: theme.space.xl }}>
        <Skeleton circle height={112} />
        <Skeleton width={160} height={18} />
        <Skeleton width={200} height={12} />
      </View>
      <View style={{ backgroundColor: theme.colors.surface }}>
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 14 }}>
            <Skeleton width={80} height={12} />
            <Skeleton width={i % 2 ? '45%' : '55%'} height={12} />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

// a plain list of people (search results, blocked users)
export function PeopleListSkeleton({ rows = 5 }) {
  const { theme } = useTheme();
  return (
    <SkeletonGroup testID="skeleton-people">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 10 }}>
          <Skeleton circle height={40} />
          <View style={{ flex: 1, gap: 7 }}>
            <Skeleton width={i % 2 ? '40%' : '52%'} height={13} />
            <Skeleton width={i % 2 ? '60%' : '48%'} height={10} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

// ---- text
export function Title({ children, style }) {
  const { theme } = useTheme();
  return <Text style={[{ fontSize: theme.font.xxl, fontWeight: '700', color: theme.colors.text }, style]}>{children}</Text>;
}

export function Muted({ children, style, numberOfLines }) {
  const { theme } = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: theme.font.sm, color: theme.colors.textMuted }, style]}>{children}</Text>;
}

// ---- inputs
// the browser draws its own focus ring around text inputs; the bordered wrapper already shows focus
export const webNoOutline = Platform.OS === 'web' ? { outlineStyle: 'none' } : null;

export function TextField({ label, error, style, inputStyle, right, icon, ...props }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[{ marginBottom: theme.space.lg }, style]}>
      {label ? <Text style={{ fontSize: theme.font.sm, fontWeight: '600', color: c.textMuted, marginBottom: theme.space.xs }}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.inputBackground, borderWidth: 1, borderColor: error ? c.danger : c.border, borderRadius: theme.radius.md }}>
        {icon ? <Ionicons name={icon} size={18} color={c.textMuted} style={{ marginLeft: theme.space.md }} /> : null}
        <TextInput
          placeholderTextColor={c.placeholder}
          style={[{ flex: 1, paddingHorizontal: theme.space.md, paddingVertical: 12, fontSize: theme.font.md, color: c.text }, webNoOutline, inputStyle]}
          {...props}
        />
        {right}
      </View>
      {error ? <Text style={{ color: c.danger, fontSize: theme.font.xs, marginTop: theme.space.xs }}>{error}</Text> : null}
    </View>
  );
}

// ---- buttons
export function Button({ title, onPress, variant = 'primary', loading = false, disabled = false, style, icon, testID, accessibilityLabel }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const palette = {
    primary: { bg: c.accent, fg: c.textOnAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft },
    ghost: { bg: 'transparent', fg: c.accent, border: 'transparent' },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityRole="button"
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 13, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.pill,
        backgroundColor: pressed && variant === 'primary' ? c.accentPressed : palette.bg, borderWidth: 1, borderColor: palette.border,
        opacity: inactive ? 0.6 : pressed && variant !== 'primary' ? 0.85 : 1,
      }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={palette.fg} /> : icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
      <Text style={{ color: palette.fg, fontWeight: '600', fontSize: theme.font.md }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ name, onPress, color, size = 22, style, accessibilityLabel, testID, disabled }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID}
      style={({ pressed }) => [{ padding: 6, borderRadius: theme.radius.pill, opacity: pressed ? 0.6 : 1 }, style]}>
      <Ionicons name={name} size={size} color={color || theme.colors.text} />
    </Pressable>
  );
}

// the round green action button bottom-right, as in whatsapp
export function Fab({ icon = 'chatbox-ellipses', onPress, accessibilityLabel }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        position: 'absolute', right: theme.space.lg, bottom: theme.space.lg, width: 56, height: 56, borderRadius: 16,
        backgroundColor: theme.colors.accentBright, alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6,
        opacity: pressed ? 0.85 : 1,
      })}>
      <Ionicons name={icon} size={26} color="#FFFFFF" />
    </Pressable>
  );
}

// ---- feedback
export function Banner({ kind = 'info', text, action, style }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const tone = { info: { bg: c.accentSoft, fg: c.text }, warning: { bg: c.warningSoft, fg: c.text }, danger: { bg: c.dangerSoft, fg: c.danger } }[kind];
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, backgroundColor: tone.bg, paddingHorizontal: theme.space.lg, paddingVertical: theme.space.sm }, style]}>
      <Text style={{ flex: 1, color: tone.fg, fontSize: theme.font.sm }}>{text}</Text>
      {action}
    </View>
  );
}

export function EmptyState({ icon = 'chatbubbles-outline', title, subtitle, action }) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xxl }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.lg }}>
        <Ionicons name={icon} size={34} color={theme.colors.accent} />
      </View>
      <Text style={{ fontSize: theme.font.lg, fontWeight: '700', color: theme.colors.text, textAlign: 'center' }}>{title}</Text>
      {subtitle ? <Muted style={{ textAlign: 'center', marginTop: theme.space.sm, lineHeight: 20 }}>{subtitle}</Muted> : null}
      {action ? <View style={{ marginTop: theme.space.xl, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

/*
 * Members' photos, fetched once per photo and shared by every avatar that shows it. The key includes
 * the stored photo path, which changes on every upload, so a new photo is fetched and an old one is
 * never shown. "No photo" answers are not cached, so a photo that becomes visible later appears.
 */
const photoCache = new Map();

export function useUserPhoto(userId, photoVersion) {
  const key = userId && photoVersion ? `${userId}|${photoVersion}` : null;
  const [uri, setUri] = useState(() => (key ? photoCache.get(key)?.value || null : null));
  useEffect(() => {
    if (!key) { setUri(null); return undefined; }
    let alive = true;
    let entry = photoCache.get(key);
    if (!entry) {
      entry = { value: null, promise: getUserPhoto(userId) };
      photoCache.set(key, entry);
      entry.promise.then((value) => { if (value) entry.value = value; else photoCache.delete(key); });
    }
    entry.promise.then((value) => { if (alive) setUri(value || null); });
    return () => { alive = false; };
  }, [key, userId]);
  return uri;
}

// the member's photo when they have one, otherwise their initials on a soft disc
export function Avatar({ user, size = 44, showPhoto = true }) {
  const { theme } = useTheme();
  const photo = useUserPhoto(showPhoto ? user?.user_id : null, showPhoto ? user?.profile_photo_url : null);
  if (photo) {
    return <Image source={{ uri: photo }} accessibilityIgnoresInvertColors style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.accentSoft }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: size * 0.38 }}>{initials(user)}</Text>
    </View>
  );
}

export function Badge({ count }) {
  const { theme } = useTheme();
  if (!count) return null;
  return (
    <View style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: theme.colors.accentBright, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Divider({ inset = 0 }) {
  const { theme } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginLeft: inset }} />;
}

// a titled group of rows on a full-width card (profile and contact info screens)
export function Section({ title, children }) {
  const { theme } = useTheme();
  return (
    <View style={{ marginTop: theme.space.xl }}>
      <Text style={{ fontSize: theme.font.xs, fontWeight: '700', color: theme.colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: theme.space.sm, marginHorizontal: theme.space.lg }}>{title}</Text>
      <View style={{ backgroundColor: theme.colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.border }}>{children}</View>
    </View>
  );
}

// an on / off setting: icon, label and a switch; the whole row toggles it
export function SwitchRow({ icon, label, hint, value, onValueChange, disabled, testID }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable onPress={() => !disabled && onValueChange(!value)} disabled={disabled} testID={testID}
      accessibilityRole="switch" accessibilityState={{ checked: !!value, disabled: !!disabled }} accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: 12, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 })}>
      {icon ? <Ionicons name={icon} size={20} color={c.accent} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: theme.font.md, fontWeight: '600' }}>{label}</Text>
        {hint ? <Muted>{hint}</Muted> : null}
      </View>
      <Switch value={!!value} onValueChange={onValueChange} disabled={disabled}
        trackColor={{ false: c.border, true: c.accent }} thumbColor="#FFFFFF" ios_backgroundColor={c.border} />
    </Pressable>
  );
}

// ---- dialogs

/*
 * Centred alert / confirmation dialog.
 * actions: [{ label, style: 'cancel' (default) | 'primary' | 'destructive', onPress, testID }]
 * Any action closes the dialog first, then runs its onPress. tone 'danger' colours the icon red.
 */
export function Dialog({ visible, icon, tone = 'default', title, message, children, actions = [], onClose, dismissable = true }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const danger = tone === 'danger';
  return (
    <Modal transparent visible={!!visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={dismissable ? onClose : undefined} style={{ flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl }}>
        <Pressable onPress={() => {}} accessibilityRole="alert" accessibilityViewIsModal
          style={{ width: '100%', maxWidth: 360, backgroundColor: c.headerBackground, borderRadius: 20, padding: theme.space.xl, borderWidth: theme.isDark ? 1 : 0, borderColor: c.border,
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}>
          {icon ? (
            <View style={{ alignSelf: 'center', width: 56, height: 56, borderRadius: 28, marginBottom: theme.space.md, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? c.dangerSoft : c.accentSoft }}>
              <Ionicons name={icon} size={28} color={danger ? c.danger : c.accent} />
            </View>
          ) : null}
          {title ? <Text style={{ fontSize: theme.font.lg, fontWeight: '700', color: c.text, textAlign: 'center' }}>{title}</Text> : null}
          {message ? <Text style={{ fontSize: theme.font.md, color: c.textMuted, textAlign: 'center', marginTop: theme.space.sm, lineHeight: Math.round(theme.font.md * 1.4) }}>{message}</Text> : null}
          {children}
          {actions.length ? (
            <View style={{ flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.xl }}>
              {actions.map((a) => {
                const filled = a.style === 'primary' || a.style === 'destructive';
                return (
                  <Pressable key={a.label} testID={a.testID} accessibilityRole="button" onPress={() => { onClose?.(); a.onPress?.(); }}
                    style={({ pressed }) => ({
                      flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: theme.radius.pill,
                      backgroundColor: a.style === 'destructive' ? c.danger : a.style === 'primary' ? c.accent : 'transparent',
                      borderWidth: filled ? 0 : 1, borderColor: c.border, opacity: pressed ? 0.85 : 1,
                    })}>
                    <Text style={{ fontWeight: '700', fontSize: theme.font.md, color: filled ? '#FFFFFF' : c.text }}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/*
 * Small overflow menu in the top-right corner, opened from a header ⋮ button.
 * items: [{ label, icon, destructive, onPress }]
 */
export function PopupMenu({ visible, items = [], onClose, top = 56 }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={!!visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <View style={{ position: 'absolute', top: insets.top + top, right: 8, minWidth: 200, paddingVertical: 6, borderRadius: 12, backgroundColor: c.headerBackground, borderWidth: theme.isDark ? 1 : 0, borderColor: c.border,
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
          {items.map((item) => (
            <Pressable key={item.label} accessibilityRole="menuitem"
              onPress={() => { onClose?.(); setTimeout(() => item.onPress?.(), Platform.OS === 'ios' ? 350 : 0); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingVertical: 12, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
              {item.icon ? <Ionicons name={item.icon} size={18} color={item.destructive ? c.danger : c.text} /> : null}
              <Text style={{ fontSize: theme.font.md, color: item.destructive ? c.danger : c.text }}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
