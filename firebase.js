import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCjbNAglH6Rfjhsx1umqDYOobhHlVwClk4",
  authDomain: "arvano-store.firebaseapp.com",
  projectId: "arvano-store",
  storageBucket: "arvano-store.firebasestorage.app",
  messagingSenderId: "947800775390",
  appId: "1:947800775390:web:4142c2ad996114e1d1004f"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);
