import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/MessageContext';
import { handleLogin } from '../services/auth.service';
import * as keyStore from '../crypto/keyStore';
import * as validate from '../utils/ValidateUtils';
import { Screen, TextField, Button, Title, Muted, IconButton, FormScroll } from '../components/ui';

// the YaapZone icon, then title and subtitle
export function AuthHeader({ title, subtitle }) {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: 'center', marginBottom: theme.space.xxl }}>
      <Image source={require('../../assets/icon.png')} accessibilityLabel="YaapZone" accessibilityIgnoresInvertColors
        style={{ width: 104, height: 104, borderRadius: 26, marginBottom: theme.space.lg }} />
      <Title>{title}</Title>
      <Muted style={{ marginTop: theme.space.xs, fontSize: theme.font.md }}>{subtitle}</Muted>
    </View>
  );
}

// sign in, create account and password recovery share this layout; the focused field stays above the keyboard
export function AuthLayout({ children }) {
  const { theme } = useTheme();
  return (
    <Screen edges={['top', 'bottom']}>
      <FormScroll contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: theme.space.xl }}>
        <View style={{ width: '100%', maxWidth: 440, alignSelf: 'center' }}>{children}</View>
      </FormScroll>
    </Screen>
  );
}

/*
 * Ported from the web client's pages/auth/LoginForm.jsx: the same validation, the same auth.service
 * call and the same messages. On success the user goes to AuthContext.handleLogin, as on the web.
 */
export default function LoginScreen({ navigation }) {
  const { theme } = useTheme();
  const authCtx = useAuth();
  const message = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (name) => (value) => setForm((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async () => {
    const validationErrors = {};
    const emailValidation = validate.isValidEmail(form.email);
    if (!emailValidation.status) validationErrors.email = emailValidation.message;
    if (!form.password) validationErrors.password = 'Enter your password.';
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;

    setIsLoading(true);
    setBusyText('');
    const result = await handleLogin({ email: form.email.trim(), password: form.password });

    if (!result?.success) {
      setIsLoading(false);
      message.error(result?.statusKey === 'INVALID_CREDENTIALS' ? 'Incorrect email or password.' : (result?.error || result?.message || 'Could not sign you in.'), 2500);
      return;
    }
    // the chats' private key: from this phone, or unlocked from the password backup (a few seconds)
    setBusyText('Unlocking your chats...');
    let keyResult;
    try {
      keyResult = await keyStore.unlockAfterSignIn(result.data.user, result.data.keys, form.password);
    } catch (e) {
      keyResult = { status: 'needsRecovery' };
    }
    setIsLoading(false);
    await authCtx.handleLogin(result.data.user, keyResult);
    if (keyResult.status !== 'needsRecovery') message.success('Login successful!');
  };

  return (
    <AuthLayout>
      <AuthHeader title="Welcome Back" subtitle="Login to continue" />
      <TextField label="Email" icon="mail-outline" value={form.email} onChangeText={handleChange('email')} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" testID="login-email" />
      <TextField label="Password" icon="lock-closed-outline" value={form.password} onChangeText={handleChange('password')} error={errors.password} secureTextEntry={!showPassword} placeholder="Your password" testID="login-password"
        onSubmitEditing={handleSubmit} returnKeyType="go" style={{ marginBottom: theme.space.sm }}
        right={<IconButton name={showPassword ? 'eye-off-outline' : 'eye-outline'} color={theme.colors.textMuted} onPress={() => setShowPassword((v) => !v)} accessibilityLabel="Toggle password visibility" style={{ marginRight: 6 }} />} />
      <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={{ alignSelf: 'flex-end', marginBottom: theme.space.lg }} accessibilityRole="button" hitSlop={8}>
        <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>Forgot Password?</Text>
      </Pressable>
      <Button title={isLoading ? busyText || 'Logging in...' : 'Login'} onPress={handleSubmit} loading={isLoading} />
      <Pressable onPress={() => navigation.navigate('Register')} style={{ marginTop: theme.space.xl, alignItems: 'center' }}>
        <Text style={{ color: theme.colors.textMuted }}>Don't have an account? <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>Create Account</Text></Text>
      </Pressable>
    </AuthLayout>
  );
}
