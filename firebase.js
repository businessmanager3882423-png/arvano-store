
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAjTyUZyRNr8tOfdGDAmq_PdpBhzto5EM8",
  authDomain: "arvano-store-7e7a3.firebaseapp.com",
  projectId: "arvano-store-7e7a3",
  storageBucket: "arvano-store-7e7a3.firebasestorage.app",
  messagingSenderId: "7346796489",
  appId: "1:7346796489:web:5372f6f30165a74a265a18"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
