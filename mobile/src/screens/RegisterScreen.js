import React, { useReducer, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/MessageContext';
import { handleSignup } from '../services/auth.service';
import * as validate from '../utils/ValidateUtils';
import { TextField, Button, Muted, Title } from '../components/ui';
import { AuthLayout } from './LoginScreen';

const initialState = {
  values: { firstName: '', lastName: '', email: '', mobile: '', password: '', confirmPassword: '' },
  errors: {},
};

function reducer(state, action) {
  switch (action.type) {
    case 'CHANGE_FIELD':
      return { ...state, values: { ...state.values, [action.name]: action.value }, errors: { ...state.errors, [action.name]: undefined } };
    case 'SET_ERRORS':
      return { ...state, errors: action.errors };
    default:
      return state;
  }
}

// the same rules the server enforces, so a user never learns about a problem only after the round trip
const validateForm = (v) => {
  const errors = {};
  const first = validate.isValidPersonName(v.firstName, { label: 'First name' });
  if (!first.status) errors.firstName = first.message;
  if (v.lastName.trim()) {
    const last = validate.isValidPersonName(v.lastName, { label: 'Last name' });
    if (!last.status) errors.lastName = last.message;
  }
  const email = validate.isValidEmail(v.email);
  if (!email.status) errors.email = email.message;
  if (v.mobile.trim()) {
    const mobile = validate.isValidMobile(v.mobile);
    if (!mobile.status) errors.mobile = mobile.message;
  }
  const password = validate.isStrongPassword(v.password);
  if (!password.status) errors.password = password.message;
  if (v.confirmPassword !== v.password) errors.confirmPassword = 'Passwords do not match.';
  return errors;
};

const initialsOf = (first, last) => `${first.trim()[0] || ''}${last.trim()[0] || ''}`.toUpperCase();

/*
 * Ported from the web client's pages/auth/RegisterForm.jsx: the same reducer, validation, service
 * call and messages. A duplicate email is shown on the field; success returns to the login screen.
 */
export default function RegisterScreen({ navigation }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const message = useToast();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (name) => (value) => dispatch({ type: 'CHANGE_FIELD', name, value });

  const handleSubmit = async () => {
    const errors = validateForm(state.values);
    dispatch({ type: 'SET_ERRORS', errors });
    if (Object.keys(errors).length) return;

    setIsLoading(true);
    const result = await handleSignup(state.values);
    setIsLoading(false);

    if (!result?.success) {
      if (result?.statusKey === 'DUPLICATE_RECORD') {
        dispatch({ type: 'SET_ERRORS', errors: { email: 'An account with this email already exists.' } });
        return;
      }
      message.error(result?.error || result?.message || 'We could not create your account. Please try again.', 3000);
      return;
    }
    message.success('Account created. Please sign in.');
    // react navigation 7: navigate() would push a second login screen; popTo returns to the existing one
    navigation.popTo('Login');
  };

  const { values, errors } = state;
  const initials = initialsOf(values.firstName, values.lastName);

  return (
    <AuthLayout>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, marginBottom: theme.space.xs }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
        <Title style={{ fontSize: theme.font.xl }}>Create Account</Title>
      </View>
      <Muted style={{ marginBottom: theme.space.xl, marginLeft: 36 }}>Fill the details below.</Muted>

      {/* avatar preview from the name; the photo itself is added from the profile after sign in */}
      <View style={{ alignItems: 'center', marginBottom: theme.space.xl }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          {initials ? <Text style={{ color: c.accent, fontWeight: '700', fontSize: 32 }}>{initials}</Text> : <Ionicons name="person" size={40} color={c.accent} />}
        </View>
        <Muted style={{ marginTop: theme.space.sm, textAlign: 'center' }}>You can add a photo from your profile after signing in.</Muted>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <TextField label="First Name" icon="person-outline" value={values.firstName} onChangeText={handleChange('firstName')} error={errors.firstName} style={{ flex: 1 }} placeholder="First name" autoComplete="given-name" testID="reg-first" />
        <TextField label="Last Name (optional)" icon="person-outline" value={values.lastName} onChangeText={handleChange('lastName')} error={errors.lastName} style={{ flex: 1 }} placeholder="Last name" autoComplete="family-name" testID="reg-last" />
      </View>
      <TextField label="Email" icon="mail-outline" value={values.email} onChangeText={handleChange('email')} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" testID="reg-email" />
      <TextField label="Mobile Number (optional)" icon="call-outline" value={values.mobile} onChangeText={handleChange('mobile')} error={errors.mobile} keyboardType="phone-pad" autoComplete="tel" placeholder="10 digit mobile number" testID="reg-mobile" />
      <TextField label="Password" icon="lock-closed-outline" value={values.password} onChangeText={handleChange('password')} error={errors.password} secureTextEntry placeholder="At least 8 characters, mixed case, a number and a symbol" testID="reg-password" />
      <TextField label="Confirm Password" icon="lock-closed-outline" value={values.confirmPassword} onChangeText={handleChange('confirmPassword')} error={errors.confirmPassword} secureTextEntry placeholder="Repeat your password" testID="reg-confirm" onSubmitEditing={handleSubmit} returnKeyType="go" />
      <Button title={isLoading ? 'Creating account...' : 'Create Account'} onPress={handleSubmit} loading={isLoading} />
      <Pressable onPress={() => navigation.popTo('Login')} style={{ marginTop: theme.space.xl, alignItems: 'center' }}>
        <Text style={{ color: c.textMuted }}>Already have an account? <Text style={{ color: c.accent, fontWeight: '700' }}>Login</Text></Text>
      </Pressable>
    </AuthLayout>
  );
}
