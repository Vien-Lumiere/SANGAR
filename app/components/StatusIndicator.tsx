import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useApp } from '../context/AppContext';
import { theme } from '../config/theme';

export const StatusIndicator: React.FC = () => {
  const { connectionStatus, wsUrl } = useApp();

  let statusText = 'OFFLINE';
  let badgeColor = theme.colors.accentOffline;
  let descriptionText = 'Sistem pemantauan lokal tidak aktif.';

  if (connectionStatus === 'online') {
    statusText = 'ONLINE';
    badgeColor = theme.colors.accentCalm;
    descriptionText = 'Sistem terhubung & memantau aktif.';
  } else if (connectionStatus === 'connecting') {
    statusText = 'MENGHUBUNGKAN...';
    badgeColor = theme.colors.accentAlert; // Amber orange to show transitioning state
    descriptionText = 'Sedang menyambungkan ke server...';
  }

  // Format server URL to show a clean host domain/IP
  const cleanUrl = wsUrl.replace('ws://', '').replace('wss://', '');

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.title}>SANGAR MONITORING PANEL</Text>
        <View style={[styles.badge, { borderColor: badgeColor }]}>
          <View style={[styles.dot, { backgroundColor: badgeColor }]} />
          <Text style={[styles.badgeText, { color: badgeColor }]}>{statusText}</Text>
        </View>
      </View>
      <View style={styles.bottomRow}>
        <Text style={styles.serverInfo} numberOfLines={1}>
          HOST: <Text style={styles.serverValue}>{cleanUrl}</Text>
        </Text>
        <Text style={styles.description}>{descriptionText}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: '#2C323D',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 14,
    letterSpacing: 1.5,
    color: theme.colors.textPrimary,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  badgeText: {
    fontFamily: theme.fonts.monoBold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serverInfo: {
    fontFamily: theme.fonts.mono,
    fontSize: 10,
    color: theme.colors.textSecondary,
    flex: 1,
    marginRight: theme.spacing.md,
  },
  serverValue: {
    color: theme.colors.textPrimary,
  },
  description: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.subheading,
  },
});
