var currentScreen = 0;
var isSignUp = true;
var selectedColour = '#2d5da1';
var signedUpUser = null;

var TOTAL_SCREENS = 7;

init();

function init() {
  var params = new URLSearchParams(window.location.search);

  var complete = localStorage.getItem('onboardingComplete') === 'true';
  if (complete) {
    auth.onAuthStateChanged(function(user) {
      if (user) {
        window.location.href = 'chat.html';
      } else {
        goToScreen(4);
        setAuthMode(false);
      }
    });
    return;
  }
  startSplash();
}

function startSplash() {
  setTimeout(function() {
    fadeOutSplash();
  }, 1800);
}

function fadeOutSplash() {
  var splash = document.getElementById('screen-0');
  splash.classList.remove('active');
  splash.classList.add('exit');
  setTimeout(function() {
    goToScreen(1);
  }, 500);
}

function goToScreen(index) {
  var current = document.getElementById('screen-' + currentScreen);
  var next = document.getElementById('screen-' + index);

  if (current) {
    current.classList.remove('active');
    current.classList.add('exit');
  }

  setTimeout(function() {
    if (current) {
      current.classList.remove('exit');
    }
    currentScreen = index;
    next.classList.add('active');
    updateDots(index);

    if (index === 4) {
      setAuthMode();
    }

    if (index === 6) {
      startConfetti();
      setTimeout(function() {
        localStorage.setItem('onboardingComplete', 'true');
        window.location.href = 'chat.html';
      }, 1500);
    }
  }, 350);
}

function nextSlide() {
  var next = currentScreen + 1;
  if (next <= 3) {
    goToScreen(next);
  }
}

function updateDots(activeIndex) {
  for (var i = 1; i <= 3; i++) {
    var dot = document.getElementById('screen-' + i);
    if (dot) {
      var dots = dot.querySelectorAll('.dot');
      dots.forEach(function(d, idx) {
        d.classList.remove('active');
        if (idx === activeIndex - 1) {
          d.classList.add('active');
        }
      });
    }
  }
}

function toggleAuthMode() {
  window.location.href = 'signin.html';
}

function setAuthMode() {
  var heading = document.getElementById('auth-heading');
  var btn = document.getElementById('auth-btn');
  var confirmField = document.getElementById('confirm-field');
  var error = document.getElementById('auth-error');
  var nameInput = document.getElementById('display-name-input');

  heading.textContent = 'Create your account.';
  btn.textContent = 'Create account';
  confirmField.style.display = 'block';
  nameInput.style.display = 'block';
  error.style.display = 'none';
}

function handleAuth() {
  var email = document.getElementById('email-input').value.trim();
  var password = document.getElementById('password-input').value;
  var error = document.getElementById('auth-error');

  if (!email || !password) {
    showError('Please fill in all fields.', error);
    return;
  }

  var confirm = document.getElementById('confirm-input').value;
  if (password !== confirm) {
    showError('Passwords do not match.', error);
    return;
  }
  if (password.length < 6) {
    showError('Password must be at least 6 characters.', error);
    return;
  }
  var displayName = document.getElementById('display-name-input').value.trim();
  if (!displayName) {
    showError('Please enter your name.', error);
    return;
  }

  auth.createUserWithEmailAndPassword(email, password)
    .then(function(result) {
      return result.user.updateProfile({ displayName: displayName }).then(function() {
        signedUpUser = result.user;
        return db.ref('users/' + result.user.uid).set({
          displayName: displayName,
          avatarColour: '#2d5da1',
          followers: {},
          following: {},
          createdAt: firebase.database.ServerValue.TIMESTAMP
        });
      });
    })
    .then(function() {
      goToScreen(5);
    })
    .catch(function(err) {
      showError(err.message, error);
    });
}

function showError(msg, el) {
  el.textContent = msg;
  el.style.display = 'block';
  var card = document.getElementById('auth-card');
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}

function selectColour(el) {
  document.querySelectorAll('.swatch').forEach(function(s) { s.classList.remove('selected'); });
  el.classList.add('selected');
  selectedColour = el.getAttribute('data-colour');
  updateAvatarPreview();
}

function updateAvatarPreview() {
  var name = document.getElementById('profile-name-input').value.trim();
  var preview = document.getElementById('avatar-preview');
  preview.style.background = selectedColour;
  preview.textContent = name ? name.charAt(0).toUpperCase() : 'S';
}

function saveProfile() {
  var name = document.getElementById('profile-name-input').value.trim();
  if (!name) {
    var error = document.getElementById('auth-error');
    showError('Please enter a display name.', error);
    document.getElementById('screen-5').querySelector('.btn-primary').scrollIntoView();
    return;
  }

  var user = signedUpUser || auth.currentUser;
  if (!user) {
    goToScreen(6);
    return;
  }

  var updates = [];
  updates.push(user.updateProfile({ displayName: name }));
  updates.push(db.ref('users/' + user.uid).update({
    displayName: name,
    avatarColour: selectedColour
  }));

  Promise.all(updates)
    .then(function() {
      goToScreen(6);
    })
    .catch(function(err) {
      console.error('Profile save error:', err);
      goToScreen(6);
    });
}

function startConfetti() {
  var container = document.getElementById('confetti-container');
  var colours = ['#ff4d4d', '#2d5da1', '#fff9c4', '#e5e0d8', '#2d2d2d'];
  var shapes = ['8px 8px', '6px 12px', '10px 4px', '5px 5px'];

  for (var i = 0; i < 14; i++) {
    var el = document.createElement('div');
    el.className = 'confetti';
    var shape = shapes[i % shapes.length];
    var dims = shape.split('x').map(function(s) { return s.trim(); });
    el.style.width = dims[0];
    el.style.height = dims[1];
    el.style.background = colours[i % colours.length];
    el.style.borderRadius = i % 3 === 0 ? '50%' : '2px';
    var angle = (360 / 14) * i;
    var dist = 80 + Math.random() * 60;
    el.style.setProperty('--angle', angle + 'deg');
    el.style.setProperty('--dist', dist + 'px');
    container.appendChild(el);

    setTimeout(function(e) {
      e.classList.add('burst');
    }, 100 + i * 30, el);
  }
}
