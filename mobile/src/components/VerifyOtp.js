import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/MessageContext';
import * as authService from '../services/auth.service';
import OtpInput from './OtpInput';
import { Button, Muted } from './ui';

// Ported from the web client's pages/auth/VerifyOTP.jsx
export default function VerifyOtp({ email, messageKey, onVerified, onResend, onChangeEmail }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const toast = useToast();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleVerifyOtp() {
    if (otp.length !== 6) { toast.warning('Please enter the 6 digit OTP.'); return; }
    try {
      setLoading(true);
      const response = await authService.verifyForgotPasswordOtp({ email, otp, key: messageKey });
      if (response.success) {
        toast.success(response.message);
        onVerified(otp);
      } else {
        toast.error(response.error || response.message);
      }
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: theme.space.md, padding: theme.space.md, marginBottom: theme.space.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.accentSoft }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="mail-open-outline" size={18} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', color: c.text, fontSize: theme.font.md }}>OTP sent</Text>
          <Muted>Enter the 6 digit code sent to</Muted>
          <Text style={{ fontWeight: '600', color: c.text, fontSize: theme.font.sm }}>{email}</Text>
        </View>
      </View>

      <OtpInput value={otp} onChange={setOtp} disabled={loading} />

      <Button title={loading ? 'Verifying...' : 'Verify OTP'} onPress={handleVerifyOtp} disabled={loading || otp.length !== 6} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.md }}>
        <Pressable onPress={onResend} accessibilityRole="button" hitSlop={8}><Text style={{ color: c.accent, fontWeight: '600' }}>Resend OTP</Text></Pressable>
        <Pressable onPress={onChangeEmail} accessibilityRole="button" hitSlop={8}><Text style={{ color: c.accent, fontWeight: '600' }}>Change Email</Text></Pressable>
      </View>
    </View>
  );
}
