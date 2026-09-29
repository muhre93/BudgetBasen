// Firebase-initialisering. Alle andre moduler importerer Firebase-funktioner herfra,
// så SDK-versionen kun står ét sted.
// SDK-version: 10.12.2 (opdatér alle 3 import-linjer samtidig hvis du vil opgradere)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp, writeBatch, arrayUnion, arrayRemove,
  deleteField, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline-cache: appen virker også uden net og synkroniserer bagefter.
let _db;
try {
  _db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  _db = initializeFirestore(app, { ignoreUndefinedProperties: true });
}
export const db = _db;

export {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp, writeBatch, arrayUnion, arrayRemove, deleteField, Timestamp,
};
