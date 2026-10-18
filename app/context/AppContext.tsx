import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, DEFAULT_CONFIG } from '../config/constants';
import { playAlarmSound, stopAlarmSound } from '../services/sound';

export interface EarthquakeData {
  id: number;
  status: string;
  sensor: string;
  timestamp: string;
  receivedAt: string;
}

export type ConnectionStatus = 'online' | 'offline' | 'connecting';

interface AppContextType {
  apiUrl: string;
  wsUrl: string;
  apiKey: string;
  connectionStatus: ConnectionStatus;
  isAlarmActive: boolean;
  activeAlert: EarthquakeData | null;
  history: EarthquakeData[];
  loadingHistory: boolean;
  historyError: string | null;
  setConnectionStatus: (status: ConnectionStatus) => void;
  triggerAlert: (data: EarthquakeData) => void;
  dismissAlert: () => void;
  saveConfig: (apiUrl: string, wsUrl: string, apiKey: string) => Promise<void>;
  fetchHistory: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiUrl, setApiUrl] = useState(DEFAULT_CONFIG.API_URL);
  const [wsUrl, setWsUrl] = useState(DEFAULT_CONFIG.WS_URL);
  const [apiKey, setApiKey] = useState(DEFAULT_CONFIG.API_KEY);
  
  const [connectionStatus, setConnectionStatusState] = useState<ConnectionStatus>('offline');
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [activeAlert, setActiveAlert] = useState<EarthquakeData | null>(null);
  
  const [history, setHistory] = useState<EarthquakeData[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Load config from AsyncStorage on startup
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const storedApi = (await AsyncStorage.getItem(STORAGE_KEYS.API_URL)) || (await AsyncStorage.getItem('@nexsis_api_url'));
        const storedWs = (await AsyncStorage.getItem(STORAGE_KEYS.WS_URL)) || (await AsyncStorage.getItem('@nexsis_ws_url'));
        const storedKey = (await AsyncStorage.getItem(STORAGE_KEYS.API_KEY)) || (await AsyncStorage.getItem('@nexsis_api_key'));
        
        if (storedApi) setApiUrl(storedApi);
        if (storedWs) setWsUrl(storedWs);
        if (storedKey) setApiKey(storedKey);
      } catch (e) {
        console.warn('Failed to load settings config from storage:', e);
      }
    };
    loadConfig();
  }, []);

  // Fetch earthquake history
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const response = await fetch(`${apiUrl}/history`, {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // Ensure the history list has at most 10-50 elements (we can store what server returns)
      setHistory(Array.isArray(data) ? data : []);
    } catch (e: any) {
      console.warn('Failed to fetch history:', e);
      setHistoryError('Tidak dapat terhubung ke server. Periksa koneksi internet, lalu coba lagi.');
    } finally {
      setLoadingHistory(false);
    }
  }, [apiUrl, apiKey]);

  // Fetch history when API configuration changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const setConnectionStatus = useCallback((status: ConnectionStatus) => {
    setConnectionStatusState(status);
  }, []);

  // Trigger alarm alert
  const triggerAlert = useCallback((data: EarthquakeData) => {
    setActiveAlert(data);
    setIsAlarmActive(true);
    playAlarmSound();

    // Check if item is already in history, if not prepended
    setHistory(prev => {
      if (prev.some(item => item.id === data.id)) return prev;
      return [data, ...prev].slice(0, 50); // limit local state to 50
    });
  }, []);

  // Dismiss alarm alert
  const dismissAlert = useCallback(() => {
    setIsAlarmActive(false);
    setActiveAlert(null);
    stopAlarmSound();
  }, []);

  // Save new configuration settings
  const saveConfig = async (newApi: string, newWs: string, newKey: string) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.API_URL, newApi);
      await AsyncStorage.setItem(STORAGE_KEYS.WS_URL, newWs);
      await AsyncStorage.setItem(STORAGE_KEYS.API_KEY, newKey);
      
      setApiUrl(newApi);
      setWsUrl(newWs);
      setApiKey(newKey);
    } catch (e) {
      console.warn('Failed to save settings config to storage:', e);
      throw e;
    }
  };

  return (
    <AppContext.Provider
      value={{
        apiUrl,
        wsUrl,
        apiKey,
        connectionStatus,
        isAlarmActive,
        activeAlert,
        history,
        loadingHistory,
        historyError,
        setConnectionStatus,
        triggerAlert,
        dismissAlert,
        saveConfig,
        fetchHistory,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
