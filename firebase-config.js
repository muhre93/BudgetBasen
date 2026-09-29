// =====================================================================
//  firebase-config.js — den ENESTE fil du skal rette for at koble appen
//  til dit eget Firebase-projekt.
//
//  Firebase Console → ⚙ Projektindstillinger → Generelt → "Dine apps" → Web-app
//  → kopiér firebaseConfig-objektet ind herunder.
//
//  Det er helt fint at disse værdier ligger offentligt på GitHub Pages:
//  apiKey er IKKE en hemmelighed — sikkerheden ligger i Security Rules
//  (firestore.rules) og i din Cloudflare Worker.
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCjsIX-Ilza2nt5rJRfbsEmKSJZ6xZ0Vxc",
  authDomain: "budgetbasen.firebaseapp.com",
  projectId: "budgetbasen",
  storageBucket: "budgetbasen.firebasestorage.app",
  messagingSenderId: "317548889590",
  appId: "1:317548889590:web:990d353e8dbc0dbbedf3d7"
};

// Adressen på din Cloudflare Worker, som gemmer kvitteringer og kontrakter i Workers KV
// (gratis, intet betalingskort). Se worker/budgetbasen-files.js og README for opsætning.
// Uden skråstreg til sidst, f.eks. "https://budgetbasen-files.dit-navn.workers.dev"
export const FILES_WORKER_URL = "https://budgetbasen-files.muhre93.workers.dev";

export const APP_NAME = "BudgetBasen";
