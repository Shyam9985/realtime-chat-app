import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { Screen, Muted } from '../components/ui';
import { StatusTicks } from '../components/MessageBubble';
import { DELETE_WINDOW_MINUTES } from '../utils/chatFormat';

/*
 * The About tab: what the app does, in everyday words. Every sentence matches how the app and the
 * server behave, so update it when a rule changes. The delete window comes from chatFormat; the
 * 5 attempts / 24 hour lock lives in the login model on the server.
 */

const FEATURES = [
  { icon: 'chatbubbles-outline', title: 'Chat one-to-one', text: 'Tap the green button in Chats, then search by name or email to start a conversation.' },
  { icon: 'flash-outline', title: 'Messages arrive instantly', text: 'If the other person is offline, your message waits and reaches them as soon as they’re back online.' },
  { icon: 'person-circle-outline', title: 'See who you’re talking to', text: 'Tap someone’s photo in Chats, or their name at the top of a chat, to see their profile.' },
  { icon: 'trash-outline', title: 'Delete for everyone', text: `Sent something by mistake? Press and hold the message to delete it for both of you. You have ${DELETE_WINDOW_MINUTES} minutes after sending.` },
  { icon: 'ban-outline', title: 'Block someone', text: 'Tap the three dots at the top right of a chat and choose “Block user”. They can’t message you any more, and you can unblock them at any time.' },
  { icon: 'color-palette-outline', title: 'Make it yours', text: 'In Profile, add a photo, switch between light and dark, and make the text bigger or smaller.' },
];

// the same icons the chat shows next to the time on your messages
const TICKS = [
  { status: 'SENDING', label: 'Sending' },
  { status: 'SENT', label: 'Sent' },
  { status: 'DELIVERED', label: 'Delivered to their phone' },
  { status: 'SEEN', label: 'Seen' },
  { status: 'FAILED', label: 'Not sent. Tap the message to try again.' },
];

const PRIVACY = [
  { icon: 'eye-off-outline', text: 'Other members can’t see your conversations.' },
  { icon: 'id-card-outline', text: 'Other members can see your name, email address, profile photo and the date you joined. Your mobile number is never shown.' },
  { icon: 'hand-left-outline', text: 'People you block can’t message you, find you in search or see your profile photo.' },
  { icon: 'cloud-done-outline', text: 'Your chats are saved to your account, so they’re still there when you sign in on a new phone.' },
];

const SAFETY = [
  { icon: 'key-outline', text: 'Your password is stored in scrambled form, so nobody can read it.' },
  { icon: 'lock-closed-outline', text: 'After 5 wrong password attempts in a row, your account locks for 24 hours. To unlock it straight away, tap “Forgot Password?” on the sign-in screen and set a new password with the code we email you.' },
];

const COMING_LATER = [
  { icon: 'people-outline', text: 'Group chats' },
  { icon: 'images-outline', text: 'Sending photos, files, voice notes and videos' },
];

function Card({ title, children }) {
  const { theme } = useTheme();
  return (
    <View style={{ marginHorizontal: theme.space.lg, marginTop: theme.space.lg, padding: theme.space.lg, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
      {title ? <Text accessibilityRole="header" style={{ fontSize: theme.font.lg, fontWeight: '700', color: theme.colors.text, marginBottom: theme.space.md }}>{title}</Text> : null}
      {children}
    </View>
  );
}

// a feature: icon on a soft disc, a short title and one or two plain sentences
function Feature({ icon, title, text, last }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.md, marginBottom: last ? 0 : theme.space.lg }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={c.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '700', color: c.text, fontSize: theme.font.md }}>{title}</Text>
        <Muted style={{ marginTop: 2, lineHeight: Math.round(theme.font.sm * 1.5) }}>{text}</Muted>
      </View>
    </View>
  );
}

// a single fact with a small icon
function Point({ icon, text, last }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md, marginBottom: last ? 0 : theme.space.md }}>
      <Ionicons name={icon} size={20} color={c.accent} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: c.text, fontSize: theme.font.md, lineHeight: Math.round(theme.font.md * 1.45) }}>{text}</Text>
    </View>
  );
}

// one tick state, drawn on a small piece of your own message bubble so it looks as it does in a chat
function TickRow({ status, label, last }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, marginBottom: last ? 0 : theme.space.sm }}>
      <View style={{ width: 48, height: 30, borderRadius: 8, backgroundColor: c.bubbleMine, alignItems: 'center', justifyContent: 'center' }}>
        {/* the chat's own tick icons and colours, drawn larger so they are easy to tell apart */}
        <View style={{ transform: [{ scale: 1.4 }] }}>
          <StatusTicks status={status} color={c.bubbleMineMeta} seenColor={c.seen} />
        </View>
      </View>
      <Text style={{ flex: 1, color: c.text, fontSize: theme.font.md }}>{label}</Text>
    </View>
  );
}

export default function AboutScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.space.xxl }} testID="about-scroll">
        <Card>
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="chatbubble-ellipses" size={38} color="#FFFFFF" />
            </View>
            <Text style={{ fontSize: theme.font.xl, fontWeight: '700', color: c.text, marginTop: theme.space.md }}>Chat App</Text>
            <Muted style={{ marginTop: 2, textAlign: 'center' }}>Simple one-to-one messaging with the people you know.</Muted>
            <Muted style={{ marginTop: theme.space.sm, fontSize: theme.font.xs }}>Version 1.0.0</Muted>
          </View>
        </Card>

        <Card title="What you can do">
          {FEATURES.map((f, i) => <Feature key={f.title} {...f} last={i === FEATURES.length - 1} />)}
        </Card>

        <Card title="What the ticks mean">
          <Muted style={{ marginBottom: theme.space.md, lineHeight: Math.round(theme.font.sm * 1.5) }}>You’ll see these next to the time on messages you send.</Muted>
          {TICKS.map((t, i) => <TickRow key={t.status} {...t} last={i === TICKS.length - 1} />)}
        </Card>

        <Card title="Your privacy">
          {PRIVACY.map((p, i) => <Point key={p.icon} {...p} last={i === PRIVACY.length - 1} />)}
        </Card>

        <Card title="Keeping your account safe">
          {SAFETY.map((p, i) => <Point key={p.icon} {...p} last={i === SAFETY.length - 1} />)}
        </Card>

        <Card title="Coming later">
          {COMING_LATER.map((p, i) => <Point key={p.icon} {...p} last={i === COMING_LATER.length - 1} />)}
        </Card>

        <Muted style={{ textAlign: 'center', marginTop: theme.space.xl }}>Powered by <Text style={{ color: c.accent, fontWeight: '700' }}>Syam Vara Prasad</Text></Muted>
      </ScrollView>
    </Screen>
  );
}
