import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export default function SuccessScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.checkIcon}>✓</Text>
        </View>
        <Text style={styles.title}>All Packs Sent</Text>
        <Text style={styles.subtitle}>
          WhatsApp received your sticker pack request. Open WhatsApp and confirm each pack add prompt.
        </Text>
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.buttonText}>Convert Another Pack</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08131F' },
  glowTop: {
    position: 'absolute',
    top: -80,
    right: -20,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(14, 165, 233, 0.18)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: -100,
    left: -40,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(251, 146, 60, 0.14)',
  },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  iconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#14532D',
    borderWidth: 4,
    borderColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 26,
  },
  checkIcon: { fontSize: 52, color: '#86EFAC', fontWeight: '900' },
  title: {
    fontSize: 33,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#ACC2D8',
    textAlign: 'center',
    marginBottom: 44,
    lineHeight: 24,
    maxWidth: 340,
  },
  button: {
    backgroundColor: '#FB923C',
    paddingVertical: 16,
    paddingHorizontal: 34,
    borderRadius: 13,
  },
  buttonText: { color: '#08131F', fontSize: 16, fontWeight: '800' },
});
