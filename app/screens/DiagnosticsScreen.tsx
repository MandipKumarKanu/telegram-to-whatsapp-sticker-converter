import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import WhatsAppStickerModule from '../native/WhatsAppStickerModule';

const BOT_TOKEN = process.env.EXPO_PUBLIC_TELEGRAM_BOT_TOKEN;

type RootStackParamList = {
  Home: undefined;
  Diagnostics: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Diagnostics'>;

export default function DiagnosticsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState('Run diagnostics to verify native WhatsApp integration.');

  const handleRun = async () => {
    setIsRunning(true);
    setReport('Running checks...');

    try {
      const diagnostics = await WhatsAppStickerModule.runBasicDiagnostics();
      const targets = diagnostics.supportedTargets.length
        ? diagnostics.supportedTargets.join(', ')
        : 'none';

      const whitelistEntries = Object.entries(diagnostics.whitelistProviderReachable || {});
      const whitelistText = whitelistEntries.length
        ? whitelistEntries
            .map(([provider, ok]) => `${provider}: ${ok ? 'reachable' : 'not reachable'}`)
            .join('\n')
        : 'No whitelist checks returned.';

      setReport(
        [
          `Platform: ${Platform.OS}`,
          `BOT token configured: ${BOT_TOKEN ? 'yes' : 'no'}`,
          `Provider authority: ${diagnostics.providerAuthority || 'n/a'}`,
          `Foreground activity: ${diagnostics.hasForegroundActivity ? 'yes' : 'no'}`,
          `WhatsApp installed: ${diagnostics.whatsappInstalled ? 'yes' : 'no'}`,
          `Detected targets: ${targets}`,
          '',
          'Whitelist provider checks:',
          whitelistText,
        ].join('\n'),
      );
    } catch (error: any) {
      setReport(error?.message || 'Diagnostics failed.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('Home')}>
          <Feather name="arrow-left" size={20} color="#34D399" />
        </TouchableOpacity>
        <Text style={styles.title}>Diagnostics</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Android Integration Checks</Text>
          <Text style={styles.cardSubTitle}>
            Verifies native module linkage, provider authority, WhatsApp package visibility, and whitelist provider reachability.
          </Text>

          <TouchableOpacity style={styles.runButton} onPress={handleRun} disabled={isRunning}>
            {isRunning ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Feather name="activity" size={16} color="#000" style={{ marginRight: 8 }} />
                <Text style={styles.runButtonText}>Run Diagnostics</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.reportCard}>
          <Text style={styles.reportTitle}>Report</Text>
          <Text style={styles.reportText}>{report}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D14' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: '#13151D',
    borderColor: '#1E2335',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  cardSubTitle: {
    color: '#A0AEC0',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 14,
  },
  runButton: {
    backgroundColor: '#34D399',
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  runButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  reportCard: {
    backgroundColor: '#13151D',
    borderColor: '#1E2335',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  reportTitle: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  reportText: {
    color: '#A0AEC0',
    fontSize: 12,
    lineHeight: 18,
  },
});
