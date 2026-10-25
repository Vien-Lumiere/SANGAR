#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <time.h>
#include <math.h>
#include <WiFiClientSecure.h>

// ============= KONDISI SISTEM =============
const float RH_DALAM_BEJANA = 92.0f;
const float SUHU_ACUAN = 25.0f;
const float RH_ACUAN_KALIBRASI = 65.0f;

// ============= JADWAL =============
const int JAM_NYALA_MULAI = 6;
const int JAM_TIDUR_MULAI = 24;
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 7 * 3600;
const int daylightOffset_sec = 0;
struct tm timeinfo;
bool waktuOk = false;

// ============= KONFIGURASI PIN & I2C =============
#define PCF8575_ADDR 0x20
#define SDA_PIN 5
#define SCL_PIN 6
#define S0 0
#define S1 1
#define S2 2
#define S3 3
// [FIX 6] Angka di bawah adalah LABEL pin PCF8575 (P00-P07, P10-P17), bukan nomor bit.
// PBIT() mengubah label jadi nomor bit sebenarnya: P10 -> bit 8 ... P17 -> bit 15.
// (Sebelumnya P16/P17 dipakai sebagai bit 16/17 yang tidak ada, dan P10-P13 salah bit.)
constexpr uint8_t PBIT(uint8_t label) {
  return label >= 10 ? label - 2 : label;
}
#define PUMP1 PBIT(6)
#define PUMP2 PBIT(7)
#define VALVE1 PBIT(13)
#define VALVE2 PBIT(12)
#define BLOWER PBIT(11)
#define LAMP PBIT(10)
#define HX1_DT PBIT(17)
#define HX1_SCK PBIT(16)
#define HX2_DT PBIT(15)
#define HX2_SCK PBIT(14)

// Kondisi diam PCF: semua HIGH (relay mati, DT = input), KECUALI SCK HX710 harus LOW.
// (SCK HIGH lebih dari ~60us membuat HX710 mati -> output selalu -1.)
const uint16_t PCF_IDLE = 0xFFFF & ~((1 << HX1_SCK) | (1 << HX2_SCK));

#define SIG_ADC 1

#define T_pin 0
#define Ph_pin 1
#define MQ1_pin 2
#define MQ2_pin 3
#define solar_pin 4
#define turb1_pin 6
#define turb2_pin 5

// ============= FAKTOR PEMBAGI TEGANGAN =============
const float SIG_DIVIDER = 1.6667f;
const float PANEL_DIVIDER = 4.704f;
const float TOTAL_PANEL_FACTOR = SIG_DIVIDER * PANEL_DIVIDER;

// ============= KALIBRASI SENSOR =============
const float SUHU_FAKTOR_KOREKSI = 1.00f;
const float SUHU_OFFSET = 0.0f;

const float pH_VOLT_NOL = 2.50f;
const float pH_PER_VOLT = 0.18f;
const float pH_FAKTOR_KOREKSI = 1.00f;

// [FIX 1] R0 sekarang dalam OHM (sama satuan dengan Rs). Nilai 3.6 sebelumnya
// membuat ratio ~2800 sehingga ppm selalu ~15 dan tidak pernah berubah.
// GANTI dengan hasil kalibrasi: nyalakan sensor 24+ jam di udara bersih, lihat
// "R0saran" di Serial, lalu isi nilainya di sini.
const float MQ135_R0 = 40000.0f;
const float MQ135_R_LAMA = 10000.0f;
const float MQ135_VCC = 5.0f;  // [FIX 2] modul MQ135 dipakai di 5V (bukan 3.3V)

// [FIX 3] Tegangan sensor turbidity saat KONDISI BERSIH/JERNIH (Volt, setelah
// SIG_DIVIDER). Sebelumnya hardcode 3.0 + constrain(0..100) sehingga jika
// tegangan bersih > 3V, perubahan tertutup di 0%. Lihat "TurbV" di Serial saat
// kondisi bersih, lalu isi nilainya di sini.
const float TURB_V_BERSIH = 3.0f;
const float TURB_NOL = 0.0f;
const float TURB_FAKTOR_KOREKSI = 1.00f;

// Kalibrasi tekanan (PERKIRAAN dari data: sensor 2 kosong ~ -130000, 7 cm ~ +810000;
// sensor 1 belum dites dengan selang, diasumsikan sensitivitas sama dengan sensor 2).
// Cek lagi pakai air dan perbaiki kalau perlu: SCALE = (raw_tinggi - raw_kosong) / tinggi_cm
const float HX1_OFFSET = -720000.0f;
const float HX1_SCALE = 134000.0f;
const float HX2_OFFSET = -130000.0f;
const float HX2_SCALE = 134000.0f;

const float PANEL_FAKTOR_KOREKSI = 1.00f;

// ============= BATAS SISTEM =============
const float LEVEL1_FULL = 20.0f;
const float LEVEL2_FULL = 25.0f;
const float LEVEL1_LOW = 12.5f;
const float LEVEL2_LOW = 15.0f;
const float AMAN_ISI_SEKARANG = LEVEL1_FULL - 2.0f;
const float TURB_THRES = 50.0f;
const int MAKS_DETIK_ISI = 120;

// ============= WIFI — ISI DISINI =============
const char* ssid = "cwe central cee";
const char* password = "ukfineshyt";

// ============= GOOGLE SHEET — ISI DISINI =============
const char* GOOGLE_SCRIPT_HOST = "script.google.com";
const int GOOGLE_SCRIPT_PORT = 443;
const char* GOOGLE_SCRIPT_PATH =
  "/macros/s/AKfycbx3e10t9FN5n0V7DMnHY3fVwTBkHSxIwAJ87nZmuH8ecjcYS7qroBJO0M7S7M1sL58x-Q/exec";

const unsigned long KIRIM_GS_INTERVAL = 10000;  // 10 detik sekali

// MODE KALIBRASI TEKANAN: 1 = kolom "solar" di Sheet berisi HXraw1 dan kolom "rh"
// berisi HXraw2 (angka mentah sebelum diubah ke cm). Set 0 setelah kalibrasi selesai.
#define DEBUG_HX_KE_SHEET 1
unsigned long terakhirKirimGS = 0;

WebServer server(80);

// Data Sensor
float suhuUdara = 0, pH = 0;
float co2_1 = 0, co2_2 = 0;
float turb1 = 0, turb2 = 0;
float level1 = LEVEL1_FULL, level2 = LEVEL2_FULL;
float solarVoltage = 0.0f;

// Data bantu debug (nilai mentah, tidak mengubah logika kontrol)
float mqRsTerakhir = 0.0f;
float turbVTerakhir = 0.0f;

// Status Kontrol
bool baruSajaBangun = true;
bool sedangIsiPagi1 = false, sedangIsiPagi2 = false;
unsigned long mulaiIsiPagi = 0;

bool lampuNyala = false, blowerNyala = false;
bool buang1 = false, buang2 = false, isi1 = false, isi2 = false;
uint16_t pcfPort = PCF_IDLE;

// ============= FUNGSI WAKTU =============
void updateWaktuNTP() {
  Serial.println("⏳ Menyinkronkan waktu NTP...");
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  delay(2000);
  if (getLocalTime(&timeinfo)) {
    waktuOk = true;
    Serial.printf("✅ Waktu: %02d:%02d:%02d %02d/%02d/%04d\n",
                  timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec,
                  timeinfo.tm_mday, timeinfo.tm_mon + 1, timeinfo.tm_year + 1900);
  } else {
    waktuOk = false;
    Serial.println("❌ Gagal ambil waktu!");
  }
}

int getJam() {
  return waktuOk ? timeinfo.tm_hour : 12;
}
bool isSiang() {
  int jam = getJam();
  return (jam >= JAM_NYALA_MULAI && jam < JAM_TIDUR_MULAI);
}
String getWaktuLengkap() {
  if (!waktuOk) return "Menyinkronkan waktu...";
  char buf[64];
  sprintf(buf, "%02d:%02d:%02d — %02d/%02d/%04d",
          timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec,
          timeinfo.tm_mday, timeinfo.tm_mon + 1, timeinfo.tm_year + 1900);
  return String(buf);
}

// ============= MODE TIDUR MALAM =============
void masukModeTidur() {
  Serial.println("🌙 Malam hari — masuk mode tidur...");
  pcfPort = PCF_IDLE;
  pcfWriteAll();
  delay(100);
  baruSajaBangun = true;

  time_t sekarang;
  time(&sekarang);
  struct tm* info = localtime(&sekarang);
  struct tm jadwalBangun = *info;
  jadwalBangun.tm_hour = JAM_NYALA_MULAI;
  jadwalBangun.tm_min = 0;
  jadwalBangun.tm_sec = 0;
  time_t waktuBangun = mktime(&jadwalBangun);
  if (waktuBangun <= sekarang) waktuBangun += 24 * 3600;
  int64_t detikTidur = waktuBangun - sekarang;

  Serial.printf("💤 Tidur %ld detik → bangun jam 06:00\n", (long)detikTidur);
  esp_sleep_enable_timer_wakeup(detikTidur * 1000000LL);
  Serial.flush();
  esp_deep_sleep_start();
}

// ============= PCF8575 =============
void pcfWriteAll() {
  Wire.beginTransmission(PCF8575_ADDR);
  Wire.write(pcfPort & 0xFF);
  Wire.write((pcfPort >> 8) & 0xFF);
  Wire.endTransmission();
}
void pcfSetBit(uint8_t bit, bool state) {
  if (state) pcfPort &= ~(1 << bit);
  else pcfPort |= (1 << bit);
  pcfWriteAll();
}

// ============= HX710 / MPS20 TINGGI AIR =============
// [FIX 6] HX710/MPS20 lewat PCF8575 (I2C). Perbaikan:
//  - label pin -> bit (lihat PBIT)
//  - DT dibaca SUNGGUHAN lewat Wire.requestFrom (sebelumnya hanya membaca variabel pcfPort)
//  - polaritas SCK benar (idle LOW; sebelumnya idle HIGH sehingga HX710 mati)
//  - bit data tidak dibalik
//  - satu pulsa clock (naik+turun) dikirim dalam SATU transaksi I2C; dengan I2C 400kHz
//    SCK HIGH sekitar 45us, di bawah batas ~50-60us HX710.
long hxRawTerakhir = 0;
long hxRaw1G = 0, hxRaw2G = 0;
const int32_t HX_ERR = 0x7FFFFFFF;

bool pcfReadAll(uint16_t &val) {
  if (Wire.requestFrom((uint8_t)PCF8575_ADDR, (uint8_t)2) != 2) return false;
  uint8_t lo = Wire.read();
  uint8_t hi = Wire.read();
  val = lo | ((uint16_t)hi << 8);
  return true;
}

bool hxPulse(uint8_t clkBit) {
  uint16_t hi = pcfPort | (1 << clkBit);
  uint16_t lo = pcfPort & ~(1 << clkBit);
  Wire.beginTransmission(PCF8575_ADDR);
  Wire.write(hi & 0xFF);
  Wire.write((hi >> 8) & 0xFF);
  Wire.write(lo & 0xFF);
  Wire.write((lo >> 8) & 0xFF);
  return Wire.endTransmission() == 0;
}

int32_t readHX710Sekali(uint8_t dtBit, uint8_t clkBit) {
  pcfPort &= ~(1 << clkBit);  // pastikan SCK LOW
  pcfPort |= (1 << dtBit);    // DT harus ditulis 1 agar bisa dibaca sebagai input
  pcfWriteAll();

  uint16_t p;
  unsigned long t0 = millis();
  while (true) {  // tunggu DT turun = data siap
    if (!pcfReadAll(p)) return HX_ERR;
    if ((p & (1 << dtBit)) == 0) break;
    if (millis() - t0 > 200) return HX_ERR;
    delay(2);
  }

  uint32_t val = 0;
  for (uint8_t i = 0; i < 24; i++) {
    if (!hxPulse(clkBit)) return HX_ERR;
    if (!pcfReadAll(p)) return HX_ERR;
    val = (val << 1) | ((p >> dtBit) & 1);
  }
  if (!hxPulse(clkBit)) return HX_ERR;  // pulsa ke-25 (pilih mode)
  if (val & 0x800000) val |= 0xFF000000;
  return (int32_t)val;
}

int32_t readHX710(uint8_t dtBit, uint8_t clkBit) {
  for (uint8_t coba = 0; coba < 3; coba++) {  // coba ulang jika sesekali gagal
    int32_t r = readHX710Sekali(dtBit, clkBit);
    if (r != HX_ERR) return r;
  }
  return HX_ERR;
}
float readWaterLevel_cm(uint8_t dt, uint8_t clk, float off, float sc) {
  int32_t raw = readHX710(dt, clk);
  hxRawTerakhir = raw;
  if (raw == 0x7FFFFFFF) return -1.0f;
  float cm = (raw - off) / sc;
  return constrain(cm, -5.0f, LEVEL2_FULL + 5.0f);
}

// ============= 74HC4067 PEMBACAAN =============
void setChannel(uint8_t ch) {
  pcfSetBit(S0, bitRead(ch, 0));
  pcfSetBit(S1, bitRead(ch, 1));
  pcfSetBit(S2, bitRead(ch, 2));
  pcfSetBit(S3, bitRead(ch, 3));
  delayMicroseconds(150);
}
uint16_t readADC(uint8_t ch) {
  setChannel(ch);
  delayMicroseconds(300);
  analogRead(SIG_ADC);  // [FIX 8] buang sampel pertama (sisa muatan channel sebelumnya)
  delayMicroseconds(50);
  uint32_t s = 0;
  for (uint8_t i = 0; i < 8; i++) {
    s += analogRead(SIG_ADC);
    delayMicroseconds(50);
  }
  return s / 8;
}
float adcToVolt(uint16_t adc) {
  float v = (adc * 3.3f) / 4095.0f;
  return v * SIG_DIVIDER;
}

// ============= FUNGSI SENSOR =============
float readSuhuUdara() {
  float v = adcToVolt(readADC(T_pin));
  float suhu = v * 50.0f;
  suhu = (suhu + SUHU_OFFSET) * SUHU_FAKTOR_KOREKSI;
  return suhu;
}

float readPH() {
  float v = adcToVolt(readADC(Ph_pin));
  float suhu = readSuhuUdara();
  float ph_mentah = (pH_VOLT_NOL - v) / pH_PER_VOLT + 7.0f;
  const float GESERAN_PER_C = 0.003f;
  float ph_koreksi = ph_mentah + (SUHU_ACUAN - suhu) * GESERAN_PER_C;
  ph_koreksi *= pH_FAKTOR_KOREKSI;
  float ph_hasil = ph_koreksi / 2.0f;  // Nilai sensor pH dibagi 2
  return constrain(ph_hasil, 0.0f, 14.0f);
}

float readMQ135(uint8_t ch) {
  float v = adcToVolt(readADC(ch));
  float suhu = readSuhuUdara();
  // [FIX 2] Vcc 5V; jaga dari pembagian nol / Rs negatif (menghasilkan NaN)
  if (v < 0.05f || v > MQ135_VCC - 0.05f) {
    mqRsTerakhir = 0.0f;
    return 0.0f;
  }
  float Rs = (MQ135_VCC - v) / v * MQ135_R_LAMA;
  mqRsTerakhir = Rs;
  float ratio = Rs / MQ135_R0;
  // [FIX 1] kurva MQ135 tanpa offset "+15" (offset itu membuat nilai seolah konstan)
  float ppm_mentah = 116.6020682f * pow(ratio, -2.769034857f);
  float fSuhu = 1.0f + (suhu - SUHU_ACUAN) * 0.007f;
  float fRH = 1.0f + (RH_DALAM_BEJANA - RH_ACUAN_KALIBRASI) * 0.002f;
  return ppm_mentah / (fSuhu * fRH);
}

float readTurbidity(uint8_t ch) {
  float v = adcToVolt(readADC(ch));
  turbVTerakhir = v;
  // [FIX 3] pakai TURB_V_BERSIH, dan jangan clamp bawah ke 0 supaya
  // perubahan kecil tidak hilang
  float pct = (TURB_V_BERSIH - v) / TURB_V_BERSIH * 100.0f;
  pct = (pct - TURB_NOL) * TURB_FAKTOR_KOREKSI;
  return constrain(pct, -100.0f, 100.0f);
}

float readSolarVoltage() {
  uint16_t adc = readADC(solar_pin);
  float v = (adc * 3.3f) / 4095.0f;
  return v * TOTAL_PANEL_FACTOR * PANEL_FAKTOR_KOREKSI;
}

// ============= PENGISIAN OTOMATIS PAGI =============
void cekDanIsiUlangPagi() {
  if (!baruSajaBangun) return;

  if (level1 >= AMAN_ISI_SEKARANG && level2 >= (LEVEL2_FULL - 2.0f)) {
    Serial.println("✅ Pagi — air sudah cukup, siap sirkulasi");
    sedangIsiPagi1 = false;
    sedangIsiPagi2 = false;
    pcfSetBit(PUMP1, false);
    pcfSetBit(PUMP2, false);
    baruSajaBangun = false;
    return;
  }

  if (!sedangIsiPagi1 && level1 < AMAN_ISI_SEKARANG) {
    Serial.printf("🌅 Pagi — Ember 1 kurang (%.1f cm), sedang isi...\n", level1);
    sedangIsiPagi1 = true;
    mulaiIsiPagi = millis();
    pcfSetBit(PUMP1, true);
  }
  if (!sedangIsiPagi2 && level2 < (LEVEL2_FULL - 2.0f)) {
    Serial.printf("🌅 Pagi — Ember 2 kurang (%.1f cm), sedang isi...\n", level2);
    sedangIsiPagi2 = true;
    if (!sedangIsiPagi1) mulaiIsiPagi = millis();
    pcfSetBit(PUMP2, true);
  }

  if (sedangIsiPagi1 && level1 >= LEVEL1_FULL - 1.0f) {
    Serial.println("✅ Ember 1 sudah penuh");
    sedangIsiPagi1 = false;
    pcfSetBit(PUMP1, false);
  }
  if (sedangIsiPagi2 && level2 >= LEVEL2_FULL - 1.0f) {
    Serial.println("✅ Ember 2 sudah penuh");
    sedangIsiPagi2 = false;
    pcfSetBit(PUMP2, false);
  }

  if (millis() - mulaiIsiPagi > MAKS_DETIK_ISI * 1000UL) {
    Serial.println("⚠️ Peringatan: waktu isi pagi habis — cek sumber air!");
    pcfSetBit(PUMP1, false);
    pcfSetBit(PUMP2, false);
    sedangIsiPagi1 = false;
    sedangIsiPagi2 = false;
    baruSajaBangun = false;
  }

  if (!sedangIsiPagi1 && !sedangIsiPagi2) {
    Serial.println("✅ ✅ Kedua ember siap — mulai sirkulasi & pemantauan");
    baruSajaBangun = false;
  }
}

// ============= KONTROL =============
void kontrolLampu() {
  lampuNyala = isSiang();
  pcfSetBit(LAMP, lampuNyala);
}

void kontrolBlower() {
  // if (!isSiang() || baruSajaBangun) {
  //   blowerNyala = false;
  //   pcfSetBit(BLOWER, false);
  //   return;
  // }
  // bool penuh1 = (level1 >= LEVEL1_FULL - 1.5f);
  // bool penuh2 = (level2 >= LEVEL2_FULL - 1.5f);
  // blowerNyala = penuh1 && penuh2;
  // pcfSetBit(BLOWER, blowerNyala);
  blowerNyala = true;
  pcfSetBit(BLOWER, true);
}

void kontrolAir() {
  if (!isSiang() || baruSajaBangun) return;

  if (turb1 > TURB_THRES && !buang1 && !isi1) {
    buang1 = true;
    Serial.println(">> Ember1 buang");
  }
  if (buang1) {
    pcfSetBit(VALVE1, true);
    if (level1 <= LEVEL1_LOW + 0.5f) {
      pcfSetBit(VALVE1, false);
      buang1 = false;
      isi1 = true;
      Serial.println("<< Ember1 kosong, isi");
    }
  }
  if (isi1) {
    pcfSetBit(PUMP1, true);
    if (level1 >= LEVEL1_FULL - 1.0f) {
      pcfSetBit(PUMP1, false);
      isi1 = false;
      Serial.println("✅ Ember1 penuh");
    }
  }

  if (turb2 > TURB_THRES && !buang2 && !isi2) {
    buang2 = true;
    Serial.println(">> Ember2 buang");
  }
  if (buang2) {
    pcfSetBit(VALVE2, true);
    if (level2 <= LEVEL2_LOW + 0.5f) {
      pcfSetBit(VALVE2, false);
      buang2 = false;
      isi2 = true;
      Serial.println("<< Ember2 turun, isi");
    }
  }
  if (isi2) {
    pcfSetBit(PUMP2, true);
    if (level2 >= LEVEL2_FULL - 1.0f) {
      pcfSetBit(PUMP2, false);
      isi2 = false;
      Serial.println("✅ Ember2 penuh");
    }
  }
}

// ============= KIRIM KE GOOGLE SHEET =============
void kirimKeGoogleSheet() {
  if (!isSiang() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - terakhirKirimGS < KIRIM_GS_INTERVAL) return;

  // [FIX 7] jadwalkan ulang dari sekarang, walau nanti gagal, supaya tidak
  // mencoba koneksi TLS (yang memblokir) di setiap putaran loop
  terakhirKirimGS = millis();

  Serial.println("📤 Mengirim ke Google Sheet...");

  WiFiClientSecure client;
  client.setInsecure();

  if (!client.connect(GOOGLE_SCRIPT_HOST, GOOGLE_SCRIPT_PORT)) {
    Serial.println("❌ Gagal terhubung ke Google");
    return;
  }

  String url = String(GOOGLE_SCRIPT_PATH) + "?"
               + "suhu=" + String(suhuUdara, 1)
               + "&ph=" + String(pH, 2)
               + "&co21=" + String(co2_1, 0)
               + "&co22=" + String(co2_2, 0)
               + "&turb1=" + String(turb1, 1)
               + "&turb2=" + String(turb2, 1)
               + "&level1=" + String(level1, 1)
               + "&level2=" + String(level2, 1)
               + "&solar=" + (DEBUG_HX_KE_SHEET ? String(hxRaw1G) : String(solarVoltage, 2))
               + "&rh=" + (DEBUG_HX_KE_SHEET ? String(hxRaw2G) : String(RH_DALAM_BEJANA, 0));

  client.print(String("GET ") + url + " HTTP/1.1\r\n" + "Host: " + GOOGLE_SCRIPT_HOST + "\r\n" + "Connection: close\r\n\r\n");

  // [FIX 7] tunggu balasan dulu (sebelumnya langsung dicek sehingga tidak
  // pernah terbaca). Apps Script biasanya membalas 302 setelah doGet jalan,
  // jadi 302/200/"OK" semuanya dianggap berhasil.
  unsigned long batas = millis() + 3000;
  while (client.connected() && !client.available() && millis() < batas) {
    delay(10);
  }

  bool sukses = false;
  while (client.available() && millis() < batas) {
    String balas = client.readStringUntil('\n');
    if (balas.startsWith("HTTP/1.1 302") || balas.startsWith("HTTP/1.1 200") || balas.indexOf("OK") >= 0) {
      sukses = true;
      break;
    }
  }

  if (sukses) {
    Serial.println("✅ Tersimpan di Google Sheet!");
  } else {
    Serial.println("⚠️ Tidak ada balasan dari Google (waktu tunggu habis)");
  }

  client.stop();
}

// ============= HALAMAN WEB LOKAL =============
void handleRoot() {
  String t = getWaktuLengkap();
  String pagiStatus = baruSajaBangun ? "🌅 Menyiapkan air..." : "☀️ Beroperasi";
  String s1 = buang1 ? "🔄 Buang" : isi1           ? "💧 Isi"
                                 : sedangIsiPagi1 ? "💧 Mengisi pagi"
                                                  : "✅ Normal";
  String s2 = buang2 ? "🔄 Buang" : isi2           ? "💧 Isi"
                                 : sedangIsiPagi2 ? "💧 Mengisi pagi"
                                                  : "✅ Normal";
  String ls = lampuNyala ? "Menyala" : "Mati", lc = lampuNyala ? "nyala" : "mati";
  String bs = blowerNyala ? "Menyala" : "Mati", bc = blowerNyala ? "nyala" : "mati";

  String html = R"HTML(<!DOCTYPE html><html lang="id"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bejana Air — Sistem Lengkap</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:Segoe UI,sans-serif;}
    body{background:#f0f4f8;padding:20px;max-width:900px;margin:0 auto;}
    h1{text-align:center;color:#2d3748;margin-bottom:10px;}
    .status-sistem{text-align:center;font-size:1.2rem;margin-bottom:20px;}
    .jam{text-align:center;margin-bottom:25px;color:#4a5568;}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;}
    .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 4px 12px rgba(0,0,0,.08);}
    h2{color:#2b6cb0;margin-bottom:15px;font-size:1.1rem;}
    .item{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;}
    .nilai{font-weight:bold;color:#2f855a;}
    .status{padding:3px 10px;border-radius:20px;font-size:.9rem;font-weight:bold;}
    .nyala{background:#fef3c7;color:#92400e;}
    .mati{background:#e2e8f0;color:#4a5568;}
  </style></head><body>
  <h1>💧 Sistem Monitoring Bejana Air</h1>
  <div class="status-sistem">STATUSPAGI</div>
  <div class="jam">Waktu: <b>TIME</b></div>
  <div class="grid">
    <div class="card"><h2>🌤️ Udara dalam Bejana</h2>
      <div class="item"><span>Suhu Udara</span><span class="nilai">SUHU °C</span></div>
    </div>
    <div class="card"><h2>🧪 Kualitas Air</h2>
      <div class="item"><span>Keasaman pH</span><span class="nilai">PH</span></div>
      <div class="item"><span>Kekeruhan 1</span><span class="nilai">T1 %</span></div>
      <div class="item"><span>Kekeruhan 2</span><span class="nilai">T2 %</span></div>
    </div>
    <div class="card"><h2>☁️ Kualitas Udara</h2>
      <div class="item"><span>CO₂ 1</span><span class="nilai">C1 ppm</span></div>
      <div class="item"><span>CO₂ 2</span><span class="nilai">C2 ppm</span></div>
    </div>
    <div class="card"><h2>📏 Tinggi Air</h2>
      <div class="item"><span>Ember 1</span><span class="nilai">L1 cm</span></div>
      <div class="item"><span>Ember 2</span><span class="nilai">L2 cm</span></div>
    </div>
    <div class="card"><h2>⚡ Perangkat</h2>
      <div class="item"><span>Lampu</span><span class="status LCLS">LST</span></div>
      <div class="item"><span>Blower/Sirkulasi</span><span class="status BCLS">BST</span></div>
    </div>
  </div>
  <p style="text-align:center;margin-top:20px;"><a href="https://docs.google.com/spreadsheets/d/" target="_blank">📊 Buka Data di Google Sheet</a></p>
  <script>setInterval(()=>location.reload(),30000);</script>
</body></html>)HTML";

  html.replace("STATUSPAGI", pagiStatus);
  html.replace("TIME", t);
  html.replace("SUHU", String(suhuUdara, 1));
  html.replace("PH", String(pH, 2));
  html.replace("T1", String(turb1, 1));
  html.replace("T2", String(turb2, 1));
  html.replace("C1", String(co2_1, 0));
  html.replace("C2", String(co2_2, 0));
  html.replace("L1", String(level1, 1));
  html.replace("L2", String(level2, 1));
  html.replace("LST", ls);
  html.replace("LCLS", lc);
  html.replace("BST", bs);
  html.replace("BCLS", bc);
  server.send(200, "text/html;charset=utf-8", html);
}

// ============= SETUP & LOOP =============
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n===== AEROFY =====");

  esp_sleep_wakeup_cause_t c = esp_sleep_get_wakeup_cause();
  if (c == ESP_SLEEP_WAKEUP_TIMER) {
    Serial.println("⏰ Bangun pagi — isi ulang air");
  } else {
    Serial.println("🔌 Dinyalakan ulang manual");
    baruSajaBangun = true;
  }

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);  // [FIX 6] wajib 400kHz agar pulsa SCK HX710 cukup pendek
  delay(50);
  pcfPort = PCF_IDLE;
  pcfWriteAll();
  delay(100);

  WiFi.begin(ssid, password);
  Serial.print("Menghubungkan WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ IP: " + WiFi.localIP().toString());

  updateWaktuNTP();
  server.on("/", handleRoot);
  server.begin();
}

unsigned long lastRead = 0;
unsigned long lastWaktu = 0;
void loop() {
  // [FIX 5] perbarui jam tiap 1 detik. Sebelumnya timeinfo hanya diisi sekali
  // di setup sehingga jam beku dan isSiang() tidak pernah berubah.
  if (millis() - lastWaktu > 1000) {
    lastWaktu = millis();
    if (getLocalTime(&timeinfo, 0)) waktuOk = true;
  }

  if (waktuOk && !isSiang()) masukModeTidur();

  server.handleClient();

  if (isSiang() && millis() - lastRead > 2000) {
    lastRead = millis();

    suhuUdara = readSuhuUdara();
    pH = readPH();
    co2_1 = readMQ135(MQ1_pin);
    float rs1 = mqRsTerakhir;
    co2_2 = readMQ135(MQ2_pin);
    float rs2 = mqRsTerakhir;
    turb1 = readTurbidity(turb1_pin);
    float tv1 = turbVTerakhir;
    turb2 = readTurbidity(turb2_pin);
    float tv2 = turbVTerakhir;
    solarVoltage = readSolarVoltage();
    level1 = readWaterLevel_cm(HX1_DT, HX1_SCK, HX1_OFFSET, HX1_SCALE);
    long hxRaw1 = hxRawTerakhir;
    level2 = readWaterLevel_cm(HX2_DT, HX2_SCK, HX2_OFFSET, HX2_SCALE);
    long hxRaw2 = hxRawTerakhir;
    hxRaw1G = hxRaw1;
    hxRaw2G = hxRaw2;

    if (baruSajaBangun) {
      cekDanIsiUlangPagi();
    } else {
      kontrolLampu();
      kontrolAir();
      kontrolBlower();
    }

    kirimKeGoogleSheet();

    Serial.printf("☀️ Suhu=%.1f°C | pH=%.2f | CO2=%.0f/%.0f ppm | Turb=%.1f/%.1f%% | Level=%.1f/%.1f cm | Blower=%s\n",
                  suhuUdara, pH, co2_1, co2_2, turb1, turb2, level1, level2, blowerNyala ? "ON" : "OFF");

    // Data mentah untuk kalibrasi (boleh dihapus kalau sudah selesai kalibrasi)
    const float FAKTOR_R0 = pow(400.0f / 116.6020682f, 1.0f / 2.769034857f);
    Serial.printf("🔧 Rs=%.0f/%.0f ohm | R0saran(udara bersih)=%.0f/%.0f | TurbV=%.2f/%.2f V\n",
                  rs1, rs2, rs1 * FAKTOR_R0, rs2 * FAKTOR_R0, tv1, tv2);
    Serial.printf("🔧 HXraw1=%ld HXraw2=%ld (2147483647 = sensor tidak merespons)\n", hxRaw1, hxRaw2);

    // Diagnosa mux: ADC mentah channel 0-7 (T, pH, MQ1, MQ2, solar, turb2, turb1, -).
    // Kalau semua angkanya hampir sama, mux tidak berpindah channel / input mengambang.
    Serial.print("🔧 ADCmentah ch0-7: ");
    for (uint8_t ch = 0; ch < 8; ch++) {
      Serial.printf("%u ", readADC(ch));
    }
    Serial.println();
  }
}
