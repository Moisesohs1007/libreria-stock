import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// =============================================
// 🔴 FIREBASE CONFIG
// =============================================
const firebaseConfig = {
  apiKey: "AIzaSyD0UvcxBldiHc3CmdqJ8-qu7xpEHIl-ybc",
  authDomain: "libreria-stock-da5ce.firebaseapp.com",
  projectId: "libreria-stock-da5ce",
  storageBucket: "libreria-stock-da5ce.firebasestorage.app",
  messagingSenderId: "135943556041",
  appId: "1:135943556041:web:acd2a01218a00ff07ab618",
  measurementId: "G-8QBVLR2CF2"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
enableIndexedDbPersistence(db).catch(() => {});
