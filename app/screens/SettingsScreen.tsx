import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  SafeAreaView, 
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useApp } from '../context/AppContext';
import { theme } from '../config/theme';
import { ArrowLeft, Save, HelpCircle, Activity } from 'lucide-react-native';

interface SettingsScreenProps {
  onClose: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onClose }) => {
  const { apiUrl, wsUrl, apiKey, saveConfig, triggerAlert } = useApp();
  const [newApiUrl, setNewApiUrl] = useState(apiUrl);
  const [newWsUrl, setNewWsUrl] = useState(wsUrl);
  const [newApiKey, setNewApiKey] = useState(apiKey);
  const [saving, setSaving] = useState(false);
  const [testPassword, setTestPassword] = useState('');

  const handleSave = async () => {
    if (!newApiUrl.trim() || !newWsUrl.trim()) {
      Alert.alert('Eror Validasi', 'URL API dan WebSocket tidak boleh kosong.');
      return;
    }

    setSaving(true);
    try {
      await saveConfig(newApiUrl.trim(), newWsUrl.trim(), newApiKey.trim());
      Alert.alert('Pengaturan Disimpan', 'Konfigurasi server berhasil diperbarui.', [
        { text: 'OK', onPress: onClose }
      ]);
    } catch (e) {
      Alert.alert('Gagal Menyimpan', 'Terjadi kesalahan saat menyimpan ke penyimpanan lokal.');
    } finally {
      setSaving(false);
    }
  };

  // Helper to trigger a local mock alert for testing
  const handleTestTrigger = () => {
    if (testPassword !== 'rafi ganteng') {
      Alert.alert('Akses Ditolak', 'Password simulasi salah.');
      return;
    }

    const mockData = {
      id: Date.now(),
      status: 'earthquake_detected',
      sensor: 'SANGAR-TEST-MOCK',
      timestamp: new Date().toISOString(),
      receivedAt: new Date().toLocaleDateString('id-ID') + ' ' + new Date().toLocaleTimeString('id-ID'),
    };
    
    // Close the settings screen and trigger
    onClose();
    // Delay slightly to allow transition animation to complete
    setTimeout(() => {
      triggerAlert(mockData);
    }, 300);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.keyboardView}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={onClose} 
            style={styles.backButton}
            activeOpacity={0.7}
          >
            <ArrowLeft color={theme.colors.textPrimary} size={20} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>KONFIGURASI SISTEM</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>PENGATURAN KONEKSI SERVER</Text>
          
          <View style={styles.infoBox}>
            <HelpCircle size={16} color={theme.colors.accentCalm} style={{ marginRight: 8 }} />
            <Text style={styles.infoText}>
              Sesuaikan URL ini untuk menghubungkan aplikasi ke backend pemantau Anda. Gunakan alamat localhost Emulator (http://10.0.2.2) jika menguji secara lokal.
            </Text>
          </View>

          {/* API URL Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>BASE HTTP API URL</Text>
            <TextInput
              style={styles.input}
              value={newApiUrl}
              onChangeText={setNewApiUrl}
              placeholder="Contoh: http://10.0.2.2:5000"
              placeholderTextColor={theme.colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          {/* WebSocket URL Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>WEBSOCKET URL</Text>
            <TextInput
              style={styles.input}
              value={newWsUrl}
              onChangeText={setNewWsUrl}
              placeholder="Contoh: ws://10.0.2.2:5000"
              placeholderTextColor={theme.colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          {/* API Key Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>API AUTH KEY (OPSIONAL)</Text>
            <TextInput
              style={styles.input}
              value={newApiKey}
              onChangeText={setNewApiKey}
              placeholder="Masukkan Token Otorisasi jika ada"
              placeholderTextColor={theme.colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Action Buttons */}
          <TouchableOpacity 
            style={[styles.saveButton, saving && styles.disabledButton]} 
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            <Save color="#FFF" size={18} style={{ marginRight: 8 }} />
            <Text style={styles.saveButtonText}>{saving ? 'MENYIMPAN...' : 'SIMPAN PERUBAHAN'}</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          <Text style={styles.sectionTitle}>SISTEM DIAGNOSTIK</Text>
          
          {/* Simulation Password Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>PASSWORD SIMULASI</Text>
            <TextInput
              style={styles.input}
              value={testPassword}
              onChangeText={setTestPassword}
              placeholder="Masukkan password untuk simulasi"
              placeholderTextColor={theme.colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Test Trigger Button */}
          <TouchableOpacity 
            style={styles.testButton} 
            onPress={handleTestTrigger}
            activeOpacity={0.8}
          >
            <Activity color={theme.colors.accentCalm} size={18} style={{ marginRight: 8 }} />
            <Text style={styles.testButtonText}>UJI COBA SINYAL ALARM</Text>
          </TouchableOpacity>
          <Text style={styles.testHint}>
            Menstimulasi sinyal getaran seismik tiruan untuk memverifikasi fungsionalitas visual gelombang, alarm suara (expo-av), dan overlay notifikasi.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bgBase,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.bgSurface,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#2C323D',
  },
  backButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 14,
    color: theme.colors.textPrimary,
    letterSpacing: 1.5,
    fontWeight: 'bold',
  },
  scrollContent: {
    padding: theme.spacing.lg,
  },
  sectionTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 11,
    letterSpacing: 1.2,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    fontWeight: 'bold',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#1E252D',
    borderWidth: 1,
    borderColor: '#2D4459',
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  infoText: {
    flex: 1,
    fontFamily: theme.fonts.subheading,
    fontSize: 12,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: theme.spacing.md,
  },
  label: {
    fontFamily: theme.fonts.heading,
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
    letterSpacing: 1.0,
  },
  input: {
    backgroundColor: theme.colors.bgSurface,
    borderWidth: 1,
    borderColor: '#363D4A',
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: theme.fonts.mono,
    fontSize: 13,
    color: theme.colors.textPrimary,
    minHeight: 48,
  },
  saveButton: {
    backgroundColor: theme.colors.accentAlert,
    borderRadius: theme.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: theme.spacing.md,
  },
  disabledButton: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontFamily: theme.fonts.heading,
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1.0,
  },
  separator: {
    height: 1,
    backgroundColor: '#2C323D',
    marginVertical: theme.spacing.xl,
  },
  testButton: {
    borderWidth: 1,
    borderColor: theme.colors.accentCalm,
    borderRadius: theme.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    backgroundColor: 'rgba(45, 212, 191, 0.05)',
  },
  testButtonText: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.accentCalm,
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1.0,
  },
  testHint: {
    fontFamily: theme.fonts.subheading,
    fontSize: 11,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    lineHeight: 16,
  },
});
