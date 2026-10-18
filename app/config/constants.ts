export const STORAGE_KEYS = {
  API_URL: '@sangar_api_url',
  WS_URL: '@sangar_ws_url',
  API_KEY: '@sangar_api_key',
};

// Default fallbacks (can be updated in Settings page)
export const DEFAULT_CONFIG = {
  API_URL: 'https://sangar-production.up.railway.app', // Points to the deployed VPS
  WS_URL: 'wss://sangar-production.up.railway.app',
  API_KEY: '',
};
