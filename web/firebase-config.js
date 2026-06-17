const firebaseConfig = {
  apiKey: "AIzaSyDBobt_J2jbuCA8uT3DffCJin8DBvjUJ34",
  authDomain: "telegram-a007d.firebaseapp.com",
  databaseURL: "https://telegram-a007d-default-rtdb.firebaseio.com",
  projectId: "telegram-a007d",
  storageBucket: "telegram-a007d.firebasestorage.app",
  messagingSenderId: "161440347121",
  appId: "1:161440347121:web:6cbdf8c479180e13af0a50",
  measurementId: "G-EX532EP2JC"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
const db = firebase.database();
const storage = firebase.storage();
