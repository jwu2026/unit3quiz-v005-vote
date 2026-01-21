import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyAtM1ko4W8T3aY-f6PNB4CXeI3499dGDaw",
    authDomain: "unit3quiz-v005-vote.firebaseapp.com",
    projectId: "unit3quiz-v005-vote",
    storageBucket: "unit3quiz-v005-vote.firebasestorage.app",
    messagingSenderId: "858732429380",
    appId: "1:858732429380:web:7b02939fea05e1802abc11",
    measurementId: "G-4537LZ29EV"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
