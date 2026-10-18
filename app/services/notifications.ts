import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Set up the default handler for incoming notifications
export const setupNotificationHandler = () => {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
};

// Register for push notifications permission and get token
export const registerForPushNotificationsAsync = async (): Promise<string | null> => {
  if (Platform.OS === 'web') return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Failed to get push token for push notification!');
      return null;
    }

    // Config channel for Android to support high priority and sound
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('sangar-alerts', {
        name: 'SANGAR Earthquake Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF6B35',
        sound: 'default', // Under Android 8.0+, sound is set on the channel
      });
    }

    const tokenData = await Notifications.getDevicePushTokenAsync();
    return tokenData.data;
  } catch (error) {
    console.warn('Error registering for push notifications:', error);
    return null;
  }
};

// Programmatic fallback to show notifications (useful for local simulation or testing)
export const scheduleLocalNotification = async (title: string, body: string) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: 'earthquake' },
      },
      trigger: null, // deliver immediately
    });
  } catch (error) {
    console.warn('Error scheduling local notification:', error);
  }
};
