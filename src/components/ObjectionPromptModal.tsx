import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  visible: boolean;
  pickerName: string;
  targetName: string;
  loading?: boolean;
  onPass: () => Promise<void>;
  onObject: () => Promise<void>;
}

export default function ObjectionPromptModal({
  visible,
  pickerName,
  targetName,
  loading = false,
  onPass,
  onObject,
}: Props) {
  const [submitting, setSubmitting] = useState(false);

  const busy = loading || submitting;

  const handleAction = async (action: () => Promise<void>) => {
    setSubmitting(true);
    try {
      await action();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>İtiraz Penceresi</Text>
          <Text style={styles.body}>
            <Text style={styles.highlight}>{pickerName}</Text> seçimini yaptı: <Text style={styles.highlight}>{targetName}</Text>
          </Text>
          <Text style={styles.question}>İtiraz ediyor musun?</Text>
          <TouchableOpacity style={[styles.button, styles.objectButton, busy && styles.disabled]} disabled={busy} onPress={() => handleAction(onObject)}>
            <Text style={styles.buttonText}>İTİRAZ ET</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.passButton, busy && styles.disabled]} disabled={busy} onPress={() => handleAction(onPass)}>
            <Text style={styles.buttonText}>PAS GEÇ</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: '#111827', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#374151' },
  title: { color: '#f3f4f6', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  body: { color: '#d1d5db', fontSize: 15, textAlign: 'center', marginBottom: 8 },
  question: { color: '#fbbf24', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  highlight: { color: '#fff', fontWeight: '700' },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  objectButton: { backgroundColor: '#dc2626' },
  passButton: { backgroundColor: '#374151' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '800' },
});