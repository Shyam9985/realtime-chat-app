import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Dialog, Muted } from './ui';
import { checkForUpdate, downloadAndInstall, onUpdateCheckRequested, updatesSupported } from '../services/update.service';
import { Notifications } from '../services/push.service';
import { APP_VERSION } from '../config';

const RECHECK_MS = 30 * 60 * 1000;      // when the app comes back to the foreground, at most every 30 minutes

/*
 * The "update available" dialog over the whole app (the login screen included). It asks the server at
 * start and when the app returns to the foreground. An optional update offers Update and Later (Later
 * holds until the next start); a mandatory one cannot be closed. Update downloads the APK inside the app
 * with a progress bar, then Android asks the user to install it.
 */
export default function UpdateGate() {
  const { theme } = useTheme();
  const c = theme.colors;
  const [offer, setOffer] = useState(null);         // { latest, mandatory } while the dialog is up
  const [progress, setProgress] = useState(null);   // null: not downloading; 0..1 or -1 (size unknown)
  const [failed, setFailed] = useState(null);
  const later = useRef(false);                      // the user chose Later for an optional update
  const lastCheck = useRef(0);

  // asked = the user tapped the "new version" notification: show it even after an earlier Later
  const check = useCallback(async (asked = false) => {
    if (!asked && Date.now() - lastCheck.current < 5000) return;
    lastCheck.current = Date.now();
    if (asked) later.current = false;
    try {
      const result = await checkForUpdate();
      if (result?.update_available && (result.mandatory || !later.current)) setOffer({ latest: result.latest, mandatory: result.mandatory });
    } catch (_) { /* offline or the server is asleep: ask again next time */ }
  }, []);

  useEffect(() => {
    if (!updatesSupported()) return undefined;
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastCheck.current > RECHECK_MS) check();
    });
    const stopListening = onUpdateCheckRequested(() => check(true));
    // a tapped "new version" notification, signed in or not (a tap that started the app is covered by
    // the check at start)
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response?.notification?.request?.content?.data?.type === 'update') check(true);
    });
    return () => { subscription.remove(); stopListening(); tapped.remove(); };
  }, [check]);

  const update = async () => {
    setFailed(null);
    setProgress(0);
    try {
      await downloadAndInstall(offer.latest, (p) => setProgress(p == null ? -1 : p));
    } catch (e) {
      setFailed('The download did not finish. Check your connection and try again.');
    } finally {
      setProgress(null);
    }
  };

  if (!offer) return null;
  const downloading = progress != null;
  const { latest, mandatory } = offer;
  const actions = downloading ? [] : mandatory
    ? [{ label: 'Update', style: 'primary', onPress: update, testID: 'update-now' }]
    : [{ label: 'Later', onPress: () => { later.current = true; setOffer(null); } }, { label: 'Update', style: 'primary', onPress: update, testID: 'update-now' }];

  return (
    // closing only happens through Later: the Dialog calls onClose before an action's onPress, and
    // Update must keep the dialog open to show the download
    <Dialog visible icon="cloud-download-outline" title={`YaapZone ${latest.version} is available`} dismissable={false} onClose={() => {}} actions={actions}
      message={mandatory ? `This update is required to keep using YaapZone. You have version ${APP_VERSION}.` : `You have version ${APP_VERSION}.`}>
      <View style={{ marginTop: theme.space.md }} testID="update-gate">
        {latest.notes ? (
          <>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: theme.font.sm, marginBottom: 4 }}>What’s new</Text>
            <Muted style={{ lineHeight: Math.round(theme.font.sm * 1.5) }}>{latest.notes}</Muted>
          </>
        ) : null}
        {downloading ? (
          <View style={{ marginTop: theme.space.lg }}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: c.border, overflow: 'hidden' }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: c.accent, width: progress < 0 ? '35%' : `${Math.round(progress * 100)}%` }} />
            </View>
            <Muted style={{ marginTop: theme.space.xs, textAlign: 'center' }}>{progress < 0 ? 'Downloading…' : `Downloading… ${Math.round(progress * 100)}%`}</Muted>
          </View>
        ) : null}
        {failed ? <Text style={{ color: c.danger, fontSize: theme.font.sm, marginTop: theme.space.md, textAlign: 'center' }}>{failed}</Text> : null}
      </View>
    </Dialog>
  );
}
