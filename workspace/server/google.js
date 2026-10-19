// สร้าง client ของ Google APIs ครั้งเดียว ใช้ร่วมกันทั้งระบบ
import { sheets as sheetsApi } from '@googleapis/sheets';
import { drive as driveApi } from '@googleapis/drive';
import { docs as docsApi } from '@googleapis/docs';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { config } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];

let clients = null;

export function google() {
  if (clients) return clients;
  let auth;
  if (config.oauthRefreshToken) {
    // บัญชีระบบ (เช่น rmic.raot@gmail.com) — ไฟล์ที่อัปโหลดจะใช้พื้นที่ Drive ของบัญชีนี้
    auth = new OAuth2Client(config.oauthClientId, config.oauthClientSecret);
    auth.setCredentials({ refresh_token: config.oauthRefreshToken });
  } else {
    // Service account ของ Cloud Run — ต้องแชร์สเปรดชีต/โฟลเดอร์ให้อีเมลของ service account
    auth = new GoogleAuth({ scopes: SCOPES });
  }
  clients = {
    sheets: sheetsApi({ version: 'v4', auth }),
    drive: driveApi({ version: 'v3', auth }),
    docs: docsApi({ version: 'v1', auth }),
  };
  return clients;
}
