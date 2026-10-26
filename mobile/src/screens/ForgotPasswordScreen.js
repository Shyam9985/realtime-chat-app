import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/MessageContext';
import * as authService from '../services/auth.service';
import { isValidEmail } from '../utils/ValidateUtils';
import { TextField, Button, Muted, Title } from '../components/ui';
import VerifyOtp from '../components/VerifyOtp';
import UpdatePassword from '../components/UpdatePassword';
import { AuthLayout } from './LoginScreen';

/*
 * Ported from the web client's pages/auth/ForgotPassword.jsx: send the code, verify it, set a new
 * password, shown as "Step n of 3" with the same messages; success returns to the login screen.
 */
export default function ForgotPasswordScreen({ navigation }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const message = useToast();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('send');
  const otpVerified = step === 'update';
  const [otpResponse, setOtpResponse] = useState(null);
  const [sendingOtp, setSendingOtp] = useState(false);

  const handleSubmit = async () => {
    const validation = isValidEmail(email);
    if (!validation.status) { message.warning(validation.message); return; }

    try {
      setSendingOtp(true);
      const response = await authService.sendForgotPasswordEmail(email.trim());
      if (response?.success) {
        message.success(response.message);
        setOtpResponse(response.data);
        setStep('verify');
      } else {
        message.error(response?.error || response?.message || 'Unable to send OTP.');
      }
    } catch {
      message.error('Something went wrong.');
    } finally {
      setSendingOtp(false);
    }
  };

  const currentStep = otpVerified ? 3 : otpResponse ? 2 : 1;
  const stepTitle = otpVerified ? 'Set New Password' : otpResponse ? 'Verify OTP' : 'Send OTP';
  const subtitle = otpVerified
    ? 'Set a new password for your account.'
    : otpResponse ? 'Enter the OTP sent to your registered email.' : 'Enter your email to receive a verification code.';

  return (
    <AuthLayout>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, marginBottom: theme.space.xs }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
        <Title style={{ fontSize: theme.font.xl }}>Forgot Password</Title>
      </View>
      <Muted style={{ marginBottom: theme.space.xl, marginLeft: 36 }}>{subtitle}</Muted>

      {/* progress */}
      <View style={{ marginBottom: theme.space.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Muted style={{ fontSize: theme.font.xs }}>Step {currentStep} of 3</Muted>
          <Muted style={{ fontSize: theme.font.xs }}>{stepTitle}</Muted>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden' }}>
          <View style={{ height: 6, width: `${(currentStep / 3) * 100}%`, backgroundColor: c.accent }} />
        </View>
      </View>

      <TextField label="Email" icon="mail-outline" value={email} onChangeText={setEmail} editable={!otpResponse} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" testID="fp-email" />

      {!otpResponse && <Button title={sendingOtp ? 'Sending OTP...' : 'Send OTP'} onPress={handleSubmit} loading={sendingOtp} />}

      {otpResponse && !otpVerified && (
        <VerifyOtp email={email.trim()} messageKey={otpResponse.message_key} onVerified={() => setStep('update')} onResend={handleSubmit}
          onChangeEmail={() => { setStep('send'); setOtpResponse(null); }} />
      )}

      {otpResponse && otpVerified && (
        <UpdatePassword email={email.trim()} requestFor="forgot-password" messageKey={otpResponse.message_key} onSuccess={() => navigation.popTo('Login')} />
      )}

      <Pressable onPress={() => navigation.popTo('Login')} style={{ marginTop: theme.space.xl, alignItems: 'center' }} accessibilityRole="button">
        <Text style={{ color: c.accent, fontWeight: '600' }}>← Back to Login</Text>
      </Pressable>
    </AuthLayout>
  );
}
