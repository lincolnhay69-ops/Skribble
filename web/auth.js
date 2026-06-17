auth.onAuthStateChanged(function(user) {
  var path = window.location.pathname;
  var isIndex = path.endsWith('index.html') || path === '/' || path === '';
  var isSignin = path.indexOf('signin.html') !== -1;
  var isChat = path.indexOf('chat.html') !== -1;
  var isProfile = path.indexOf('profile.html') !== -1;

  if (user) {
    if (isSignin) {
      window.location.href = 'chat.html';
    }
  } else {
    if (isChat || isProfile) {
      window.location.href = 'signin.html';
    }
  }
});

function signUp(email, password, displayName) {
  return auth.createUserWithEmailAndPassword(email, password)
    .then(function(cred) {
      return cred.user.updateProfile({ displayName: displayName })
        .then(function() {
          return db.ref('users/' + cred.user.uid).set({
            displayName: displayName,
            email: email,
            photoURL: null,
            followers: {},
            following: {},
            createdAt: firebase.database.ServerValue.TIMESTAMP
          });
        });
    });
}

function signIn(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}
