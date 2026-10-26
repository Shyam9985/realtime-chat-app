import React, { useState } from 'react';
import { View } from 'react-native';
import { useToast } from '../contexts/MessageContext';
import * as authService from '../services/auth.service';
import { isStrongPassword } from '../utils/ValidateUtils';
import { Button, TextField } from './ui';

// Ported from the web client's pages/auth/UpdatePassword.jsx: the new password and its confirmation,
// the same strength rule as the server, then auth.service.updatePassword with the verified otp key
export default function UpdatePassword({ email, requestFor = 'forgot-password', messageKey, onSuccess }) {
  const toast = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleUpdatePassword() {
    const passwordValidation = isStrongPassword(newPassword, { label: 'New Password' });
    if (!passwordValidation.status) { toast.warning(passwordValidation.message); return; }
    if (newPassword !== confirmPassword) { toast.warning('Passwords do not match.'); return; }

    try {
      setLoading(true);
      const response = await authService.updatePassword({ email, newPassword, usedFor: requestFor, otpKey: messageKey });
      if (response.success) {
        toast.success(response.message || 'Password updated successfully.');
        onSuccess?.();
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
      <TextField label="New Password" icon="lock-closed-outline" value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="Strong password" testID="new-password" />
      <TextField label="Confirm Password" icon="lock-closed-outline" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholder="Repeat password" testID="confirm-password" onSubmitEditing={handleUpdatePassword} returnKeyType="go" />
      <Button title={loading ? 'Updating...' : 'Update Password'} onPress={handleUpdatePassword} loading={loading} />
    </View>
  );
}
