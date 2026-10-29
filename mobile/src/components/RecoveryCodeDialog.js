import React, { useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../theme/ThemeContext';
import { Button, Dialog, Muted } from './ui';

/*
 * The recovery code, shown once: after sign-up, for an account getting its first keys, after "start
 * fresh" and when the user asks for a new one. It is also emailed to them (the server keeps no copy),
 * so a mail that never arrives is covered by saving it here. It cannot be closed by tapping outside:
 * only "I've saved it".
 */
export default function RecoveryCodeDialog({ code, emailed = true, onDone }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
  };
  const share = () => Share.share({ message: `My YaapZone recovery code: ${code}\nKeep it private. It unlocks my chats if I forget my password.` }).catch(() => {});

  return (
    <Dialog visible={!!code} icon="key-outline" title="Save your recovery code" dismissable={false} onClose={() => {}}
      message="Your chats are end-to-end encrypted: only your phones can read them. If you ever forget your password, this code is the only way to get your old messages back."
      actions={[{ label: "I've saved it", style: 'primary', onPress: onDone, testID: 'recovery-saved' }]}>
      <View style={{ marginTop: theme.space.lg, padding: theme.space.md, borderRadius: theme.radius.md, backgroundColor: c.accentSoft, alignItems: 'center' }}>
        <Text selectable testID="recovery-code"
          style={{ color: c.text, fontSize: theme.font.md, fontWeight: '700', letterSpacing: 1, textAlign: 'center', lineHeight: Math.round(theme.font.md * 1.6),
            fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }) }}>
          {code?.split('-').slice(0, 4).join('-')}{'\n'}{code?.split('-').slice(4).join('-')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md }}>
        <Button title={copied ? 'Copied' : 'Copy'} icon={copied ? 'checkmark' : 'copy-outline'} variant="secondary" onPress={copy} style={{ flex: 1 }} testID="recovery-copy" />
        <Button title="Share" icon="share-outline" variant="secondary" onPress={share} style={{ flex: 1 }} />
      </View>
      <Muted style={{ marginTop: theme.space.md, textAlign: 'center' }}>
        {emailed ? 'We also emailed it to you. ' : ''}Keep it somewhere safe, like a password manager. YaapZone does not store it and cannot show it again.
      </Muted>
    </Dialog>
  );
}
